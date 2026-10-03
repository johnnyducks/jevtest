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
}

export const BATTERY: BatteryConfig = { perMeter: 0.6, perRadian: 0.1, chargePerSecond: 2.5, dockRadius: 0.45, reserve: 10, deadAt: 1 };

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
