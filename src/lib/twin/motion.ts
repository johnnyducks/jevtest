/**
 * Marty's position and movement source.
 *
 * `PoseSource` is the seam for future hardware: the map and decision panel
 * only read from it. `SimulatedMotion` is the only implementation in this
 * prototype. It moves a virtual robot along a planned route and never talks
 * to a physical Scout. A real telemetry adapter would implement the same
 * interface later.
 */
import type { Pose, Vec } from "./environment.ts";
import { wrapAngle } from "./geometry.ts";

export type MotionStatus = "idle" | "moving" | "arrived" | "stopped";

export interface MotionState {
  pose: Pose;
  status: MotionStatus;
  /** Route currently being followed (empty when idle). */
  path: Vec[];
  /** Index of the waypoint Marty is heading to. */
  waypoint: number;
  /** Mission that owns the current motion, if any. */
  missionId: string | null;
  /** Distance travelled on the current route, meters. */
  travelled: number;
  /** "simulated" for this prototype; a hardware adapter would report "telemetry". */
  source: "simulated";
}

export interface PoseSource {
  getState(): MotionState;
  subscribe(listener: (s: MotionState) => void): () => void;
}

export interface MotionCommands {
  /** Start following `path` for `missionId`. Cancels any previous motion. */
  follow(path: Vec[], missionId: string): void;
  /** Halt immediately. Leaves Marty where it is. */
  stop(): void;
  /** Place Marty (only valid while not moving). */
  setPose(pose: Pose): void;
  setSpeed(metersPerSecond: number): void;
}

export interface MotionParams {
  speed: number; // m/s
  turnRate: number; // rad/s
  /** Rotate in place when the heading error exceeds this, radians. */
  turnInPlace: number;
}

export const DEFAULT_PARAMS: MotionParams = { speed: 0.6, turnRate: Math.PI, turnInPlace: (25 * Math.PI) / 180 };

/**
 * Pure kinematic step: advance `state` by `dt` seconds along its path.
 * Differential-drive style: rotate toward the next waypoint, then drive.
 */
export function step(state: MotionState, dt: number, p: MotionParams): MotionState {
  if (state.status !== "moving") return state;
  let { x, y, heading } = state.pose;
  let wp = state.waypoint;
  let travelled = state.travelled;
  let budget = dt;

  while (budget > 1e-6 && wp < state.path.length) {
    const target = state.path[wp];
    const dx = target.x - x;
    const dy = target.y - y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-4) {
      wp++;
      continue;
    }
    const desired = Math.atan2(dy, dx);
    const err = wrapAngle(desired - heading);
    if (Math.abs(err) > p.turnInPlace) {
      // Rotate in place.
      const turn = Math.min(Math.abs(err), p.turnRate * budget);
      heading = wrapAngle(heading + Math.sign(err) * turn);
      budget -= turn / p.turnRate;
      continue;
    }
    // Drive, easing the remaining heading error out.
    heading = wrapAngle(heading + Math.sign(err) * Math.min(Math.abs(err), p.turnRate * budget));
    const move = Math.min(d, p.speed * budget);
    x += (dx / d) * move;
    y += (dy / d) * move;
    travelled += move;
    budget -= move / p.speed;
    if (move >= d - 1e-9) wp++;
  }

  const arrived = wp >= state.path.length;
  return {
    ...state,
    pose: { x, y, heading },
    waypoint: Math.min(wp, state.path.length - 1),
    travelled,
    status: arrived ? "arrived" : "moving",
  };
}

export interface Scheduler {
  request(cb: (now: number) => void): number;
  cancel(handle: number): void;
  now(): number;
}

/** Browser scheduler (requestAnimationFrame), with a timer fallback for non-DOM environments. */
export const defaultScheduler: Scheduler = {
  request: (cb) =>
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(cb)
      : (setTimeout(() => cb(Date.now()), 16) as unknown as number),
  cancel: (h) => (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(h) : clearTimeout(h)),
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
};

export class SimulatedMotion implements PoseSource, MotionCommands {
  private state: MotionState;
  private params: MotionParams;
  private listeners = new Set<(s: MotionState) => void>();
  private frame: number | null = null;
  private last = 0;
  /** Incremented on every follow/stop/setPose; stale frames compare against it and bail out. */
  private run = 0;
  private scheduler: Scheduler;

  constructor(initial: Pose, scheduler: Scheduler = defaultScheduler, params: MotionParams = DEFAULT_PARAMS) {
    this.scheduler = scheduler;
    this.params = { ...params };
    this.state = { pose: { ...initial }, status: "idle", path: [], waypoint: 0, missionId: null, travelled: 0, source: "simulated" };
  }

  getState = () => this.state;

  subscribe = (listener: (s: MotionState) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(next: MotionState) {
    this.state = next;
    for (const l of this.listeners) l(next);
  }

  private cancelFrame() {
    if (this.frame !== null) this.scheduler.cancel(this.frame);
    this.frame = null;
  }

  follow(path: Vec[], missionId: string) {
    this.cancelFrame();
    const run = ++this.run;
    this.emit({ ...this.state, status: path.length > 1 ? "moving" : "arrived", path, waypoint: 1, missionId, travelled: 0 });
    if (path.length <= 1) return;
    this.last = this.scheduler.now();
    const tick = (now: number) => {
      if (run !== this.run) return; // stale callback from a cancelled mission
      const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.advance(dt);
      if (run === this.run && this.state.status === "moving") this.frame = this.scheduler.request(tick);
      else this.frame = null;
    };
    this.frame = this.scheduler.request(tick);
  }

  /** Advance the simulation by `dt` seconds (also used directly by tests). */
  advance(dt: number) {
    if (this.state.status !== "moving") return;
    this.emit(step(this.state, dt, this.params));
  }

  stop() {
    this.cancelFrame();
    this.run++;
    if (this.state.status === "moving") this.emit({ ...this.state, status: "stopped" });
  }

  setPose(pose: Pose) {
    this.cancelFrame();
    this.run++;
    this.emit({ ...this.state, pose: { ...pose }, status: "idle", path: [], waypoint: 0, missionId: null, travelled: 0 });
  }

  setSpeed(mps: number) {
    this.params.speed = Math.min(2, Math.max(0.1, mps));
  }

  getSpeed() {
    return this.params.speed;
  }
}
