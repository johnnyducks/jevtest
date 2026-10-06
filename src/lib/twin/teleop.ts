/**
 * Keyboard teleoperation: a velocity command for a Mecanum-wheeled Scout.
 *
 * A drive command is three normalized velocities, each in [-1, 1]: forward
 * (+ ahead), strafe (+ to Marty's right) and rotate (+ counterclockwise, i.e.
 * turning left). Keys only set those three numbers; the motion layer turns
 * them into movement, so any combination of keys is one command. Shared by the
 * browser (keys → command) and the server (command → pose).
 */
import type { Pose, Vec } from "./environment.ts";
import { wrapAngle } from "./geometry.ts";

export interface DriveCommand {
  forward: number;
  strafe: number;
  rotate: number;
}

export const STILL: DriveCommand = { forward: 0, strafe: 0, rotate: 0 };

/** Shift: precision mode, about a quarter of full speed. */
export const PRECISION = 0.25;

/** Keys Marty listens to, by KeyboardEvent.code (layout independent: the WASD positions on any keyboard). */
export const DRIVE_KEYS = ["KeyQ", "KeyW", "KeyE", "KeyA", "KeyS", "KeyD"] as const;
export type DriveKey = (typeof DRIVE_KEYS)[number];
export const isDriveKey = (code: string): code is DriveKey => (DRIVE_KEYS as readonly string[]).includes(code);

export const isStill = (c: DriveCommand) => c.forward === 0 && c.strafe === 0 && c.rotate === 0;

/**
 * Held keys → one command. Opposite keys cancel. Translation is normalized so
 * a diagonal (W+D) is no faster than straight ahead; rotation is independent.
 */
export function keysToDrive(held: Iterable<string>, precision = false): DriveCommand {
  const k = new Set(held);
  const axis = (pos: string, neg: string) => (k.has(pos) ? 1 : 0) - (k.has(neg) ? 1 : 0);
  return scaleDrive(normalizeDrive({ forward: axis("KeyW", "KeyS"), strafe: axis("KeyD", "KeyA"), rotate: axis("KeyQ", "KeyE") }), precision ? PRECISION : 1);
}

/** Clamp each part to [-1, 1] and keep the translation inside the unit circle. */
export function normalizeDrive(c: DriveCommand): DriveCommand {
  const clamp = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  let forward = clamp(c.forward);
  let strafe = clamp(c.strafe);
  const mag = Math.hypot(forward, strafe);
  if (mag > 1) {
    forward /= mag;
    strafe /= mag;
  }
  // `+ 0` turns -0 into 0, so commands compare and serialize cleanly.
  return { forward: forward + 0, strafe: strafe + 0, rotate: clamp(c.rotate) + 0 };
}

const scaleDrive = (c: DriveCommand, s: number): DriveCommand => ({ forward: c.forward * s + 0, strafe: c.strafe * s + 0, rotate: c.rotate * s + 0 });

/**
 * Advance a pose by `dt` seconds under a drive command. `speed` (m/s) and
 * `turnRate` (rad/s) are full scale. `free` says whether Marty may move from
 * one pose to the next (position and heading: on a narrow ramp the heading
 * decides whether he fits). A blocked move tries sliding along each world axis
 * instead, so brushing a wall glides along it rather than sticking; if even
 * that is blocked he turns in place, or translates without turning, or stays put.
 */
export function driveStep(pose: Pose, c: DriveCommand, dt: number, speed: number, turnRate: number, free: (a: Pose, b: Pose) => boolean): Pose {
  const h = pose.heading;
  // Body frame → world: forward along the heading, right is a quarter turn clockwise from it.
  const vx = (Math.cos(h) * c.forward + Math.sin(h) * c.strafe) * speed;
  const vy = (Math.sin(h) * c.forward - Math.cos(h) * c.strafe) * speed;
  const turned = wrapAngle(h + c.rotate * turnRate * dt);
  const full = { x: pose.x + vx * dt, y: pose.y + vy * dt };
  const alongX = { x: full.x, y: pose.y };
  const alongY = { x: pose.x, y: full.y };
  // Prefer the slide that keeps more of the intended motion.
  const slides = Math.abs(vx) >= Math.abs(vy) ? [alongX, alongY] : [alongY, alongX];
  const moves: Vec[] = vx || vy ? [full, ...slides] : [];
  const tries: Pose[] = [
    ...moves.map((m) => ({ ...m, heading: turned })),
    ...(turned !== h ? [{ x: pose.x, y: pose.y, heading: turned }, ...moves.map((m) => ({ ...m, heading: h }))] : []),
  ];
  return tries.find((t) => (t.x !== pose.x || t.y !== pose.y || t.heading !== h) && free(pose, t)) ?? pose;
}
