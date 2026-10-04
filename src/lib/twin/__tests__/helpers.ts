import { BUILDING, floorEnv } from "../environment.ts";
import { buildGrid, type Grid } from "../grid.ts";
import { type Scheduler, SimulatedMotion } from "../motion.ts";

export const building = BUILDING;
/** Floor 1 (the lobby), where Marty starts. */
export const env = floorEnv(BUILDING, 1);
export const grid = buildGrid(env);
const gridCache = new Map<number, Grid>([[1, grid]]);
/** Occupancy grid for any floor (cached). */
export const grids = (floor: number) => gridCache.get(floor) ?? (gridCache.set(floor, buildGrid(floorEnv(BUILDING, floor))), gridCache.get(floor)!);

/** Scheduler that never fires on its own; tests drive motion with advance(). */
export const manualScheduler: Scheduler = { request: () => 1, cancel: () => {}, now: () => 0 };

export const newMotion = () => new SimulatedMotion(env.defaultPose, manualScheduler);

/** Run the motion until it stops moving (or a step budget runs out). */
export function runToEnd(m: SimulatedMotion, maxSteps = 5000) {
  for (let i = 0; i < maxSteps && m.getState().status === "moving"; i++) m.advance(0.05);
}

export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
