/**
 * Multi-stop and custom routes.
 *
 * parseRequest(): split a request into ordered stops ("ripken, then bonds,
 * then mantle", "go around the display table", "go upstairs") and resolve each
 * deterministically. planRoute(): plan every leg with A* and estimate distance,
 * time and battery, plus the cost of getting home to the dock afterwards.
 */
import { BATTERY, type BatteryConfig, turningAlong } from "./battery.ts";
import type { Card, Environment, Obstacle, Pose, SpecialPlace, Vec } from "./environment.ts";
import { fuzzyPhraseIn } from "./fuzzy.ts";
import { type Grid, isFreePoint } from "./grid.ts";
import { nearestReachable, planPath } from "./pathfinding.ts";
import { normalize, resolveArea, resolveCardByName, resolveNearestCard } from "./resolve.ts";

export type StopRef =
  | { kind: "card"; card: Card; matched: string; method: string }
  | { kind: "nearest" }
  | { kind: "area"; text: string }
  | { kind: "around"; target: Obstacle | "room"; name: string }
  | { kind: "special"; place: SpecialPlace };

export interface StopIssue {
  segment: string;
  reason: "ambiguous" | "not_found";
  options?: { id: string; name: string }[];
  matched?: string;
}

export interface ParsedRequest {
  segments: string[];
  stops: StopRef[];
  issues: StopIssue[];
  /** Typos that were corrected, for transparency ("heanderson → henderson"). */
  corrections: string[];
}

const FILLER = new Set(
  "go to the a an then and please marty visit take me drive head over back now after that lets let's quickly card cards first next finally also can you could would like want wanna i we us just".split(" "),
);

const AROUND = /\b(around|circle|loop|lap|orbit)\b/;

function obstacleNames(o: Obstacle): string[] {
  const label = o.label.toLowerCase();
  const names = [label, label.split(" ").at(-1)!];
  if (o.id === "partition") names.push("wall", "partition");
  if (o.id === "rack") names.push("rack", "equipment");
  if (o.kind === "cage") names.push("vault", "cage");
  return [...new Set(names)];
}

/** A segment without filler words, for messages ("go to zorbleflex" → "zorbleflex"). */
export function coreWords(segment: string): string {
  const core = segment.split(" ").filter((w) => w && !FILLER.has(w)).join(" ");
  return core || segment;
}

