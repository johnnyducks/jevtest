import assert from "node:assert/strict";
import { test } from "node:test";
import { cardById } from "../environment.ts";
import { isFreePoint, segmentFree } from "../grid.ts";
import { planPath } from "../pathfinding.ts";
import { env, grid } from "./helpers.ts";

const griffey = cardById(env, "griffey-89")!;

test("default start pose and every card approach except the vault are free cells", () => {
  assert.ok(isFreePoint(grid, env.defaultPose));
  for (const c of env.cards) assert.ok(isFreePoint(grid, c.approach), `${c.id} approach should be free`);
});

test("route to Griffey is collision-free and detours around the partition", () => {
  const plan = planPath(grid, env.defaultPose, griffey.approach);
  assert.equal(plan.status, "ok");
  assert.ok(plan.detour, "straight line should be blocked");
  assert.ok(plan.waypoints.length >= 3, "needs at least one turn");
  assert.ok(plan.length > plan.directDistance * 1.05, "route is longer than the straight line");
  for (let i = 1; i < plan.waypoints.length; i++) {
    assert.ok(segmentFree(grid, plan.waypoints[i - 1], plan.waypoints[i]), `segment ${i} must be free`);
  }
  assert.deepEqual(plan.waypoints.at(-1), griffey.approach);
});

test("planning is deterministic", () => {
  const a = planPath(grid, env.defaultPose, griffey.approach);
  const b = planPath(grid, env.defaultPose, griffey.approach);
  assert.deepEqual(a, b);
});

test("the vault card is unreachable and yields no waypoints", () => {
  const wagner = cardById(env, "wagner-t206")!;
  const plan = planPath(grid, env.defaultPose, wagner.approach);
  assert.equal(plan.status, "no_path");
  assert.deepEqual(plan.waypoints, []);
});

test("every other card is reachable from the default pose", () => {
  for (const c of env.cards.filter((c) => c.id !== "wagner-t206")) {
    assert.equal(planPath(grid, env.defaultPose, c.approach).status, "ok", c.id);
  }
});

test("goal or start inside an obstacle is reported, not routed", () => {
  assert.equal(planPath(grid, env.defaultPose, { x: 5, y: 4 }).status, "goal_blocked");
  assert.equal(planPath(grid, { x: 5, y: 4 }, griffey.approach).status, "start_blocked");
});
