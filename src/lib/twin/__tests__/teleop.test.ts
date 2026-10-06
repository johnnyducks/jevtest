import assert from "node:assert/strict";
import test from "node:test";
import { driveStep, keysToDrive, normalizeDrive, PRECISION } from "../teleop.ts";

const open = () => true;
const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ""} ${a} ≈ ${b}`);

test("each key sets one axis of the command", () => {
  assert.deepEqual(keysToDrive(["KeyW"]), { forward: 1, strafe: 0, rotate: 0 });
  assert.deepEqual(keysToDrive(["KeyS"]), { forward: -1, strafe: 0, rotate: 0 });
  assert.deepEqual(keysToDrive(["KeyA"]), { forward: 0, strafe: -1, rotate: 0 });
  assert.deepEqual(keysToDrive(["KeyD"]), { forward: 0, strafe: 1, rotate: 0 });
  assert.deepEqual(keysToDrive(["KeyQ"]), { forward: 0, strafe: 0, rotate: 1 });
  assert.deepEqual(keysToDrive(["KeyE"]), { forward: 0, strafe: 0, rotate: -1 });
  assert.deepEqual(keysToDrive([]), { forward: 0, strafe: 0, rotate: 0 });
  assert.deepEqual(keysToDrive(["KeyX", "Space"]), { forward: 0, strafe: 0, rotate: 0 }, "other keys do nothing");
});

test("opposite keys cancel", () => {
  assert.deepEqual(keysToDrive(["KeyW", "KeyS"]), { forward: 0, strafe: 0, rotate: 0 });
  assert.deepEqual(keysToDrive(["KeyQ", "KeyE", "KeyW"]), { forward: 1, strafe: 0, rotate: 0 });
});

test("W+D is a diagonal at the same speed as straight ahead", () => {
  const c = keysToDrive(["KeyW", "KeyD"]);
  near(c.forward, Math.SQRT1_2);
  near(c.strafe, Math.SQRT1_2);
  near(Math.hypot(c.forward, c.strafe), 1, "unit speed");
});

test("W+E drives forward while rotating, both at full rate", () => {
  assert.deepEqual(keysToDrive(["KeyW", "KeyE"]), { forward: 1, strafe: 0, rotate: -1 });
});

test("Shift scales everything to precision speed (about 25%)", () => {
  assert.deepEqual(keysToDrive(["KeyW"], true), { forward: PRECISION, strafe: 0, rotate: 0 });
  const d = keysToDrive(["KeyS", "KeyA", "KeyQ"], true);
  near(Math.hypot(d.forward, d.strafe), PRECISION);
  near(d.rotate, PRECISION);
});

test("normalizeDrive clamps hostile or broken input", () => {
  assert.deepEqual(normalizeDrive({ forward: 5, strafe: 0, rotate: -9 }), { forward: 1, strafe: 0, rotate: -1 });
  assert.deepEqual(normalizeDrive({ forward: NaN, strafe: Infinity, rotate: 0.5 }), { forward: 0, strafe: 0, rotate: 0.5 });
  const n = normalizeDrive({ forward: 1, strafe: 1, rotate: 0 });
  near(Math.hypot(n.forward, n.strafe), 1);
});

test("driveStep moves in Marty's own frame: forward, strafe right/left, any heading", () => {
  const speed = 0.2;
  const turn = Math.PI / 2;
  // Facing east (+x): forward goes east, right is south (−y), left is north.
  let p = driveStep({ x: 1, y: 1, heading: 0 }, { forward: 1, strafe: 0, rotate: 0 }, 1, speed, turn, open);
  near(p.x, 1.2);
  near(p.y, 1);
  p = driveStep({ x: 1, y: 1, heading: 0 }, { forward: 0, strafe: 1, rotate: 0 }, 1, speed, turn, open);
  near(p.x, 1);
  near(p.y, 0.8, "D strafes to the right");
  p = driveStep({ x: 1, y: 1, heading: 0 }, { forward: 0, strafe: -1, rotate: 0 }, 1, speed, turn, open);
  near(p.y, 1.2, "A strafes to the left");
  // Facing north: right is east.
  p = driveStep({ x: 1, y: 1, heading: Math.PI / 2 }, { forward: 0, strafe: 1, rotate: 0 }, 1, speed, turn, open);
  near(p.x, 1.2);
  near(p.y, 1);
  near(p.heading, Math.PI / 2, "strafing never turns");
});

test("driveStep: diagonal covers the same distance as straight; rotation is counterclockwise for Q", () => {
  const diag = driveStep({ x: 1, y: 1, heading: 0 }, keysToDrive(["KeyW", "KeyD"]), 1, 0.2, Math.PI / 2, open);
  near(Math.hypot(diag.x - 1, diag.y - 1), 0.2);
  const q = driveStep({ x: 1, y: 1, heading: 0 }, keysToDrive(["KeyQ"]), 0.5, 0.2, Math.PI / 2, open);
  near(q.heading, Math.PI / 4);
  assert.equal(q.x, 1, "rotation alone stays put");
  const e = driveStep({ x: 1, y: 1, heading: 0 }, keysToDrive(["KeyE"]), 0.5, 0.2, Math.PI / 2, open);
  near(e.heading, -Math.PI / 4);
});

test("driveStep: blocked moves slide along the free axis, or stay put", () => {
  // A wall at x = 1.05: driving north-east slides north along it.
  const wall = (_a: { x: number; y: number }, b: { x: number; y: number }) => b.x <= 1.05;
  const p = driveStep({ x: 1, y: 1, heading: Math.PI / 4 }, { forward: 1, strafe: 0, rotate: 0 }, 1, 0.2, 1, wall);
  near(p.x, 1);
  assert.ok(p.y > 1.1, "slid north");
  // Head-on: nowhere to go, but the turn still happens.
  const q = driveStep({ x: 1, y: 1, heading: 0 }, { forward: 1, strafe: 0, rotate: 1 }, 0.5, 0.2, 1, wall);
  assert.equal(q.x, 1);
  assert.equal(q.y, 1);
  near(q.heading, 0.5);
});
