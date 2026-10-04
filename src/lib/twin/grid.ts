/**
 * Occupancy grid for collision checks and path planning.
 *
 * Obstacles and room walls are inflated by Marty's radius plus clearance, so a
 * cell marked free means Marty's whole body fits there with room to spare.
 */
import type { Environment, Obstacle, Vec } from "./environment.ts";

export interface Cell {
  c: number;
  r: number;
}

export interface Grid {
  cols: number;
  rows: number;
  resolution: number;
  inflation: number;
  /** 1 = blocked, 0 = free. Index = r * cols + c, row 0 at the bottom (y = 0). */
  blocked: Uint8Array;
  /** Which obstacle (if any) blocks each cell, for explanations. -1 = room boundary, -2 = free. */
  owner: Int16Array;
}

export function buildGrid(env: Environment): Grid {
  const res = env.resolution;
  const cols = Math.round(env.width / res);
  const rows = Math.round(env.height / res);
  const inflation = env.robotRadius + env.clearance;
  const blocked = new Uint8Array(cols * rows);
  const owner = new Int16Array(cols * rows).fill(-2);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * res;
      const y = (r + 0.5) * res;
      const i = r * cols + c;
      if (x < inflation || y < inflation || x > env.width - inflation || y > env.height - inflation) {
        blocked[i] = 1;
        owner[i] = -1;
        continue;
      }
      for (let k = 0; k < env.obstacles.length; k++) {
        if (distToRect({ x, y }, env.obstacles[k]) < inflation) {
          blocked[i] = 1;
          owner[i] = k;
          break;
        }
      }
    }
  }
  return { cols, rows, resolution: res, inflation, blocked, owner };
}

export function distToRect(p: Vec, o: Obstacle): number {
  const dx = Math.max(o.x - p.x, 0, p.x - (o.x + o.w));
  const dy = Math.max(o.y - p.y, 0, p.y - (o.y + o.h));
  return Math.hypot(dx, dy);
}

export function cellOf(g: Grid, p: Vec): Cell {
  return { c: Math.floor(p.x / g.resolution), r: Math.floor(p.y / g.resolution) };
}

export function centerOf(g: Grid, cell: Cell): Vec {
  return { x: (cell.c + 0.5) * g.resolution, y: (cell.r + 0.5) * g.resolution };
}

export const inBounds = (g: Grid, cell: Cell) => cell.c >= 0 && cell.r >= 0 && cell.c < g.cols && cell.r < g.rows;

export function isFreeCell(g: Grid, cell: Cell): boolean {
  return inBounds(g, cell) && g.blocked[cell.r * g.cols + cell.c] === 0;
}

export function isFreePoint(g: Grid, p: Vec): boolean {
  return isFreeCell(g, cellOf(g, p));
}

/** Explain why a point is not usable (for UI messages). Null when free. */
export function blockReason(env: Environment, g: Grid, p: Vec): string | null {
  if (p.x < 0 || p.y < 0 || p.x > env.width || p.y > env.height) return "outside the room";
  const cell = cellOf(g, p);
  if (isFreeCell(g, cell)) return null;
  const own = g.owner[cell.r * g.cols + cell.c];
  if (own === -1) return "too close to the room wall";
  const o = env.obstacles[own];
  return distToRect(p, o) === 0 ? `inside the ${o.label.toLowerCase()}` : `too close to the ${o.label.toLowerCase()}`;
}

/** Straight segment check, sampled at a quarter cell. */
export function segmentFree(g: Grid, a: Vec, b: Vec): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(d / (g.resolution / 4)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isFreePoint(g, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
  }
  return true;
}

/** Obstacles (in order, de-duplicated) whose clearance the straight segment a → b crosses. */
export function blockersAlong(env: Environment, g: Grid, a: Vec, b: Vec): string[] {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(d / (g.resolution / 4)));
  const out: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cell = cellOf(g, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const own = inBounds(g, cell) ? g.owner[cell.r * g.cols + cell.c] : -1;
    const name = own === -1 ? "room wall" : own >= 0 ? env.obstacles[own].label.toLowerCase() : null;
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** First obstacle (or the room wall) blocking the straight segment a → b, for explanations. */
export function firstBlocker(env: Environment, g: Grid, a: Vec, b: Vec): string | null {
  return blockersAlong(env, g, a, b)[0] ?? null;
}

/** True when `to` is in the same connected free region as `from`. */
export function connected(g: Grid, from: Vec, to: Vec): boolean {
  const cell = (p: Vec) => ({ c: Math.floor(p.x / g.resolution), r: Math.floor(p.y / g.resolution) });
  const a = cell(from);
  const z = cell(to);
  const seen = new Uint8Array(g.cols * g.rows);
  const free = (c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && !g.blocked[r * g.cols + c];
  if (!free(a.c, a.r) || !free(z.c, z.r)) return false;
  const q = [a.r * g.cols + a.c];
  seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    if (i === z.r * g.cols + z.c) return true;
    const c = i % g.cols;
    const r = (i - c) / g.cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (free(nc, nr) && !seen[nr * g.cols + nc]) {
        seen[nr * g.cols + nc] = 1;
        q.push(nr * g.cols + nc);
      }
    }
  }
  return false;
}
