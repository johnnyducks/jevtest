/**
 * World (2D map) → 3D scene mapping. Pure functions, no three.js, so the 3D
 * views and the 2D map provably read the same simulation state.
 *
 * World: meters, origin bottom-left, +x east, +y north, heading radians CCW
 * from +x. Scene: +X east, +Y up, −Z north (so the default observer camera,
 * placed to the south, sees the room the same way round as the 2D map).
 */
import { type Card, DIMENSIONS, type Environment, type Obstacle, type Pose, type Vec } from "./environment.ts";

export type V3 = [number, number, number];

/** World point (+ height above its floor) → scene position, relative to that floor. */
export const toScene = (p: Vec, h = 0): V3 => [p.x, h, -p.y];

/** Height of a floor's surface above the ground floor's surface. Accepts fractional levels (on a ramp). */
export const floorBase = (level: number) => (level - 1) * DIMENSIONS.floorHeight;

/** Scene position → world point (inverse of toScene, height dropped). */
export const fromScene = ([x, , z]: V3): Vec => ({ x, y: -z });

/** Rotation about the scene's up axis that points an object's +X along `heading`. */
export const yawOf = (heading: number) => heading;

/** Unit direction of travel in the scene for a heading. */
export const forward = (heading: number): V3 => [Math.cos(heading), 0, -Math.sin(heading)];

/** Heights of things, meters (a 1:1 model of a small display building). Shared by the renderer and tests. */
export const HEIGHTS: Record<Obstacle["kind"], number> & { roomWall: number } = {
  wall: 0.25,
  table: 0.12,
  plinth: 0.13,
  shelf: 0.12,
  equipment: 0.2,
  cage: 0.25,
  ramp: 0,
  opening: 0,
  roomWall: DIMENSIONS.floorHeight - DIMENSIONS.slab,
};

/** Marty's body and FPV camera mount: a 4 in robot, lens about 2.3 in up and just behind the front. */
export const MARTY = { bodyHeight: 0.05, camHeight: 0.058, camForward: 0.045, camPitch: (5 * Math.PI) / 180, fov: 72 };

/** FPV camera: position at the lens, and a point it looks at, for a given pose (and optional tilt). */
export function fpvCamera(pose: Pose, pitch: number = MARTY.camPitch, base = 0): { position: V3; target: V3 } {
  const f = forward(pose.heading);
  const c = toScene(pose, base + MARTY.camHeight);
  const position: V3 = [c[0] + f[0] * MARTY.camForward, c[1], c[2] + f[2] * MARTY.camForward];
  const up = Math.tan(pitch);
  return { position, target: [position[0] + f[0], position[1] + up, position[2] + f[2]] };
}

/** Obstacle → box: center and size in the scene. */
export function obstacleBox(o: Obstacle): { center: V3; size: V3 } {
  const h = HEIGHTS[o.kind];
  return { center: toScene({ x: o.x + o.w / 2, y: o.y + o.h / 2 }, h / 2), size: [o.w, h, o.h] };
}

/** Standard trading card: 2.5 × 3.5 in. */
export const CARD_SIZE = { w: DIMENSIONS.cardWidth, h: DIMENSIONS.cardHeight };

/** Cards hang with their centre at Marty's eye level-ish (2.75 in), lower on short furniture. */
const CARD_CENTER = 0.07;

/** Height of the surface a card hangs on: the obstacle it touches, else the room wall. */
export function surfaceHeight(env: Environment, card: Card): number {
  const eps = 0.015;
  const host = env.obstacles.find((o) => card.position.x >= o.x - eps && card.position.x <= o.x + o.w + eps && card.position.y >= o.y - eps && card.position.y <= o.y + o.h + eps);
  return host ? HEIGHTS[host.kind] : HEIGHTS.roomWall;
}

/**
 * Where a card's frame sits: on its surface, facing out, centred low enough
 * to stay on short furniture and to be seen from Marty's camera.
 */
export function cardPlacement(env: Environment, card: Card): { center: V3; yaw: number; heightCenter: number } {
  const top = surfaceHeight(env, card);
  const heightCenter = Math.max(CARD_SIZE.h / 2 + 0.005, Math.min(CARD_CENTER, top - CARD_SIZE.h / 2 - 0.004));
  const out = 0.002; // just proud of the surface, no z-fighting
  return {
    center: toScene({ x: card.position.x + card.facing.x * out, y: card.position.y + card.facing.y * out }, heightCenter),
    // A plane's front faces +Z by default; turn it to face the card's facing direction.
    yaw: Math.atan2(card.facing.x, -card.facing.y),
    heightCenter,
  };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Camera framing when Marty is in front of a card and facing it: tilt up to the
 * card's centre and narrow the field of view so the card fills most of the
 * frame. Blends smoothly back to the normal view as he moves away or turns.
 * Pure: the same pose always gives the same framing.
 */
export function framing(env: Environment, pose: Pose): { pitch: number; fov: number; cardId: string | null; weight: number } {
  const cam = fromScene(fpvCamera(pose).position);
  let best: { id: string; pitch: number; fov: number; w: number } | null = null;
  for (const card of env.cards) {
    const pl = cardPlacement(env, card);
    const at = fromScene(pl.center);
    const dx = at.x - cam.x;
    const dy = at.y - cam.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-3 || dist > 0.35) continue;
    // Facing the card (heading toward it) and the card facing back (not seen from behind).
    const along = (Math.cos(pose.heading) * dx + Math.sin(pose.heading) * dy) / dist;
    const facesBack = -(card.facing.x * dx + card.facing.y * dy) / dist;
    const w = smooth(0.35, 0.2, dist) * smooth(0.82, 0.97, along) * smooth(0.5, 0.85, facesBack);
    if (w <= 0) continue;
    const pitch = Math.atan2(pl.heightCenter - MARTY.camHeight, dist);
    // Vertical field of view in which the card (plus its frame) fills ~80% of the height.
    const fov = ((2 * Math.atan((CARD_SIZE.h / 2 + 0.004) / dist)) / 0.85) * (180 / Math.PI);
    if (!best || w > best.w) best = { id: card.id, pitch, fov: Math.min(MARTY.fov, Math.max(38, fov)), w };
  }
  if (!best) return { pitch: MARTY.camPitch, fov: MARTY.fov, cardId: null, weight: 0 };
  return {
    pitch: MARTY.camPitch + (best.pitch - MARTY.camPitch) * best.w,
    fov: MARTY.fov + (best.fov - MARTY.fov) * best.w,
    cardId: best.w > 0.5 ? best.id : null,
    weight: best.w,
  };
}
