import assert from "node:assert/strict";
import test from "node:test";
import { Battery, BATTERY } from "../battery.ts";
import { editDistance } from "../fuzzy.ts";
import { resolveCardByName } from "../resolve.ts";
import { parseRequest, planRoute, splitStops } from "../routes.ts";
import { env, grid } from "./helpers.ts";

const opts = { speed: 0.6, turnRate: Math.PI };
const from = env.defaultPose;

test("typos resolve to the closest card name; ties stay ambiguous", () => {
  const cases: [string, string][] = [
    ["go to heanderson", "henderson-80"],
    ["grifey please", "griffey-89"],
    ["mantel", "mantle-52"],
    ["ichrio", "ichiro-01"],
    ["riplen", "ripken-82"],
    ["jackie robinsn", "robinson-52"],
  ];
  for (const [text, id] of cases) {
    const r = resolveCardByName(env, text);
    assert.equal(r.status === "resolved" && r.target.id, id, text);
  }
  const r = resolveCardByName(env, "heanderson");
  assert.equal(r.status === "resolved" && r.method, "fuzzy match");
  assert.equal(r.status === "resolved" && r.matched, "heanderson → henderson");
  assert.equal(resolveCardByName(env, "bands").status, "ambiguous", "bonds: Barry or Bobby");
  assert.equal(resolveCardByName(env, "go to the kitchen").status, "not_found");
  assert.equal(editDistance("heanderson", "henderson"), 1);
});

test("multi-stop requests split on commas, then, and", () => {
  assert.deepEqual(splitStops("go to ripken, then bonds, then mantle").length, 3);
  assert.deepEqual(splitStops("griffey and then ichiro -> rose").length, 3);
  const p = parseRequest(env, "go to ripken, then barry bonds, then mantle");
  assert.deepEqual(p.stops.map((s) => (s.kind === "card" ? s.card.id : s.kind)), ["ripken-82", "barry-bonds-87", "mantle-52"]);
  assert.deepEqual(p.issues, []);
});

test("multi-stop plan: legs in order, distance, time and battery add up", () => {
  const p = parseRequest(env, "ripken, then barry bonds, then mantle");
  const plan = planRoute(env, grid, from, p.stops, opts);
  assert.equal(plan.ok, true);
  assert.equal(plan.summary, "Cal Ripken Jr. → Barry Bonds → Mickey Mantle");
  const drives = plan.legs.filter((l) => l.kind === "drive");
  assert.equal(drives.length, 3);
  const meters = drives.reduce((a, l) => a + (l.kind === "drive" ? l.meters : 0), 0);
  assert.ok(Math.abs(plan.meters - meters) < 0.01);
  assert.ok(Math.abs(plan.battery - (plan.meters * BATTERY.perMeter + plan.turnRad * BATTERY.perRadian)) < 0.02);
  assert.ok(plan.homeBattery > 0, "includes the way home");
});

test("go around the display table: a closed loop that stays clear of it", () => {
  const p = parseRequest(env, "go around the display table");
  assert.equal(p.stops[0].kind, "around");
  const plan = planRoute(env, grid, from, p.stops, opts);
  assert.equal(plan.ok, true);
  const table = env.obstacles.find((o) => o.id === "table")!;
  assert.ok(plan.meters > 2 * (table.w + table.h), "longer than the table's perimeter");
  const path = plan.legs.flatMap((l) => (l.kind === "drive" ? l.path : []));
  for (const pt of path) {
    const inside = pt.x > table.x && pt.x < table.x + table.w && pt.y > table.y && pt.y < table.y + table.h;
    assert.equal(inside, false);
  }
});

test("going upstairs costs the climb on top of the drive", () => {
  const plan = planRoute(env, grid, from, parseRequest(env, "go upstairs").stops, opts);
  const mezz = env.special[0];
  assert.equal(plan.ok, true);
  assert.ok(plan.battery >= mezz.extraBattery);
  assert.ok(plan.seconds >= mezz.extraSeconds);
});

test("unreachable stops fail the plan with a reason", () => {
  const plan = planRoute(env, grid, from, parseRequest(env, "griffey then wagner").stops, opts);
  assert.equal(plan.ok, false);
  assert.match(plan.issue!, /Honus Wagner is unreachable/);
});

test("battery drains by measured distance and turning, and charges at the dock", () => {
  const b = new Battery(100);
  b.resync({ x: 1, y: 1, heading: 0 });
  for (let i = 1; i <= 100; i++) b.observe({ x: 1 + i * 0.1, y: 1, heading: 0 }); // 10 m straight
  assert.ok(Math.abs(b.level - (100 - 10 * BATTERY.perMeter)) < 1e-9);
  assert.ok(Math.abs(b.metersDriven - 10) < 1e-9);
  b.observe({ x: 11, y: 1, heading: Math.PI / 2 });
  assert.ok(Math.abs(b.level - (94 - (Math.PI / 2) * BATTERY.perRadian)) < 1e-9);
  assert.equal(b.charge({ x: 11, y: 1 }, { x: 0.9, y: 0.9 }, 1, false), false, "not at the dock");
  const before = b.level;
  assert.equal(b.charge({ x: 0.9, y: 0.9 }, { x: 0.9, y: 0.9 }, 2, false), true);
  assert.equal(b.level, before + 2 * BATTERY.chargePerSecond);
  b.set(40);
  assert.equal(b.range, (40 - BATTERY.reserve) / BATTERY.perMeter);
});