export function splitStops(text: string): string[] {
  return normalize(text.replace(/->|→|[,;]/g, " , ").replace(/,/g, " then "))
    .split(/\s*(?:\band then\b|\bthen\b|\bafter that\b|\bfollowed by\b|\band\b)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse a request into ordered stops. Never guesses: unclear parts become issues. */
export function parseRequest(env: Environment, text: string): ParsedRequest {
  const segments = splitStops(text);
  const stops: StopRef[] = [];
  const issues: StopIssue[] = [];
  const corrections: string[] = [];
  const obstacles = [...new Map(env.obstacles.map((o) => [o.label, o])).values()];

  for (const seg of segments) {
    const n = ` ${seg} `;
    if (AROUND.test(seg)) {
      if (/\broom\b/.test(seg)) {
        stops.push({ kind: "around", target: "room", name: "the room" });
        continue;
      }
      const words = seg.split(" ");
      const hit = obstacles.find((o) => obstacleNames(o).some((nm) => n.includes(` ${nm} `) || fuzzyPhraseIn(words, nm)));
      if (hit) stops.push({ kind: "around", target: hit, name: hit.label.toLowerCase() });
      else issues.push({ segment: coreWords(seg), reason: "not_found" });
      continue;
    }
    const special = env.special.find((p) => p.aliases.some((a) => n.includes(` ${a} `)));
    if (special) {
      stops.push({ kind: "special", place: special });
      continue;
    }
    if (/\b(nearest|closest)\b/.test(seg)) {
      stops.push({ kind: "nearest" });
      continue;
    }
    if (/\b(other side|opposite side|far side|across the room|middle|center|centre|dock|home|charger|charging)\b/.test(seg)) {
      stops.push({ kind: "area", text: seg });
      continue;
    }
    const r = resolveCardByName(env, seg);
    if (r.status === "resolved") {
      const card = env.cards.find((c) => c.id === r.target.id)!;
      stops.push({ kind: "card", card, matched: r.matched ?? "", method: r.method });
      if (r.method === "fuzzy match" && r.matched) corrections.push(r.matched);
    } else if (r.status === "ambiguous") {
      issues.push({ segment: seg, reason: "ambiguous", options: r.options, matched: r.matched });
    } else if (seg.split(" ").some((w) => w.length > 2 && !FILLER.has(w))) {
      issues.push({ segment: coreWords(seg), reason: "not_found" });
    }
  }
  return { segments, stops, issues, corrections };
}

export type Leg =
  | { kind: "drive"; label: string; path: Vec[]; meters: number; stop?: { name: string; cardId?: string } }
  | { kind: "dwell"; label: string; seconds: number; battery: number; stop?: { name: string; cardId?: string } };

export interface RoutePlan {
  ok: boolean;
  legs: Leg[];
  stops: { name: string; cardId?: string; point: Vec }[];
  meters: number;
  seconds: number;
  /** Estimated battery used, %. */
  battery: number;
  /** Estimated % needed afterwards to get back to the dock. */
  homeBattery: number;
  turnRad: number;
  summary: string;
  /** Why planning failed, when ok is false. */
  issue?: string;
}

export interface PlanOptions {
  speed: number;
  turnRate: number;
  battery?: BatteryConfig;
  /** Seconds Marty pauses at each card to look at it. */
  viewSeconds?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function loopAround(env: Environment, grid: Grid, from: Vec, target: Obstacle | "room"): { points: Vec[] } | { issue: string } {
  const margin = grid.inflation + 0.25;
  let corners: Vec[];
  if (target === "room") {
    corners = [
      { x: 0.9, y: 0.9 },
      { x: env.width - 0.9, y: 0.9 },
      { x: env.width - 0.9, y: env.height - 0.9 },
      { x: 0.9, y: env.height - 0.9 },
    ].map((c) => nearestReachable(grid, from, c) ?? c);
  } else {
    const o = target;
    corners = [
      { x: o.x - margin, y: o.y - margin },
      { x: o.x + o.w + margin, y: o.y - margin },
      { x: o.x + o.w + margin, y: o.y + o.h + margin },
      { x: o.x - margin, y: o.y + o.h + margin },
    ];
    const blocked = corners.filter((c) => !isFreePoint(grid, c));
    if (blocked.length) return { issue: `I can't get all the way around the ${o.label.toLowerCase()}; it's too close to a wall or other furniture.` };
  }
  // Start at the corner nearest Marty and go all the way round, back to it.
  let start = 0;
  corners.forEach((c, i) => {
    if (Math.hypot(c.x - from.x, c.y - from.y) < Math.hypot(corners[start].x - from.x, corners[start].y - from.y)) start = i;
  });
  const ordered = [...corners.slice(start), ...corners.slice(0, start)];
  return { points: [...ordered, ordered[0]] };
}

/** Plan all legs from `from`. Fails (ok: false) on the first unreachable stop, with a reason. */
export function planRoute(env: Environment, grid: Grid, from: Pose, stops: StopRef[], opts: PlanOptions): RoutePlan {
  const cfg = opts.battery ?? BATTERY;
  const view = opts.viewSeconds ?? 2;
  const legs: Leg[] = [];
  const named: RoutePlan["stops"] = [];
  let cursor: Pose = { ...from };
  let fail: string | undefined;

  const drive = (to: Vec, label: string, stop?: { name: string; cardId?: string }) => {
    const p = planPath(grid, cursor, to);
    if (p.status !== "ok") return p;
    legs.push({ kind: "drive", label, path: p.waypoints, meters: p.length, ...(stop ? { stop } : {}) });
    const last = p.waypoints.at(-1)!;
    const prev = p.waypoints.at(-2) ?? cursor;
    cursor = { x: last.x, y: last.y, heading: p.waypoints.length > 1 ? Math.atan2(last.y - prev.y, last.x - prev.x) : cursor.heading };
    return p;
  };

  for (const s of stops) {
    if (s.kind === "card" || s.kind === "nearest") {
      let card: Card | undefined = s.kind === "card" ? s.card : undefined;
      if (s.kind === "nearest") {
        const r = resolveNearestCard(env, grid, cursor);
        card = r.status === "resolved" ? env.cards.find((c) => c.id === r.target.id) : undefined;
        if (!card) {
          fail = "No card is reachable from there.";
          break;
        }
      }
      const p = drive(card!.approach, `to ${card!.name}`, { name: card!.name, cardId: card!.id });
      if (p.status !== "ok") {
        fail = p.status === "no_path" ? `${card!.name} is unreachable (enclosed by obstacles).` : `${card!.name} can't be reached from here.`;
        break;
      }
      legs.push({ kind: "dwell", label: `looking at ${card!.name}`, seconds: view, battery: 0, stop: { name: card!.name, cardId: card!.id } });
      named.push({ name: card!.name, cardId: card!.id, point: card!.approach });
    } else if (s.kind === "area") {
      const r = resolveArea(env, grid, cursor, s.text);
      if (r.status !== "resolved") {
        fail = "I couldn't find that place.";
        break;
      }
      const p = drive(r.target.point, `to ${r.target.name.toLowerCase()}`, { name: r.target.name });
      if (p.status !== "ok") {
        fail = `${r.target.name} can't be reached.`;
        break;
      }
      named.push({ name: r.target.name, point: r.target.point });
    } else if (s.kind === "special") {
      const p = drive(s.place.base, `to the ramp`, { name: s.place.name });
      if (p.status !== "ok") {
        fail = `The ramp to ${s.place.name} can't be reached.`;
        break;
      }
      legs.push({ kind: "dwell", label: `climbing to ${s.place.name} and back`, seconds: s.place.extraSeconds, battery: s.place.extraBattery, stop: { name: s.place.name } });
      named.push({ name: s.place.name, point: s.place.base });
    } else if (s.kind === "around") {
      const loop = loopAround(env, grid, cursor, s.target);
      if ("issue" in loop) {
        fail = loop.issue;
        break;
      }
      for (const [i, pt] of loop.points.entries()) {
        const p = drive(pt, `around ${s.name} (${i + 1}/${loop.points.length})`, i === loop.points.length - 1 ? { name: `a lap around ${s.name}` } : undefined);
        if (p.status !== "ok") {
          fail = `I can't get around ${s.name} from here.`;
          break;
        }
      }
      if (fail) break;
      named.push({ name: `around ${s.name}`, point: loop.points.at(-1)! });
    }
  }

  const drives = legs.filter((l): l is Extract<Leg, { kind: "drive" }> => l.kind === "drive");
  const meters = drives.reduce((a, l) => a + l.meters, 0);
  const fullPath = drives.flatMap((l, i) => (i === 0 ? l.path : l.path.slice(1)));
  const turnRad = turningAlong(from, fullPath);
  const dwell = legs.reduce((a, l) => a + (l.kind === "dwell" ? l.seconds : 0), 0);
  const dwellBattery = legs.reduce((a, l) => a + (l.kind === "dwell" ? l.battery : 0), 0);
  const home = planPath(grid, cursor, env.dock);
  const homeBattery = home.status === "ok" ? home.length * cfg.perMeter : 0;

  const seconds = meters / opts.speed + turnRad / opts.turnRate + dwell;
  const battery = meters * cfg.perMeter + turnRad * cfg.perRadian + dwellBattery;
  const summary = named.length ? named.map((n) => n.name).join(" → ") : "nowhere";
  return {
    ok: !fail && named.length > 0,
    legs,
    stops: named,
    meters: r2(meters),
    seconds: Math.round(seconds),
    battery: r2(battery),
    homeBattery: r2(homeBattery),
    turnRad: r2(turnRad),
    summary,
    ...(fail ? { issue: fail } : named.length ? {} : { issue: "There's nowhere to go in that request." }),
  };
}
