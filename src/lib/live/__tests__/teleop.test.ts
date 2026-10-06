import assert from "node:assert/strict";
import test from "node:test";
import { floorEnv } from "../../twin/environment.ts";
import { buildGrid, isFreePoint } from "../../twin/grid.ts";
import { keysToDrive } from "../../twin/teleop.ts";
import { TELEOP_DEADMAN_MS } from "../session.ts";
import { building, fakeJev, makeSession, martyLines, systemLines } from "./helpers.ts";

const SPEED = 0.18; // DEFAULT_PARAMS.speed, m/s

/** A session plus a driver that behaves like the browser: repeats the held command every 200 ms. */
function driver(opts: Parameters<typeof makeSession>[0] = {}) {
  const m = makeSession(opts);
  const press = (...keys: string[]) => m.s.operator({ action: "drive", ...keysToDrive(keys.filter((k) => k !== "Shift"), keys.includes("Shift")) });
  const hold = async (seconds: number, ...keys: string[]) => {
    for (let ms = 0; ms < seconds * 1000; ms += 100) {
      if (ms % 200 === 0) assert.equal(press(...keys).ok, true);
      m.clock.t += 100;
      m.s.tick(m.clock.t);
      await m.s.settle();
    }
  };
  const release = () => m.s.operator({ action: "drive", forward: 0, strafe: 0, rotate: 0 });
  const pose = () => m.s.motion.getState().pose;
  return { ...m, press, hold, release, pose };
}

test("W drives forward; letting go stops right there", async () => {
  const d = driver();
  const start = { ...d.pose() }; // floor 1, facing east
  await d.hold(1, "KeyW");
  const tel = d.s.snapshot().telemetry;
  assert.equal(tel.manual, true);
  assert.equal(tel.status, "moving");
  assert.ok(Math.abs(d.pose().x - start.x - SPEED) < 0.005, `moved ${d.pose().x - start.x} m`);
  assert.ok(Math.abs(d.pose().y - start.y) < 1e-9, "straight ahead");
  assert.ok(tel.battery.level < 100, "drains by the distance driven");
  assert.ok(Math.abs(tel.metersDriven - SPEED) < 0.005);

  assert.equal(d.release().ok, true);
  const stopped = { ...d.pose() };
  await d.run(1);
  assert.deepEqual(d.pose(), stopped);
  assert.equal(d.s.snapshot().telemetry.manual, false);
  assert.equal(d.s.snapshot().telemetry.status, "stopped");
});

test("S backs up, A and D strafe without turning", async () => {
  const d = driver();
  d.s.operator({ action: "place", x: 1.2, y: 0.6 });
  const start = { ...d.pose() };
  await d.hold(0.5, "KeyS");
  assert.ok(d.pose().x < start.x - 0.08, "backward");
  d.release();
  const a = { ...d.pose() };
  await d.hold(0.5, "KeyA");
  assert.ok(d.pose().y > a.y + 0.08, "A: left of an east-facing Marty is north");
  assert.ok(Math.abs(d.pose().x - a.x) < 1e-9);
  d.release();
  const b = { ...d.pose() };
  await d.hold(0.5, "KeyD");
  assert.ok(d.pose().y < b.y - 0.08, "D: right is south");
  assert.equal(d.pose().heading, start.heading, "strafing never turns");
});

test("W+D goes diagonally, no faster than straight ahead", async () => {
  const d = driver();
  d.s.operator({ action: "place", x: 1.2, y: 0.6 });
  const start = { ...d.pose() };
  await d.hold(1, "KeyW", "KeyD");
  const dx = d.pose().x - start.x;
  const dy = d.pose().y - start.y;
  assert.ok(Math.abs(Math.hypot(dx, dy) - SPEED) < 0.005, `diagonal covered ${Math.hypot(dx, dy)} m in 1 s`);
  assert.ok(Math.abs(dx + dy) < 1e-6 && dx > 0, "45° forward-right");
});

