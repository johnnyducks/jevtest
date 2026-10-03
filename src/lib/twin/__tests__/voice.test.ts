import assert from "node:assert/strict";
import { test } from "node:test";
import { afterLine, builtInReply, outcomeOf } from "../../voice/lines.ts";
import { TwinController } from "../controller.ts";
import { env, fakeDecision, grid, newMotion, runToEnd } from "./helpers.ts";

const names = env.cards.map((c) => c.name);

function setup() {
  const motion = newMotion();
  const ctl = new TwinController({ env, grid, motion, decide: async () => fakeDecision("navigate_card"), now: () => 0 });
  return { motion, ctl, last: () => ctl.getState().missions.at(-1)! };
}

test("no reply while still thinking; moving outcome carries target and route", async () => {
  const { ctl, last } = setup();
  const p = ctl.submit("Go to Griffey");
  assert.equal(outcomeOf(last()), null, "interpreting has nothing to report yet");
  await p;
  const o = outcomeOf(last())!;
  assert.equal(o.status, "moving");
  assert.equal(o.target, "Ken Griffey Jr.");
  assert.ok(o.routeMeters! > 0 && o.detour);
  const line = builtInReply(o, names);
  assert.match(line, /Ken Griffey Jr\./);
  assert.doesNotMatch(line, /arrived|made it/i, "never claims arrival while moving");
});

test("clarification reply names every option", async () => {
  const { ctl, last } = setup();
  await ctl.submit("Go to Bonds");
  const o = outcomeOf(last())!;
  assert.equal(o.status, "needs_clarification");
  const line = builtInReply(o, names);
  assert.match(line, /Barry Bonds/);
  assert.match(line, /Bobby Bonds/);
});

test("arrival follow-up only after the mission really arrives", async () => {
  const { motion, ctl, last } = setup();
  await ctl.submit("Go to Ripken");
  assert.equal(afterLine(last().status, last().target?.name, last().seq), null);
  runToEnd(motion);
  assert.match(afterLine(last().status, last().target?.name, last().seq)!, /Cal Ripken Jr\./);
});

test("unreachable target reply does not pretend to go", async () => {
  const { ctl, last } = setup();
  await ctl.submit("Go to Honus Wagner");
  const o = outcomeOf(last())!;
  assert.equal(o.status, "no_route");
  assert.doesNotMatch(builtInReply(o, names), /on my way|off to|arrived/i);
});
