/**
 * Deterministic grid A* with line-of-sight smoothing.
 *
 * 8-connected, octile heuristic, no corner cutting. Ties are broken by lower
 * heuristic, then by insertion order, so the same input always produces the
 * same path. Independent of rendering.
 */
import type { Vec } from "./environment.ts";
import { type Cell, cellOf, centerOf, type Grid, isFreeCell, segmentFree } from "./grid.ts";

export type PlanStatus = "ok" | "start_blocked" | "goal_blocked" | "no_path";

export interface PlanResult {
  status: PlanStatus;
  start: Vec;
  goal: Vec;
  /** Smoothed route including start and goal. Empty unless status is "ok". */
  waypoints: Vec[];
  /** Raw cell path length before smoothing (cells). */
  rawCells: number;
  /** Total smoothed route length, meters. */
  length: number;
  /** Straight-line distance start → goal, meters. */
  directDistance: number;
  /** True when the straight line start → goal is blocked (route must detour). */
  detour: boolean;
  /** Nodes expanded by A*. */
  expanded: number;
  /** Human-readable summary of the outcome. */
  message: string;
}

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

function octile(a: Cell, b: Cell) {
  const dx = Math.abs(a.c - b.c);
  const dy = Math.abs(a.r - b.r);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

/** Minimal binary heap keyed by (f, h, seq) for deterministic ordering. */
class Heap {
  private items: { i: number; f: number; h: number; seq: number }[] = [];
  get size() {
    return this.items.length;
  }
  private less(a: number, b: number) {
    const x = this.items[a];
    const y = this.items[b];
    return x.f !== y.f ? x.f < y.f : x.h !== y.h ? x.h < y.h : x.seq < y.seq;
  }
  push(item: { i: number; f: number; h: number; seq: number }) {
    const it = this.items;
    it.push(item);
    let k = it.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (!this.less(k, p)) break;
      [it[k], it[p]] = [it[p], it[k]];
      k = p;
    }
  }
  pop() {
    const it = this.items;
    const top = it[0];
    const last = it.pop()!;
    if (it.length) {
      it[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < it.length && this.less(l, m)) m = l;
        if (r < it.length && this.less(r, m)) m = r;
        if (m === k) break;
        [it[k], it[m]] = [it[m], it[k]];
        k = m;
      }
    }
    return top;
  }
}

/** Raw A* over grid cells. Returns the cell path (start → goal) or null. */
export function astar(g: Grid, start: Cell, goal: Cell): { cells: Cell[] | null; expanded: number } {
  const n = g.cols * g.rows;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const idx = (c: Cell) => c.r * g.cols + c.c;
  const s = idx(start);
  const t = idx(goal);
  const heap = new Heap();
  let seq = 0;
  gScore[s] = 0;
  heap.push({ i: s, f: octile(start, goal), h: octile(start, goal), seq: seq++ });
  let expanded = 0;

  while (heap.size) {
    const { i } = heap.pop();
    if (closed[i]) continue;
    closed[i] = 1;
    expanded++;
    if (i === t) {
      const cells: Cell[] = [];
      for (let k = t; k !== -1; k = came[k]) cells.push({ c: k % g.cols, r: Math.floor(k / g.cols) });
      return { cells: cells.reverse(), expanded };
    }
    const cur = { c: i % g.cols, r: Math.floor(i / g.cols) };
    for (const [dc, dr, cost] of DIRS) {
      const nb = { c: cur.c + dc, r: cur.r + dr };
      if (!isFreeCell(g, nb)) continue;
      // No corner cutting: both orthogonal neighbours must be free for a diagonal step.
      if (dc && dr && (!isFreeCell(g, { c: cur.c + dc, r: cur.r }) || !isFreeCell(g, { c: cur.c, r: cur.r + dr }))) continue;
      const j = idx(nb);
      if (closed[j]) continue;
      const tentative = gScore[i] + cost;
      if (tentative < gScore[j] - 1e-9) {
        gScore[j] = tentative;
        came[j] = i;
        const h = octile(nb, goal);
        heap.push({ i: j, f: tentative + h, h, seq: seq++ });
      }
    }
  }
  return { cells: null, expanded };
}

/** Greedy line-of-sight smoothing: keep only the waypoints needed to stay collision-free. */
export function smooth(g: Grid, pts: Vec[]): Vec[] {
  if (pts.length <= 2) return pts.slice();
  const out: Vec[] = [pts[0]];
  let anchor = 0;
  while (anchor < pts.length - 1) {
    let next = anchor + 1;
    for (let k = pts.length - 1; k > anchor + 1; k--) {
      if (segmentFree(g, pts[anchor], pts[k])) {
        next = k;
        break;
      }
    }
    out.push(pts[next]);
    anchor = next;
  }
  return out;
}

const pathLength = (pts: Vec[]) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
const r2 = (n: number) => Math.round(n * 1000) / 1000;

export function planPath(g: Grid, start: Vec, goal: Vec): PlanResult {
  const direct = Math.hypot(goal.x - start.x, goal.y - start.y);
  const base = { start, goal, waypoints: [] as Vec[], rawCells: 0, length: 0, directDistance: r2(direct), detour: false, expanded: 0 };
  const sc = cellOf(g, start);
  const gc = cellOf(g, goal);
  if (!isFreeCell(g, sc)) return { ...base, status: "start_blocked", message: "Marty's current position is inside an obstacle's clearance zone." };
  if (!isFreeCell(g, gc)) return { ...base, status: "goal_blocked", message: "The approach point is inside an obstacle's clearance zone." };

  const { cells, expanded } = astar(g, sc, gc);
  if (!cells) {
    return { ...base, expanded, status: "no_path", message: `No collision-free route exists (searched ${expanded} cells).` };
  }
  const raw = [start, ...cells.slice(1, -1).map((c) => centerOf(g, c)), goal];
  const waypoints = smooth(g, raw).map((p) => ({ x: r2(p.x), y: r2(p.y) }));
  const length = pathLength(waypoints);
  const detour = !segmentFree(g, start, goal);
  return {
    ...base,
    status: "ok",
    waypoints,
    rawCells: cells.length,
    length: r2(length),
    detour,
    expanded,
    message: detour
      ? `Route found: ${r2(length)} m via ${waypoints.length - 2} turn${waypoints.length === 3 ? "" : "s"}, detouring around obstacles (direct line ${r2(direct)} m is blocked).`
      : `Route found: ${r2(length)} m, direct line of sight.`,
  };
}

/**
 * Nearest free cell to `target` that is reachable from `from` (BFS outward from
 * the target over the reachable set). Used for area goals such as "the other
 * side of the room", never for card approach points.
 */
export function nearestReachable(g: Grid, from: Vec, target: Vec): Vec | null {
  const n = g.cols * g.rows;
  const reach = new Uint8Array(n);
  const sc = cellOf(g, from);
  if (!isFreeCell(g, sc)) return null;
  const q: number[] = [sc.r * g.cols + sc.c];
  reach[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    const c = i % g.cols;
    const r = Math.floor(i / g.cols);
    for (const [dc, dr] of DIRS.slice(0, 4)) {
      const nb = { c: c + dc, r: r + dr };
      const j = nb.r * g.cols + nb.c;
      if (isFreeCell(g, nb) && !reach[j]) {
        reach[j] = 1;
        q.push(j);
      }
    }
  }
  let best: Cell | null = null;
  let bestD = Infinity;
  const tc = cellOf(g, target);
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      if (!reach[r * g.cols + c]) continue;
      const d = (c - tc.c) ** 2 + (r - tc.r) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { c, r };
      }
    }
  }
  return best ? centerOf(g, best) : null;
}
