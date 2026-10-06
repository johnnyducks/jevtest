import assert from "node:assert/strict";
import test from "node:test";
import { BUILDING, DIMENSIONS } from "../environment.ts";
import { fitsLane, floorAt, rampSpot, rampTilt } from "../ramps.ts";
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

const r12 = BUILDING.ramps.find((r) => r.from === 1)!; // south wall, climbing east

test("rampSpot: height follows the incline; each floor only sees its own end of a ramp", () => {
  const mid = { x: (r12.foot.x + r12.top.x) / 2, y: r12.foot.y };
  near(rampSpot(BUILDING, 1, r12.foot)!.level, 1);
  near(rampSpot(BUILDING, 1.4, mid)!.level, 1.5);
  near(rampSpot(BUILDING, 2, r12.top)!.level, 2);
  assert.ok(rampSpot(BUILDING, 1, r12.entry), "floor 1: the line-up zone counts");
  assert.equal(rampSpot(BUILDING, 2, r12.entry), null, "floor 2 above floor 1's line-up zone is just floor");
  assert.equal(rampSpot(BUILDING, 1, r12.exit), null, "floor 1 under the top's line-up zone is just floor");
  assert.equal(rampSpot(BUILDING, 1.5, { x: mid.x, y: r12.lane.y + r12.lane.h + 0.01 }), null, "beside the lane");
  assert.equal(floorAt(r12, 1.49), 1);
  assert.equal(floorAt(r12, 1.5), 2);
});

test("fitsLane: a 4 in robot fits the 7.5 in lane at any heading when centred, not against the rail", () => {
  for (const h of [0, 0.4, Math.PI / 4, Math.PI / 2, 2, Math.PI]) assert.ok(fitsLane(r12, { ...r12.foot, heading: h }), `heading ${h}`);
  const offset = { x: r12.foot.x, y: r12.foot.y + 0.03, heading: 0 };
  assert.ok(fitsLane(r12, offset), "side-shifted, facing along the lane");
  assert.equal(fitsLane(r12, { ...offset, heading: Math.PI / 4 }), false, "side-shifted and turned: would hit the rail");
});

test("rampTilt: nose up facing uphill, down facing downhill, rolled side-on", () => {
  const a = Math.atan2(DIMENSIONS.floorHeight, DIMENSIONS.rampLength);
  near(rampTilt(r12, 0).pitch, a);
  near(rampTilt(r12, Math.PI).pitch, -a);
  near(rampTilt(r12, Math.PI / 2).roll, a, "facing north, uphill (east) is on his right");
  assert.ok(Math.abs(rampTilt(r12, Math.PI / 2).pitch) < 1e-9);
});