test("W+E drives forward while turning right; Q alone turns in place", async () => {
  const d = driver();
  d.s.operator({ action: "place", x: 1.2, y: 0.6 });
  const start = { ...d.pose() };
  await d.hold(1, "KeyW", "KeyE");
  assert.ok(d.pose().heading < start.heading - 1, "turned clockwise about a quarter turn");
  assert.ok(Math.abs(d.s.snapshot().telemetry.metersDriven - SPEED) < 0.005, "full forward speed while turning");
  assert.ok(d.pose().y < start.y, "the arc bends to the right");
  d.release();
  const here = { ...d.pose() };
  await d.hold(0.5, "KeyQ");
  assert.equal(d.pose().x, here.x);
  assert.equal(d.pose().y, here.y);
  assert.ok(d.pose().heading > here.heading + 0.7, "counterclockwise");
});

test("Shift is precision mode: about a quarter of the speed", async () => {
  const d = driver();
  const start = d.pose().x;
  await d.hold(1, "KeyW", "Shift");
  assert.ok(Math.abs(d.pose().x - start - SPEED * 0.25) < 0.003, `moved ${d.pose().x - start} m`);
});

test("deadman: if the driver's browser goes quiet, Marty stops on his own", async () => {
  const d = driver();
  const start = d.pose().x;
  d.press("KeyW"); // never repeated: tab closed, connection lost
  await d.run(2);
  assert.equal(d.s.snapshot().telemetry.manual, false);
  assert.equal(d.s.motion.getState().status, "stopped");
  const went = d.pose().x - start;
  assert.ok(went <= (SPEED * (TELEOP_DEADMAN_MS + 100)) / 1000 + 1e-6, `drove ${went} m after the last command`);
});

test("driving can't go through walls or furniture: Marty slides along and stays clear", async () => {
  const d = driver();
  const grid = buildGrid(floorEnv(building, 1));
  for (const keys of [["KeyA"], ["KeyW", "KeyD"], ["KeyS"], ["KeyW"], ["KeyW", "KeyA", "KeyQ"]]) {
    await d.hold(4, ...keys);
    assert.ok(isFreePoint(grid, d.pose()), `${keys.join("+")} ended at a free spot`);
  }
  assert.equal(d.s.snapshot().telemetry.floor, 1, "ramps are off limits: he stays on his floor");
});

test("taking the wheel stops a trip like an operator stop, and Resume picks it up again", async () => {
  const d = driver();
  d.s.post("amy", "go to griffey");
  await d.run(1.2);
  assert.equal(d.s.snapshot().trip!.status, "running");
  await d.hold(0.4, "KeyQ");
  assert.equal(d.s.snapshot().trip!.status, "stopped");
  assert.ok(systemLines(d.s).some((l) => /Stopped: an operator took manual control/.test(l)));
  d.release();
  assert.equal(d.s.operator({ action: "resume" }).ok, true);
  await d.run(60);
  assert.equal(d.s.snapshot().trip!.status, "done");
});

test("while someone drives, Jev's decisions don't move Marty", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const inner = fakeJev();
  const d = driver({
    evaluate: async (req) => {
      await gate;
      return inner.evaluate(req);
    },
  });
  d.s.post("amy", "go to griffey");
  d.clock.t += 1100;
  d.s.tick(d.clock.t); // batch sent to Jev
  const driving = d.hold(1, "KeyW");
  release();
  await driving;
  assert.equal(d.s.snapshot().trip, null);
  assert.match(martyLines(d.s).join(" "), /driving Marty by hand|operator stopped Marty while Jev was deciding/);
});

test("Space (operator stop) ends manual driving; a release never stops someone else's trip", async () => {
  const d = driver();
  await d.hold(0.4, "KeyW");
  assert.equal(d.s.operator({ action: "stop" }).ok, true);
  assert.equal(d.s.snapshot().telemetry.manual, false);
  const here = { ...d.pose() };
  await d.run(1);
  assert.deepEqual(d.pose(), here);

  d.s.post("bob", "go to griffey");
  await d.run(1.2);
  assert.equal(d.release().message, "Marty wasn't being driven.");
  await d.run(0.5);
  assert.equal(d.s.snapshot().trip!.status, "running");
});

test("can't drive on an empty battery", async () => {
  const d = driver();
  d.s.operator({ action: "battery", level: 0 });
  const r = d.press("KeyW");
  assert.equal(r.ok, false);
  assert.match(r.message, /Battery empty/);
});
