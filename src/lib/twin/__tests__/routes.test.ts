import assert from "node:assert/strict";
import test from "node:test";
import { Battery, BATTERY } from "../battery.ts";
import { floorEnv } from "../environment.ts";
import { editDistance } from "../fuzzy.ts";
import { resolveCardByName } from "../resolve.ts";
import { type FloorPose, parseFloor, parseRequest, planRoute, splitStops } from "../routes.ts";
import { building, grids } from "./helpers.ts";

const opts = { speed: 0.18, turnRate: Math.PI / 2 };
const from: FloorPose = { ...building.defaultPose, floor: 1 };
const plan = (text: string, start: FloorPose = from) => planRoute(building, grids, start, parseRequest(building, text).stops, opts);

test("typos resolve to the closest card name; ties stay ambiguous", () => {
  const cases: [string, string][] = [
    ["go to heanderson", "henderson-80"],
    ["grifey please", "griffey-89"],
    ["mantel", "mantle-52"],
    ["ichrio", "ichiro-01"],
    ["riplen", "ripken-82"],
    ["jackie robinsn", "robinson-52"],
    ["dimagio", "dimaggio-41"],
    ["kofax", "koufax-55"],
  ];
  for (const [text, id] of cases) {
    const r = resolveCardByName(building, text);
    assert.equal(r.status === "resolved" && r.target.id, id, text);
  }
  const r = resolveCardByName(building, "heanderson");
  assert.equal(r.status === "resolved" && r.matched, "heanderson → henderson");
  assert.equal(resolveCardByName(building, "bands").status, "ambiguous", "bonds: Barry or Bobby");
  assert.equal(editDistance("heanderson", "henderson"), 1);
});

test("floors by number, ordinal, name or direction", () => {
  assert.deepEqual(parseFloor("go to the 3rd floor", 6), { floor: 3 });
  assert.deepEqual(parseFloor("floor five", 6), { floor: 5 });
  assert.deepEqual(parseFloor("take me to the second floor", 6), { floor: 2 });
  assert.deepEqual(parseFloor("top floor please", 6), { floor: 6 });
  assert.deepEqual(parseFloor("back to the lobby", 6), { floor: 1 });
  assert.deepEqual(parseFloor("the vault", 6), { floor: 6 });
  assert.deepEqual(parseFloor("go upstairs", 6), { rel: 1 });
  assert.deepEqual(parseFloor("head downstairs", 6), { rel: -1 });
  // "lobby" is one letter from "bobby", but a floor name beats a typo guess.
  assert.equal(parseRequest(building, "lobby").stops[0].kind, "floor");
});

test("multi-stop requests split on commas, then, and, arrows", () => {
  assert.equal(splitStops("go to ripken, then bonds, then mantle").length, 3);
  assert.equal(splitStops("griffey and then ichiro -> rose").length, 3);
  const p = parseRequest(building, "go to ripken, then barry bonds, then mantle");
  assert.deepEqual(p.stops.map((s) => (s.kind === "card" ? s.card.id : s.kind)), ["ripken-82", "barry-bonds-87", "mantle-52"]);
  assert.deepEqual(p.issues, []);
});

test("cards on other floors: Marty takes the ramps, one floor at a time, and squares up to each card", () => {
  const r = plan("ripken, then mantle");
  assert.equal(r.ok, true);
  assert.equal(r.summary, "Cal Ripken Jr. → Mickey Mantle");
  const ramps = r.legs.filter((l) => l.kind === "ramp");
  // Floor 1 → 2 for Ripken, then 2 → 5 for Mantle.
  assert.deepEqual(
    ramps.map((l) => (l.kind === "ramp" ? `${l.from}→${l.to}` : "")),
    ["1→2", "2→3", "3→4", "4→5"],
  );
  assert.equal(r.endFloor, 5);
  for (const l of r.legs) if (l.kind === "drive" && l.stop?.cardId) assert.ok(l.face !== undefined, "faces the card");
  // Every drive leg happens on the floor Marty is on at the time.
  let floor = 1;
  for (const l of r.legs) {
    if (l.kind === "ramp") {
      assert.equal(l.from, floor);
      floor = l.to;
    } else assert.equal(l.floor, floor);
  }
});

