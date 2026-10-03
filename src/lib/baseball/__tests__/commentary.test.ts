import assert from "node:assert/strict";
import { test } from "node:test";
import { CommentaryPolicy } from "../commentary.ts";
import { TwinController } from "../../twin/controller.ts";
import { env, fakeDecision, grid, newMotion, runToEnd } from "../../twin/__tests__/helpers.ts";
import { ChatDirector, type ReplyPayload, type ReplyRequest } from "../../voice/director.ts";
import { service } from "./helpers.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Fake /api/reply backed by the real knowledge service (fixture data). */
function backend() {
  const svc = service();
  const calls: ReplyRequest[] = [];
  const request = async (body: ReplyRequest): Promise<ReplyPayload> => {
    calls.push(body);
    const k = body.knowledge ? await svc.bundle(body.knowledge) : null;
    const facts = (k?.facts ?? []).map((f) => ({ id: f.id, kind: f.kind, playerId: f.subject.playerId, text: f.text, verification: f.verification, source: f.source }));
    return { text: `[${body.outcome.status}] ${facts.map((f) => f.text).join(" ")}`, source: "built-in", facts };
  };
  return { request, calls };
}

function setup(request: (b: ReplyRequest) => Promise<ReplyPayload>, now = { t: 0 }) {
  const motion = newMotion();
  const spy = { follow: 0, stop: 0, setPose: 0 };
  for (const k of ["follow", "stop", "setPose"] as const) {
    const orig = motion[k].bind(motion) as (...a: unknown[]) => void;
    (motion as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => {
      spy[k]++;
      return orig(...a);
    };
  }
  const ctl = new TwinController({ env, grid, motion, decide: async () => fakeDecision("navigate_card"), now: () => now.t });
  const director = new ChatDirector({ ctl, request, cardNames: env.cards.map((c) => c.name), now: () => now.t });
  return { motion, ctl, director, spy, now };
}

test("8. heading to, arriving at, and re-selecting a card in quick succession yields one fact", async () => {
  const be = backend();
  const { motion, ctl, director, now } = setup(be.request);
  await ctl.submit("Go to Griffey");
  await flush();
  const id = ctl.getState().missions[0].id;
  assert.equal(be.calls[0].knowledge?.trigger, "navigate");
  assert.equal(director.getState().entries[id].reply?.facts?.length, 1);

  runToEnd(motion);
  now.t += 20_000;
  await flush();
  const after = director.getState().entries[id].after!;
  assert.equal(after.facts?.length ?? 0, 0, "arrival on the same trip does not add a second fact");
  assert.match(after.text!, /Ken Griffey Jr\./);
  assert.equal(be.calls.length, 1, "no extra model call for the arrival");

  // Asking to go there again right away: still within the quiet period.
  now.t += 5_000;
  await ctl.submit("Go to Griffey");
  await flush();
  assert.equal(be.calls.at(-1)!.knowledge, undefined);
});

test("9b. a revisit after the quiet period shares a different fact", async () => {
  const be = backend();
  const { motion, ctl, director, now } = setup(be.request);
  await ctl.submit("Go to Griffey");
  await flush();
  runToEnd(motion);
  await flush();
  const first = director.getState().entries[ctl.getState().missions[0].id].reply!.facts![0];
  await ctl.submit("Go to Ichiro");
  await flush();
  runToEnd(motion);
  now.t += 120_000;
  await ctl.submit("Go to Griffey");
  await flush();
  const k = be.calls.at(-1)!.knowledge!;
  assert.equal(k.trigger, "revisit");
  assert.ok(k.exclude.includes(first.id));
  const second = director.getState().entries[ctl.getState().missions.at(-1)!.id].reply!.facts![0];
  assert.notEqual(second.id, first.id);
});

test("questions always get knowledge and take priority over volunteered comments", async () => {
  const policy = new CommentaryPolicy();
  assert.deepEqual(policy.decide({ type: "arrive", cardId: "c", missionId: "m", at: 0, busy: true }), { allow: false, reason: "busy" });
  const be = backend();
  const motion = newMotion();
  const ctl = new TwinController({ env, grid, motion, decide: async () => fakeDecision("converse"), now: () => 0 });
  new ChatDirector({ ctl, request: be.request, cardNames: [] });
  await ctl.submit("What did Ken Griffey Jr. do in 1994?");
  await flush();
  assert.equal(be.calls[0].knowledge?.trigger, "ask");
  assert.equal(be.calls[0].knowledge?.text, "What did Ken Griffey Jr. do in 1994?");
});

test("11. a knowledge/voice failure never interrupts navigation", async () => {
  const { motion, ctl, director } = setup(async () => {
    throw new Error("knowledge service down");
  });
  await ctl.submit("Go to Griffey");
  await flush();
  const id = ctl.getState().missions[0].id;
  assert.equal(ctl.getState().missions[0].status, "moving");
  assert.match(director.getState().entries[id].reply!.text!, /Ken Griffey Jr\./, "built-in line still replies");
  runToEnd(motion);
  assert.equal(ctl.getState().missions[0].status, "arrived");
});

test("12. commentary never moves the robot; E-stop still halts immediately", async () => {
  const be = backend();
  const { motion, ctl, spy } = setup(be.request);
  await ctl.submit("Go to Griffey");
  await flush();
  assert.equal(spy.follow, 1, "only the controller's plan started motion");
  for (let i = 0; i < 20; i++) motion.advance(0.05);
  const before = be.calls.length;
  await ctl.submit("Stop.");
  assert.equal(motion.getState().status, "stopped", "stopped synchronously, before any reply is written");
  await flush();
  assert.equal(spy.follow, 1);
  assert.ok(be.calls.length > before);
});
