/**
 * Ramps as drivable space, for anything that moves Marty off the planned
 * centre line (keyboard driving) or starts a trip part-way up one.
 *
 * Each ramp has a corridor along its lane: the line-up zone before the foot,
 * the incline, and the line-up zone past the top. In it, Marty's height
 * follows his position along the incline, and he must fit between the wall
 * and the rail. Everywhere else, the floor's occupancy grid applies (which
 * blocks the lane and the opening, so nobody drives under a ramp or into a hole).
 */
import { DIMENSIONS, type Building, type Pose, type Ramp, type Vec } from "./environment.ts";

/** Gap kept between Marty's body and the wall or rail on a ramp, meters. */
export const RAMP_MARGIN = 0.12 * 0.0254;

const EPS = 1e-6;

export interface RampSpot {
  ramp: Ramp;
  /** Distance from the foot toward the top, along the lane, meters (negative in the line-up zone below). */
  along: number;
  /** Length of the incline, meters. */
  length: number;
  /** Height in floors at this point (from … to). */
  level: number;
}

/** +1 when the ramp climbs toward +x (east), −1 toward −x. */
const dirOf = (r: Ramp) => (r.top.x >= r.foot.x ? 1 : -1);

/** Heading pointing up the ramp, radians. */
export const uphill = (r: Ramp) => (dirOf(r) === 1 ? 0 : Math.PI);

export const rampLength = (r: Ramp) => Math.abs(r.top.x - r.foot.x);

function measure(r: Ramp, p: Vec) {
  const dir = dirOf(r);
  return {
    along: (p.x - r.foot.x) * dir,
    lateral: Math.abs(p.y - r.foot.y),
    entry: (r.entry.x - r.foot.x) * dir,
    exit: (r.exit.x - r.foot.x) * dir,
  };
}

/**
 * The ramp corridor Marty is in at `p`, given his current height in floors.
 * At a whole floor only that floor's end of each ramp counts (the line-up zone
 * and incline on the lower floor; the incline and the line-up zone past the
 * top on the upper floor), so standing on a floor above a lower floor's
 * line-up zone never counts as being on that ramp.
 */
export function rampSpot(b: Building, level: number, p: Vec): RampSpot | null {
  for (const r of b.ramps) {
    if (level < r.from - EPS || level > r.to + EPS) continue;
    const m = measure(r, p);
    if (m.lateral > r.lane.h / 2) continue;
    const len = rampLength(r);
    const atLower = level <= r.from + EPS;
    const atUpper = level >= r.to - EPS;
    const lo = atUpper ? 0 : m.entry;
    const hi = atLower ? len : m.exit;
    if (m.along < lo - EPS || m.along > hi + EPS) continue;
    const frac = Math.max(0, Math.min(1, m.along / len));
    return { ramp: r, along: m.along, length: len, level: r.from + frac };
  }
  return null;
}

/** The floor that counts at a height on a ramp: the upper one from halfway up. */
export const floorAt = (r: Ramp, level: number) => (level - r.from >= 0.5 ? r.to : r.from);

/** Marty's footprint fits in the lane at this pose (between the wall and the rail, with a small margin). */
export function fitsLane(r: Ramp, pose: Pose): boolean {
  const across = Math.abs(Math.sin(pose.heading)) * (DIMENSIONS.botLength / 2) + Math.abs(Math.cos(pose.heading)) * (DIMENSIONS.botWidth / 2);
  return measure(r, pose).lateral + across <= r.lane.h / 2 - RAMP_MARGIN + EPS;
}

/**
 * How Marty's body tilts on a ramp at a heading: `pitch` is nose-up (full
 * incline facing uphill, nose-down facing downhill), `roll` is right-side-up
 * (driving across the slope with uphill on his right).
 */
export function rampTilt(r: Ramp, heading: number): { pitch: number; roll: number } {
  const angle = Math.atan2(DIMENSIONS.floorHeight, rampLength(r));
  const d = heading - uphill(r);
  return { pitch: angle * Math.cos(d), roll: angle * Math.sin(d) };
}
