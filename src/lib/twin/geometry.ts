/**
 * Geometry helpers and the world ↔ screen transform.
 *
 * World coordinates are meters with the origin bottom-left and +y up. Screen
 * (SVG user units) have the origin top-left and +y down. Every map element
 * goes through this one transform so the environment can be re-rendered at
 * any size without touching world data.
 */
import type { Vec } from "./environment.ts";

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** Normalise an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

export const toDegrees = (rad: number) => (rad * 180) / Math.PI;

export interface ViewTransform {
  /** Pixels (SVG user units) per meter. */
  scale: number;
  /** Margin around the room, in SVG units. */
  pad: number;
  worldWidth: number;
  worldHeight: number;
  /** Total drawing size, in SVG units. */
  width: number;
  height: number;
  toScreen(p: Vec): Vec;
  toWorld(p: Vec): Vec;
  /** Convert a world length (meters) to SVG units. */
  len(m: number): number;
  /** World heading (radians, CCW from +x) → SVG rotation (degrees, CW). */
  rotation(heading: number): number;
}

export function makeTransform(worldWidth: number, worldHeight: number, scale = 60, pad = 28): ViewTransform {
  return {
    scale,
    pad,
    worldWidth,
    worldHeight,
    width: worldWidth * scale + pad * 2,
    height: worldHeight * scale + pad * 2,
    toScreen: (p) => ({ x: pad + p.x * scale, y: pad + (worldHeight - p.y) * scale }),
    toWorld: (p) => ({ x: (p.x - pad) / scale, y: worldHeight - (p.y - pad) / scale }),
    len: (m) => m * scale,
    rotation: (h) => -toDegrees(h),
  };
}
