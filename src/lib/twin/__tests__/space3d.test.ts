import assert from "node:assert/strict";
import test from "node:test";
import { makeTransform } from "../geometry.ts";
import { planPath } from "../pathfinding.ts";
import { CARD_SIZE, cardPlacement, forward, fpvCamera, fromScene, MARTY, obstacleBox, surfaceHeight, toScene } from "../space3d.ts";
import { floorEnv } from "../environment.ts";
import { building, env, grid, grids, newMotion } from "./helpers.ts";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

test("world ↔ scene mapping round-trips and keeps the 2D map's orientation", () => {
  for (const p of [{ x: 0, y: 0 }, { x: 1.3, y: 0.7 }, { x: env.width, y: env.height }]) {
    const back = fromScene(toScene(p, 0.5));
    assert.ok(close(back.x, p.x) && close(back.y, p.y));
  }
  // North is up on the 2D map (smaller screen y) and away from the observer (−Z) in 3D.
  const v = makeTransform(env.width, env.height);
  const a = { x: 1, y: 0.3 };
  const b = { x: 1, y: 0.9 };
  assert.ok(v.toScreen(b).y < v.toScreen(a).y);
  assert.ok(toScene(b)[2] < toScene(a)[2]);
  // East is right in both.
  assert.ok(toScene({ x: 6, y: 0 })[0] > toScene({ x: 2, y: 0 })[0]);
});

test("FPV camera sits on Marty, at lens height, looking along his heading", () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, -2.3]) {
    const pose = { x: 1.42, y: 0.66, heading };
    const cam = fpvCamera(pose);
    const at = fromScene(cam.position);
    assert.ok(close(at.x, pose.x + Math.cos(heading) * MARTY.camForward));
    assert.ok(close(at.y, pose.y + Math.sin(heading) * MARTY.camForward));
    assert.equal(cam.position[1], MARTY.camHeight);
    const look = fromScene(cam.target);
    const yaw = Math.atan2(look.y - at.y, look.x - at.x);
    assert.ok(close(Math.cos(yaw), Math.cos(heading)) && close(Math.sin(yaw), Math.sin(heading)), `heading ${heading}`);
    assert.ok(cam.target[1] > cam.position[1], "tilted slightly up, toward the cards");
  }
});

test("while the simulation drives, the FPV camera follows the same poses the 2D map draws", () => {
  const m = newMotion();
  const plan = planPath(grid, m.getState().pose, { x: 2.0, y: 0.95 });
  m.follow(plan.waypoints, "t");
  let prev = m.getState().pose;
  let checked = 0;
  for (let i = 0; i < 2000 && m.getState().status === "moving"; i++) {
    m.advance(0.05);
    const pose = m.getState().pose;
    const moved = Math.hypot(pose.x - prev.x, pose.y - prev.y);
    const cam = fromScene(fpvCamera(pose).position);
    // Same position (plus the fixed lens offset) as the pose the 2D map renders.
    assert.ok(Math.abs(Math.hypot(cam.x - pose.x, cam.y - pose.y) - MARTY.camForward) < 1e-9);
    if (moved > 0.004) {
      // Driving straight: the scene's forward vector matches the direction actually travelled.
      const f = fromScene(forward(pose.heading));
      const dot = (f.x * (pose.x - prev.x) + f.y * (pose.y - prev.y)) / moved;
      assert.ok(dot > 0.9, `camera faces the direction of travel (dot ${dot.toFixed(3)})`);
      checked++;
    }
    prev = pose;
  }
  assert.ok(checked > 20);
});

test("obstacles become boxes with the same footprint", () => {
  for (const o of building.floors.flatMap((f) => f.obstacles)) {
    const b = obstacleBox(o);
    const c = fromScene(b.center);
    assert.ok(close(c.x, o.x + o.w / 2) && close(c.y, o.y + o.h / 2));
    assert.equal(b.size[0], o.w);
    assert.equal(b.size[2], o.h);
    assert.ok(close(b.center[1], b.size[1] / 2), "sits on the floor");
  }
});

