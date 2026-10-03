import assert from "node:assert/strict";
import { test } from "node:test";
import type { DecisionResult } from "../../decision/contracts";
import { type DecideFn, TwinController } from "../controller.ts";
import { cardById } from "../environment.ts";
import { deferred, env, fakeDecision, grid, newMotion, runToEnd } from "./helpers.ts";

/** Decide double: picks the navigation kind from the words, like a cooperative model would. */
const byWords: DecideFn = async ({ message }) => {
  const t = message.toLowerCase();
  if (/nearest|closest/.test(t)) return fakeDecision("navigate_nearest");
  if (/other side|middle|dock/.test(t)) return fakeDecision("navigate_area");
  if (/hello|how are/.test(t)) return fakeDecision("converse");
  return fakeDecision("navigate_card", "Navigate to a named card");
};

function setup(decide: DecideFn = byWords) {
  const motion = newMotion();
  let clock = 0;
  const ctl = new TwinController({ env, grid, motion, decide, now: () => ++clock });
  const last = () => ctl.getState().missions.at(-1)!;
  return { motion, ctl, last };
}

test("Go to Griffey: resolve → plan → move → arrived, with real transitions", async () => {
  const { motion, ctl, last } = setup();
  await ctl.submit("Go to Griffey.");
  assert.equal(last().status, "moving");
  assert.equal(last().target?.id, "griffey-89");
  assert.equal(last().plan?.status, "ok");
  assert.ok(last().plan?.detour, "route detours around an obstacle");
  runToEnd(motion);
  assert.equal(last().status, "arrived");
  assert.deepEqual(
    last().transitions.map((t) => t.status),
    ["received", "interpreting", "resolving", "planning", "route_ready", "moving", "arrived"],
  );
  const g = cardById(env, "griffey-89")!;
  const p = motion.getState().pose;
  assert.ok(Math.hypot(p.x - g.approach.x, p.y - g.approach.y) < 1e-6);
});

test("Go to Bonds asks for clarification and does not move; answering resumes", async () => {
  const { motion, ctl, last } = setup();
  await ctl.submit("Go to Bonds.");
  assert.equal(last().status, "needs_clarification");
  assert.deepEqual(last().clarify?.options.map((o) => o.id).sort(), ["barry-bonds-87", "bobby-bonds-69"]);
  assert.equal(motion.getState().status, "idle");
  await ctl.submit("Bobby");
  assert.equal(last().target?.id, "bobby-bonds-69");
  assert.equal(last().status, "moving");
  assert.equal(last().decision?.source, "rule", "target choice is attributed to the operator, not the model");
});

test("unreachable target: Marty stays put and the mission reports no_route", async () => {
  const { motion, ctl, last } = setup();
  const before = { ...motion.getState().pose };
  await ctl.submit("Go to Honus Wagner");
  assert.equal(last().status, "no_route");
  assert.equal(motion.getState().status, "idle");
  assert.deepEqual(motion.getState().pose, before);
});

test("unknown card asks instead of guessing", async () => {
  const { motion, ctl, last } = setup();
  await ctl.submit("Go to Babe Ruth");
  assert.equal(last().status, "needs_clarification");
  assert.equal(motion.getState().status, "idle");
});

test("Stop halts immediately (no decision round-trip) and stays stopped", async () => {
  let calls = 0;
  const { motion, ctl, last } = setup(async (r) => {
    calls++;
    return byWords(r);
  });
  await ctl.submit("Go to Griffey");
  for (let i = 0; i < 30; i++) motion.advance(0.05);
  await ctl.submit("Stop.");
  assert.equal(calls, 1, "E-stop did not call the decision engine");
  assert.equal(motion.getState().status, "stopped");
  const frozen = { ...motion.getState().pose };
  for (let i = 0; i < 50; i++) motion.advance(0.05);
  assert.deepEqual(motion.getState().pose, frozen);
  const ms = ctl.getState().missions;
  assert.equal(ms[0].status, "stopped");
  assert.equal(last().status, "stopped");
  assert.equal(last().decision?.source, "rule");
});

test("retargeting cancels the old mission and plans from the current pose", async () => {
  const { motion, ctl } = setup();
  await ctl.submit("Go to Griffey");
  for (let i = 0; i < 40; i++) motion.advance(0.05);
  const here = { ...motion.getState().pose };
  await ctl.submit("Go to Ripken");
  const [first, second] = ctl.getState().missions;
  assert.equal(first.status, "cancelled");
  assert.equal(second.status, "moving");
  assert.equal(second.target?.id, "ripken-82");
  assert.deepEqual(second.plan?.waypoints[0], { x: Math.round(here.x * 100) / 100, y: Math.round(here.y * 100) / 100 });
  runToEnd(motion);
  assert.equal(ctl.getState().missions[1].status, "arrived");
  assert.equal(ctl.getState().missions[0].status, "cancelled");
});

