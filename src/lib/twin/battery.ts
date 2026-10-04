/**
 * Battery model for the simulated robot. Drain is computed from measured
 * simulated movement (distance driven and rotation), not from time, so a
 * longer route really costs more. Charging happens when parked at the dock.
 */
import type { Pose, Vec } from "./environment.ts";
import { wrapAngle } from "./geometry.ts";

export interface BatteryConfig {
  /** % per meter driven. */
  perMeter: number;
  /** % per radian of rotation. */
  perRadian: number;
  /** % per second while parked at the dock. */
  chargePerSecond: number;
  /** Distance from the dock that counts as docked, meters. */
  dockRadius: number;
  /** Never plan a trip that would end (including the way home) below this, %. */
  reserve: number;
  /** At or below this, Marty cannot drive. */
  deadAt: number;
  /** Extra % per meter of ramp climbed (on top of perMeter). Going down costs nothing extra. */
  climbPerMeter: number;
}

/** Tuned for a 4 in robot in a 4 × 8 ft building: a full charge drives about 36 m (≈118 ft); each ramp up costs ~7%. */
export const BATTERY: BatteryConfig = { perMeter: 2.5, perRadian: 0.05, chargePerSecond: 1, dockRadius: 0.05, reserve: 10, deadAt: 1, climbPerMeter: 2 };

/** The live show's default: a battery 100× bigger than BATTERY (change it with BATTERY_CAPACITY in .env.local). */
export const DEFAULT_CAPACITY = 100;

/**
 * A battery `capacity` times bigger than BATTERY: driving, turning and climbing
 * each use 1/capacity as much charge. Charging speed (% per second), the
 * reserve and the dock are unchanged.
 */
export function batteryWithCapacity(capacity: number, base: BatteryConfig = BATTERY): BatteryConfig {
  const c = Number.isFinite(capacity) && capacity > 0 ? capacity : 1;
  return { ...base, perMeter: base.perMeter / c, perRadian: base.perRadian / c, climbPerMeter: base.climbPerMeter / c };
}

export class Battery {
  readonly config: BatteryConfig;
  private pct: number;
  private last: Pose | null = null;
  /** Total meters measured since start (for display/tests). */
  metersDriven = 0;

  constructor(initial = 100, config: BatteryConfig = BATTERY) {
    this.config = config;
    this.pct = initial;
  }

  get level() {
    return Math.max(0, Math.min(100, this.pct));
  }

  get dead() {
    return this.pct <= this.config.deadAt;
  }

  /** Usable driving range above the reserve, meters. */
  get range() {
    return Math.max(0, (this.pct - this.config.reserve) / this.config.perMeter);
  }

  set(pct: number) {
    this.pct = Math.max(0, Math.min(100, pct));
  }

  /** Feed every new simulated pose; drains by the distance and rotation actually measured. */
  observe(pose: Pose) {
    if (this.last) {
      const d = Math.hypot(pose.x - this.last.x, pose.y - this.last.y);
      const turn = Math.abs(wrapAngle(pose.heading - this.last.heading));
      if (d > 0 || turn > 0) {
        this.metersDriven += d;
        this.pct = Math.max(0, this.pct - d * this.config.perMeter - turn * this.config.perRadian);
      }
    }
    this.last = { ...pose };
  }

  /** Forget the last pose (after a teleport such as manual placement or reset). */
  resync(pose: Pose) {
    this.last = { ...pose };
  }

  /** Spend a fixed amount (e.g. climbing a ramp). */
  spend(pct: number) {
    this.pct = Math.max(0, this.pct - pct);
  }

  /** Charge if parked at the dock. Returns true while charging. */
  charge(pose: Vec, dock: Vec, seconds: number, moving: boolean): boolean {
    if (moving || Math.hypot(pose.x - dock.x, pose.y - dock.y) > this.config.dockRadius || this.pct >= 100) return false;
    this.pct = Math.min(100, this.pct + seconds * this.config.chargePerSecond);
    return true;
  }

  /** Estimated cost of driving `meters` with `radians` of turning plus fixed extras. */
  cost(meters: number, radians = 0, extra = 0) {
    return meters * this.config.perMeter + radians * this.config.perRadian + extra;
  }
}

/** Total rotation needed to follow a path from a starting heading, radians. */
export function turningAlong(start: Pose, path: Vec[]): number {
  let heading = start.heading;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    if (Math.hypot(dx, dy) < 1e-6) continue;
    const h = Math.atan2(dy, dx);
    total += Math.abs(wrapAngle(h - heading));
    heading = h;
  }
  return total;
}