test("every card hangs on its surface, facing out, below the top of what it's mounted on", () => {
  for (const card of building.cards) {
    const fe = floorEnv(building, card.floor);
    const p = cardPlacement(fe, card);
    const c = fromScene(p.center);
    assert.ok(Math.hypot(c.x - card.position.x, c.y - card.position.y) < 0.02, card.id);
    // The frame's front (+Z rotated by yaw) points along the card's facing.
    const normal = fromScene([Math.sin(p.yaw), 0, Math.cos(p.yaw)]);
    assert.ok(close(normal.x, card.facing.x) && close(normal.y, card.facing.y), `${card.id} faces out`);
    assert.ok(p.heightCenter + CARD_SIZE.h / 2 <= surfaceHeight(fe, card), `${card.id} fits on its surface`);
    assert.ok(p.heightCenter - CARD_SIZE.h / 2 > 0, `${card.id} above the floor`);
  }
});

test("arriving at a card, Marty turns to face it and the FPV camera frames it", async () => {
  const { parseRequest, planRoute } = await import("../routes.ts");
  const { framing, CARD_SIZE: SIZE, MARTY: M } = await import("../space3d.ts");
  for (const id of ["griffey-89", "trout-11", "henderson-80", "rose-63", "robinson-52", "ruth-33"]) {
    const card = building.cards.find((c) => c.id === id)!;
    const plan = planRoute(building, grids, { ...building.defaultPose, floor: 1 }, parseRequest(building, card.name).stops, { speed: 0.18, turnRate: Math.PI / 2 });
    const leg = plan.legs.find((l) => l.kind === "drive" && l.stop?.cardId === id)!;
    assert.ok(leg.kind === "drive" && leg.face !== undefined, `${id}: drive leg asks to face the card`);
    const m = newMotion();
    if (leg.kind === "drive") m.setPose({ ...leg.path[0], heading: 0 });
    m.follow(leg.kind === "drive" ? leg.path : [], "t", leg.kind === "drive" ? leg.face : null);
    for (let i = 0; i < 3000 && m.getState().status === "moving"; i++) m.advance(0.05);
    const pose = m.getState().pose;
    // Facing the card: heading points opposite to the card's facing direction.
    assert.ok(Math.cos(pose.heading) * -card.facing.x + Math.sin(pose.heading) * -card.facing.y > 0.999, `${id}: squared up`);
    const f = framing(floorEnv(building, card.floor), pose);
    assert.equal(f.cardId, id);
    assert.ok(f.weight > 0.99);
    // The card fills most of the frame vertically, and the camera is tilted up to it.
    const dist = Math.hypot(card.position.x - (pose.x + Math.cos(pose.heading) * M.camForward), card.position.y - (pose.y + Math.sin(pose.heading) * M.camForward));
    const cardAngle = (2 * Math.atan(SIZE.h / 2 / dist) * 180) / Math.PI;
    assert.ok(cardAngle / f.fov > 0.7, `${id}: card fills ${Math.round((cardAngle / f.fov) * 100)}% of the view`);
    assert.ok(f.pitch > M.camPitch);
  }
});

test("driving past cards, the camera stays at its normal view", async () => {
  const { framing, MARTY: M } = await import("../space3d.ts");
  const f = framing(env, { x: 0.4, y: 0.6, heading: 0 });
  assert.equal(f.cardId, null);
  assert.equal(f.fov, M.fov);
});

test("turning to face happens even with no distance left to drive", () => {
  const m = newMotion();
  const start = m.getState().pose;
  m.follow([{ x: start.x, y: start.y }], "t", Math.PI / 2);
  assert.equal(m.getState().status, "moving");
  for (let i = 0; i < 100 && m.getState().status === "moving"; i++) m.advance(0.05);
  assert.equal(m.getState().status, "arrived");
  assert.ok(Math.abs(m.getState().pose.heading - Math.PI / 2) < 1e-6);
  assert.equal(m.getState().pose.x, start.x);
});
