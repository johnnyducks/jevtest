import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PARAMS, type MotionState, SimulatedMotion, step } from "../motion.ts";
import { env, manualScheduler, newMotion, runToEnd } from "./helpers.ts";

const path = [
  { x: 1, y: 1 },
  { x: 3, y: 1 },
  { x: 3, y: 3 },
];

test("step() follows the path, turns at corners and arrives", () => {
  let s: MotionState = { pose: { x: 1, y: 1, heading: 0 }, status: "moving", path, waypoint: 1, missionId: "t", travelled: 0, face: null, source: "simulated" };
  let maxHeading = 0;
  for (let i = 0; i < 2000 && s.status === "moving"; i++) {
    s = step(s, 0.05, DEFAULT_PARAMS);
    maxHeading = Math.max(maxHeading, s.pose.heading);
  }
  assert.equal(s.status, "arrived");
  assert.ok(Math.abs(s.pose.x - 3) < 1e-6 && Math.abs(s.pose.y - 3) < 1e-6);
  assert.ok(Math.abs(maxHeading - Math.PI / 2) < 0.01, "turned to face north");
  assert.ok(Math.abs(s.travelled - 4) < 1e-6);
});

test("stop() halts immediately and later advances do nothing", () => {
  const m = newMotion();
  m.setPose({ x: 1, y: 1, heading: 0 });
  m.follow(path, "t");
  for (let i = 0; i < 20; i++) m.advance(0.05);
  m.stop();
  const frozen = m.getState().pose;
  assert.equal(m.getState().status, "stopped");
  for (let i = 0; i < 20; i++) m.advance(0.05);
  assert.deepEqual(m.getState().pose, frozen);
});

test("a stale animation frame from a cancelled run cannot move the robot", () => {
  const callbacks: ((now: number) => void)[] = [];
  let clock = 0;
  const m = new SimulatedMotion(env.defaultPose, { request: (cb) => callbacks.push(cb), cancel: () => {}, now: () => clock });
  m.setPose({ x: 1, y: 1, heading: 0 });
  m.follow(path, "a");
  const staleFrame = callbacks[0];
  m.stop();
  const frozen = m.getState().pose;
  clock = 500;
  staleFrame(500); // fires after cancellation
  assert.deepEqual(m.getState().pose, frozen);
  assert.equal(m.getState().status, "stopped");
});

test("follow() on a new path replaces the old one from the current pose", () => {
  const m = newMotion();
  m.setPose({ x: 1, y: 1, heading: 0 });
  m.follow(path, "a");
  for (let i = 0; i < 10; i++) m.advance(0.05);
  const here = m.getState().pose;
  m.follow([{ x: here.x, y: here.y }, { x: here.x, y: here.y + 1 }], "b");
  runToEnd(m);
  assert.equal(m.getState().missionId, "b");
  assert.equal(m.getState().status, "arrived");
  assert.ok(Math.abs(m.getState().pose.y - (here.y + 1)) < 1e-6);
  void manualScheduler;
});
