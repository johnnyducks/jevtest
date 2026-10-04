import assert from "node:assert/strict";
import { test } from "node:test";
import { cardById, DIMENSIONS, floorEnv } from "../environment.ts";
import { isFreePoint, segmentFree } from "../grid.ts";
import { planPath } from "../pathfinding.ts";
import { building, env, grid, grids } from "./helpers.ts";

const inflation = building.robotRadius + building.clearance;

test("the building is to spec: six 4 × 8 ft floors, 16 in apart, a 4 × 4.3 in robot, 2.5 × 3.5 in cards", () => {
  const IN = 0.0254;
  assert.equal(building.floors.length, 6);
  assert.ok(Math.abs(building.width - 96 * IN) < 1e-9 && Math.abs(building.height - 48 * IN) < 1e-9);
  assert.ok(Math.abs(building.floorHeight - 16 * IN) < 1e-9);
  assert.ok(Math.abs(DIMENSIONS.botWidth - 4 * IN) < 1e-9 && Math.abs(DIMENSIONS.botLength - 4.3 * IN) < 1e-9);
  assert.ok(Math.abs(DIMENSIONS.cardWidth - 2.5 * IN) < 1e-9 && Math.abs(DIMENSIONS.cardHeight - 3.5 * IN) < 1e-9);
  // The planner's footprint covers the robot turning in place (half its diagonal).
  assert.ok(building.robotRadius >= Math.hypot(DIMENSIONS.botWidth, DIMENSIONS.botLength) / 2 - 1e-4);
});

test("ramps are long and gentle: 16 in rise over 64 in, about 14°, and wide enough for the robot", () => {
  assert.equal(building.ramps.length, 5);
  for (const r of building.ramps) {
    const run = Math.hypot(r.top.x - r.foot.x, r.top.y - r.foot.y);
    const slope = (Math.atan2(building.floorHeight, run) * 180) / Math.PI;
    assert.ok(slope < 15, `${r.id}: ${slope.toFixed(1)}°`);
    assert.ok(r.lane.h >= 2 * inflation, `${r.id}: lane fits the robot with clearance`);
    // Lined up at the bottom, and room to drive off at the top.
    assert.ok(isFreePoint(grids(r.from), r.entry), `${r.id} entry`);
    assert.ok(isFreePoint(grids(r.to), r.exit), `${r.id} exit`);
  }
  // A switchback: consecutive ramps alternate sides.
  assert.notEqual(building.ramps[0].lane.y, building.ramps[1].lane.y);
});

test("every card's viewing spot, dock and ramp end is reachable on its floor (except the vault)", () => {
  for (const f of building.floors) {
    const e = floorEnv(building, f.level);
    const g = grids(f.level);
    assert.ok(isFreePoint(g, e.dock), `floor ${f.level} dock`);
    for (const c of e.cards) {
      const plan = planPath(g, e.dock, c.approach);
      if (c.id === "wagner-t206") assert.equal(plan.status, "no_path", "the vault is locked");
      else assert.equal(plan.status, "ok", `${c.id} on floor ${f.level}`);
    }
    for (const r of building.ramps) {
      if (r.from === f.level) assert.equal(planPath(g, e.dock, r.entry).status, "ok", `floor ${f.level} → ramp up`);
      if (r.to === f.level) assert.equal(planPath(g, e.dock, r.exit).status, "ok", `floor ${f.level} → ramp down`);
    }
  }
  assert.equal(building.cards.length, 35);
  assert.deepEqual(new Set(building.cards.map((c) => c.floor)), new Set([1, 2, 3, 4, 5, 6]));
});

test("routes on a floor are collision-free and detour around furniture", () => {
  const f2 = floorEnv(building, 2);
  const ripken = cardById(building, "ripken-82")!;
  const plan = planPath(grids(2), f2.dock, ripken.approach);
  assert.equal(plan.status, "ok");
  assert.ok(plan.detour, "the partition is in the way");
  for (let i = 1; i < plan.waypoints.length; i++) assert.ok(segmentFree(grids(2), plan.waypoints[i - 1], plan.waypoints[i]), `segment ${i}`);
  assert.deepEqual(plan.waypoints.at(-1), ripken.approach);
});

test("planning is deterministic", () => {
  const griffey = cardById(building, "griffey-89")!;
  assert.deepEqual(planPath(grid, env.defaultPose, griffey.approach), planPath(grid, env.defaultPose, griffey.approach));
});

test("goal or start inside an obstacle is reported, not routed", () => {
  const desk = { x: 1.05, y: 0.6 };
  assert.equal(planPath(grid, env.defaultPose, desk).status, "goal_blocked");
  assert.equal(planPath(grid, desk, env.dock).status, "start_blocked");
});