test("a late decision for an older request is discarded", async () => {
  const slow = deferred<DecisionResult>();
  let n = 0;
  const { motion, ctl } = setup(async (r) => (n++ === 0 ? slow.promise : byWords(r)));
  const first = ctl.submit("Go to Griffey");
  await ctl.submit("Go to Ripken");
  slow.resolve(await byWords({ message: "Go to Griffey", twin: ctl.context() }));
  await first;
  const [a, b] = ctl.getState().missions;
  assert.equal(a.status, "cancelled");
  assert.equal(b.target?.id, "ripken-82");
  assert.equal(motion.getState().missionId, b.id);
});

test("Stop while a decision is pending prevents the late decision from moving Marty", async () => {
  const slow = deferred<DecisionResult>();
  const { motion, ctl } = setup(() => slow.promise);
  const pending = ctl.submit("Go to Griffey");
  await ctl.submit("stop");
  slow.resolve(fakeDecision("navigate_card"));
  await pending;
  assert.equal(ctl.getState().missions[0].status, "cancelled");
  assert.notEqual(motion.getState().status, "moving");
});

test("reset restores defaults and ignores in-flight decisions", async () => {
  const slow = deferred<DecisionResult>();
  let n = 0;
  const { motion, ctl } = setup(async (r) => (n++ === 0 ? byWords(r) : slow.promise));
  await ctl.submit("Go to Griffey");
  for (let i = 0; i < 30; i++) motion.advance(0.05);
  const pending = ctl.submit("Go to Ripken");
  ctl.reset();
  slow.resolve(fakeDecision("navigate_card"));
  await pending;
  assert.deepEqual(ctl.getState().missions, []);
  assert.equal(ctl.getState().activeId, null);
  assert.deepEqual(motion.getState().pose, env.defaultPose);
  assert.equal(motion.getState().status, "idle");
});

test("manual placement is validated and changes subsequent planning", async () => {
  const { ctl, last } = setup();
  const bad = ctl.placeRobot({ x: 5, y: 4, heading: 0 });
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? "" : bad.reason, /display table/);
  assert.equal(ctl.placeRobot({ x: 20, y: 4, heading: 0 }).ok, false);

  await ctl.submit("Go to Griffey");
  const fromDefault = last().plan!.length;
  ctl.reset();
  assert.equal(ctl.placeRobot({ x: 10, y: 3.5, heading: 0 }).ok, true);
  await ctl.submit("Go to Griffey");
  assert.deepEqual(last().plan!.waypoints[0], { x: 10, y: 3.5 });
  assert.ok(last().plan!.length < fromDefault, "closer start gives a shorter route");
});

test("placement is refused while moving", async () => {
  const { motion, ctl } = setup();
  await ctl.submit("Go to Griffey");
  motion.advance(0.1);
  assert.equal(ctl.placeRobot({ x: 2, y: 2, heading: 0 }).ok, false);
});

test("decision-engine errors leave Marty idle and report an error", async () => {
  const { motion, ctl, last } = setup(async () => {
    throw { code: "not_configured", message: "Live mode needs JEV_API_KEY", retryable: false };
  });
  await ctl.submit("Go to Griffey");
  assert.equal(last().status, "error");
  assert.match(last().error!.message, /JEV_API_KEY/);
  assert.equal(motion.getState().status, "idle");
});

test("nearest card and other-side requests plan real routes", async () => {
  const { ctl, last } = setup();
  await ctl.submit("Visit the nearest card");
  assert.equal(last().status, "moving");
  assert.equal(last().resolution?.status, "resolved");
  await ctl.submit("Go to the other side of the room");
  assert.equal(last().status, "moving");
  assert.equal(last().target?.kind, "area");
});

test("conversation does not move Marty", async () => {
  const { motion, ctl, last } = setup();
  await ctl.submit("hello Marty, how are you?");
  assert.equal(last().status, "answered");
  assert.equal(motion.getState().status, "idle");
});

test("resume re-plans to the stopped target from the current pose", async () => {
  const { motion, ctl, last } = setup();
  await ctl.submit("Go to Griffey");
  for (let i = 0; i < 30; i++) motion.advance(0.05);
  ctl.stop();
  assert.equal(last().status, "stopped");
  ctl.resume();
  assert.equal(last().via, "resume");
  assert.equal(last().status, "moving");
  runToEnd(motion);
  assert.equal(last().status, "arrived");
});