test("estimates add up: distance, turning and climbing", () => {
  const r = plan("go to the 3rd floor");
  assert.equal(r.ok, true);
  const moving = r.legs.filter((l) => l.kind !== "dwell");
  const meters = moving.reduce((a, l) => a + (l.kind === "drive" || l.kind === "ramp" ? l.meters : 0), 0);
  assert.ok(Math.abs(r.meters - meters) < 0.002);
  const climbed = 2 * Math.hypot(building.ramps[0].top.x - building.ramps[0].foot.x, 0);
  const expect = r.meters * BATTERY.perMeter + r.turnRad * BATTERY.perRadian + climbed * BATTERY.climbPerMeter;
  assert.ok(Math.abs(r.battery - expect) < 0.05, `${r.battery} vs ${expect}`);
  // Each floor up costs several percent: going up is a real decision.
  const perFloor = r.battery / 2;
  assert.ok(perFloor > 5, `~${perFloor.toFixed(1)}% per floor`);
  // Home is that floor's own dock, not the lobby's.
  assert.ok(r.homeBattery < 5);
});

test("upstairs / downstairs are relative; no floors outside 1–6", () => {
  const up = plan("upstairs");
  assert.equal(up.ok, true);
  assert.equal(up.endFloor, 2);
  const down = plan("downstairs", { ...floorEnv(building, 3).defaultPose, x: 0.13, y: 0.5, floor: 3 });
  assert.equal(down.endFloor, 2);
  assert.match(plan("downstairs").issue!, /ground floor/);
  assert.match(plan("floor 7").issue ?? "", /no floor 7|floor/i);
});

test("go around furniture on the current floor: a closed loop that stays clear of it", () => {
  const r = plan("go around the welcome desk");
  assert.equal(r.ok, true);
  const desk = floorEnv(building, 1).obstacles.find((o) => o.id === "f1-desk")!;
  assert.ok(r.meters > 2 * (desk.w + desk.h), "longer than the desk's perimeter");
  for (const l of r.legs) {
    if (l.kind !== "drive") continue;
    for (const pt of l.path) assert.equal(pt.x > desk.x && pt.x < desk.x + desk.w && pt.y > desk.y && pt.y < desk.y + desk.h, false);
  }
  assert.match(plan("go around the gallery case").issue ?? "", /no gallery case on floor 1/);
});

test("unreachable stops fail the plan with a reason", () => {
  const r = plan("griffey then wagner");
  assert.equal(r.ok, false);
  assert.match(r.issue!, /Honus Wagner is unreachable/);
});

test("battery drains by measured distance and turning, and charges at the dock", () => {
  const b = new Battery(100);
  b.resync({ x: 0.2, y: 0.5, heading: 0 });
  for (let i = 1; i <= 100; i++) b.observe({ x: 0.2 + i * 0.02, y: 0.5, heading: 0 }); // 2 m straight
  assert.ok(Math.abs(b.level - (100 - 2 * BATTERY.perMeter)) < 1e-9);
  assert.ok(Math.abs(b.metersDriven - 2) < 1e-9);
  const before = b.level;
  assert.equal(b.charge({ x: 2.2, y: 0.5 }, { x: 0.13, y: 0.5 }, 1, false), false, "not at the dock");
  assert.equal(b.charge({ x: 0.13, y: 0.5 }, { x: 0.13, y: 0.5 }, 2, false), true);
  assert.equal(b.level, before + 2 * BATTERY.chargePerSecond);
  b.set(40);
  assert.equal(b.range, (40 - BATTERY.reserve) / BATTERY.perMeter);
});
