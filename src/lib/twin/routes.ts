/**
 * Multi-stop, multi-floor routes.
 *
 * parseRequest(): split a request into ordered stops ("ripken, then bonds,
 * then mantle", "go around the display table", "go to the 3rd floor",
 * "upstairs") and resolve each deterministically. planRoute(): plan every leg
 * with A* on each floor, climbing or descending the switchback ramps between
 * floors, and estimate distance, time and battery, plus the cost of getting
 * to that floor's dock afterwards.
 */
import { BATTERY, type BatteryConfig, turningAlong } from "./battery.ts";
import { type Building, type Card, floorEnv, floorName, type Obstacle, type Pose, type Vec } from "./environment.ts";
import { fuzzyPhraseIn } from "./fuzzy.ts";
import { wrapAngle } from "./geometry.ts";
import { type Grid, isFreePoint } from "./grid.ts";
import { nearestReachable, planPath } from "./pathfinding.ts";
import { normalize, resolveArea, resolveCardByName, resolveNearestCard } from "./resolve.ts";

/** A pose plus the floor it's on. */
export interface FloorPose extends Pose {
  floor: number;
}

export type StopRef =
  | { kind: "card"; card: Card; matched: string; method: string }
  | { kind: "nearest" }
  | { kind: "area"; text: string }
  | { kind: "around"; target: string | "room"; name: string }
  | { kind: "floor"; floor?: number; rel?: 1 | -1; name: string };

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
  "go to the a an then and please marty visit take me drive head over back now after that lets let's quickly card cards first next finally also can you could would like want wanna i we us just on".split(" "),
);

const AROUND = /\b(around|circle|loop|lap|orbit)\b/;

/** Phrases that name a piece of furniture, e.g. "display table", "table", "plinth". */
function obstacleNames(o: Obstacle): string[] {
  const label = o.label.toLowerCase();
  const names = [label, label.split(" ").at(-1)!];
  if (o.kind === "wall") names.push("wall", "partition");
  if (o.kind === "cage") names.push("vault", "cage");
  if (o.kind === "table") names.push("table", "case");
  return [...new Set(names)];
}

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/** "3rd floor", "floor 3", "level three", "top floor", "lobby", "upstairs", "the vault". */
export function parseFloor(seg: string, floors: number): { floor?: number; rel?: 1 | -1 } | null {
  const s = ` ${seg} `;
  let m = /\b(?:floor|level|story|storey)\s+(\d|one|two|three|four|five|six)\b/.exec(s);
  if (m) return { floor: Number(m[1]) || ORDINALS[m[1]] };
  m = /\b(\d)(?:st|nd|rd|th)?\s+(?:floor|level|story|storey)\b/.exec(s);
  if (m) return { floor: Number(m[1]) };
  m = /\b(first|second|third|fourth|fifth|sixth)\s+(?:floor|level|story|storey)\b/.exec(s);
  if (m) return { floor: ORDINALS[m[1]] };
  if (/\b(top floor|top level|the top|penthouse|roof)\b/.test(s)) return { floor: floors };
  if (/\b(ground floor|ground level|lobby|bottom floor|bottom level|main floor)\b/.test(s)) return { floor: 1 };
  if (/\bvault\b/.test(s)) return { floor: floors };
  if (/\b(upstairs|up a floor|up one floor|up a level|next floor up|floor up|go up|head up|up the ramp|climb)\b/.test(s)) return { rel: 1 };
  if (/\b(downstairs|down a floor|down one floor|down a level|floor down|go down|head down|down the ramp)\b/.test(s)) return { rel: -1 };
  return null;
}

/** A segment without filler words, for messages ("go to zorbleflex" → "zorbleflex"). */
export function coreWords(segment: string): string {
  const core = segment
    .split(" ")
    .filter((w) => w && !FILLER.has(w))
    .join(" ");
  return core || segment;
}

export function splitStops(text: string): string[] {
  return normalize(text.replace(/->|→|[,;]/g, " , ").replace(/,/g, " then "))
    .split(/\s*(?:\band then\b|\bthen\b|\bafter that\b|\bfollowed by\b|\band\b)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse a request into ordered stops. Never guesses: unclear parts become issues. */
export function parseRequest(b: Building, text: string): ParsedRequest {
  const segments = splitStops(text);
  const stops: StopRef[] = [];
  const issues: StopIssue[] = [];
  const corrections: string[] = [];
  const allObstacles = b.floors.flatMap((f) => f.obstacles);
  const floors = b.floors.length;

  for (const seg of segments) {
    const n = ` ${seg} `;
    if (AROUND.test(seg)) {
      if (/\b(room|floor|level)\b/.test(seg)) {
        stops.push({ kind: "around", target: "room", name: "the floor" });
        continue;
      }
      // The most specific name wins: "gallery case" over the generic "case".
      const words = seg.split(" ");
      let best: { o: Obstacle; name: string } | null = null;
      for (const o of allObstacles) {
        for (const nm of obstacleNames(o)) {
          if ((n.includes(` ${nm} `) || fuzzyPhraseIn(words, nm)) && (!best || nm.length > best.name.length)) best = { o, name: nm };
        }
      }
      if (best) stops.push({ kind: "around", target: best.name, name: best.o.label.toLowerCase() });
      else issues.push({ segment: coreWords(seg), reason: "not_found" });
      continue;
    }
    const r = resolveCardByName(b, seg);
    const exact = r.method !== "fuzzy match";
    if (exact && r.status === "resolved") {
      stops.push({ kind: "card", card: b.cards.find((c) => c.id === r.target.id)!, matched: r.matched ?? "", method: r.method });
      continue;
    }
    if (exact && r.status === "ambiguous") {
      issues.push({ segment: seg, reason: "ambiguous", options: r.options, matched: r.matched });
      continue;
    }
    const fl = parseFloor(seg, floors);
    if (fl) {
      const name = fl.floor ? `floor ${fl.floor}` : fl.rel === 1 ? "upstairs" : "downstairs";
      stops.push({ kind: "floor", ...fl, name });
      continue;
    }
    if (/\b(nearest|closest)\b/.test(seg)) {
      stops.push({ kind: "nearest" });
      continue;
    }
    if (/\b(other side|opposite side|far side|across the room|across the floor|middle|center|centre|dock|home|charger|charging)\b/.test(seg)) {
      stops.push({ kind: "area", text: seg });
      continue;
    }
    if (r.status === "resolved") {
      stops.push({ kind: "card", card: b.cards.find((c) => c.id === r.target.id)!, matched: r.matched ?? "", method: r.method });
      if (r.matched) corrections.push(r.matched);
    } else if (r.status === "ambiguous") {
      issues.push({ segment: seg, reason: "ambiguous", options: r.options, matched: r.matched });
    } else if (seg.split(" ").some((w) => w.length > 2 && !FILLER.has(w))) {
      issues.push({ segment: coreWords(seg), reason: "not_found" });
    }
  }
  return { segments, stops, issues, corrections };
}

export type Leg =
  | {
      kind: "drive";
      floor: number;
      label: string;
      path: Vec[];
      meters: number;
      stop?: { name: string; cardId?: string };
      /** Heading to turn to on arrival (face the card). */
      face?: number;
    }
  | {
      /** Up or down a ramp: entry → foot → top → exit (or the reverse), in plan coordinates. */
      kind: "ramp";
      from: number;
      to: number;
      label: string;
      path: Vec[];
      meters: number;
      /** Where along the path the incline starts and ends, meters. */
      incline: [number, number];
    }
  | { kind: "dwell"; floor: number; label: string; seconds: number; battery: number; stop?: { name: string; cardId?: string } };

export interface RoutePlan {
  ok: boolean;
  legs: Leg[];
  stops: { name: string; cardId?: string; point: Vec; floor: number }[];
  meters: number;
  seconds: number;
  /** Estimated battery used, %. */
  battery: number;
  /** Estimated % needed afterwards to get back to a dock (on the floor the trip ends on). */
  homeBattery: number;
  turnRad: number;
  /** Floor the trip ends on. */
  endFloor: number;
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

export type FloorGrids = (floor: number) => Grid;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const len = (pts: Vec[]) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);

function loopAround(b: Building, grid: Grid, floor: number, from: Vec, target: string | "room"): { points: Vec[] } | { issue: string } {
  const env = floorEnv(b, floor);
  const margin = grid.inflation + 0.05;
  let corners: Vec[];
  if (target === "room") {
    const inset = grid.inflation + 0.15;
    corners = [
      { x: inset, y: inset },
      { x: env.width - inset, y: inset },
      { x: env.width - inset, y: env.height - inset },
      { x: inset, y: env.height - inset },
    ].map((c) => nearestReachable(grid, from, c) ?? c);
  } else {
    const o = env.obstacles.find((x) => x.kind !== "ramp" && x.kind !== "opening" && obstacleNames(x).includes(target));
    if (!o) return { issue: `There's no ${target} on floor ${floor}.` };
    corners = [
      { x: o.x - margin, y: o.y - margin },
      { x: o.x + o.w + margin, y: o.y - margin },
      { x: o.x + o.w + margin, y: o.y + o.h + margin },
      { x: o.x - margin, y: o.y + o.h + margin },
    ];
    if (corners.some((c) => !isFreePoint(grid, c))) return { issue: `I can't get all the way around the ${o.label.toLowerCase()}; it's too close to a wall or other furniture.` };
  }
  let start = 0;
  corners.forEach((c, i) => {
    if (Math.hypot(c.x - from.x, c.y - from.y) < Math.hypot(corners[start].x - from.x, corners[start].y - from.y)) start = i;
  });
  const ordered = [...corners.slice(start), ...corners.slice(0, start)];
  return { points: [...ordered, ordered[0]] };
}

/** Plan all legs from `from`. Fails (ok: false) on the first unreachable stop, with a reason. */
export function planRoute(b: Building, grids: FloorGrids, from: FloorPose, stops: StopRef[], opts: PlanOptions): RoutePlan {
  const cfg = opts.battery ?? BATTERY;
  const view = opts.viewSeconds ?? 3;
  const legs: Leg[] = [];
  const named: RoutePlan["stops"] = [];
  let cursor: FloorPose = { ...from };
  let fail: string | undefined;
  let turnRad = 0;
  let climb = 0;

  const drive = (to: Vec, label: string, stop?: { name: string; cardId?: string }, face?: number) => {
    const p = planPath(grids(cursor.floor), cursor, to);
    if (p.status !== "ok") return p;
    legs.push({ kind: "drive", floor: cursor.floor, label, path: p.waypoints, meters: p.length, ...(stop ? { stop } : {}), ...(face !== undefined ? { face } : {}) });
    turnRad += turningAlong(cursor, p.waypoints);
    const last = p.waypoints.at(-1)!;
    const prev = p.waypoints.at(-2) ?? cursor;
    let heading = p.waypoints.length > 1 ? Math.atan2(last.y - prev.y, last.x - prev.x) : cursor.heading;
    if (face !== undefined) {
      turnRad += Math.abs(wrapAngle(face - heading));
      heading = face;
    }
    cursor = { ...cursor, x: last.x, y: last.y, heading };
    return p;
  };

  /** Drive to the ramp and take it, one floor at a time, until on `target`. */
  const goToFloor = (target: number): string | undefined => {
    while (cursor.floor !== target) {
      const up = target > cursor.floor;
      const r = up ? b.ramps.find((x) => x.from === cursor.floor) : b.ramps.find((x) => x.to === cursor.floor);
      if (!r) return `There's no ramp ${up ? "up" : "down"} from floor ${cursor.floor}.`;
      const start = up ? r.entry : r.exit;
      const p = drive(start, `to the ramp ${up ? "up" : "down"} (floor ${cursor.floor})`);
      if (p.status !== "ok") return `I can't reach the ramp on floor ${cursor.floor}.`;
      const path = up ? [r.entry, r.foot, r.top, r.exit] : [r.exit, r.top, r.foot, r.entry];
      const a = Math.hypot(path[1].x - path[0].x, path[1].y - path[0].y);
      const inclineLen = Math.hypot(r.top.x - r.foot.x, r.top.y - r.foot.y);
      const next = up ? r.to : r.from;
      legs.push({ kind: "ramp", from: cursor.floor, to: next, label: `${up ? "climbing" : "heading down"} to floor ${next}`, path, meters: r3(len(path)), incline: [r3(a), r3(a + inclineLen)] });
      turnRad += turningAlong(cursor, path);
      if (up) climb += inclineLen;
      const end = path.at(-1)!;
      const before = path.at(-2)!;
      cursor = { x: end.x, y: end.y, heading: Math.atan2(end.y - before.y, end.x - before.x), floor: next };
    }
    return undefined;
  };

  for (const s of stops) {
    if (s.kind === "card" || s.kind === "nearest") {
      let card: Card | undefined = s.kind === "card" ? s.card : undefined;
      if (s.kind === "nearest") {
        const r = resolveNearestCard(floorEnv(b, cursor.floor), grids(cursor.floor), cursor);
        card = r.status === "resolved" ? b.cards.find((c) => c.id === r.target.id) : undefined;
        if (!card) {
          fail = `No card on floor ${cursor.floor} is reachable from here.`;
          break;
        }
      }
      fail = goToFloor(card!.floor);
      if (fail) break;
      // Square up to the card on arrival, so it fills Marty's camera.
      const p = drive(card!.approach, `to ${card!.name}`, { name: card!.name, cardId: card!.id }, Math.atan2(-card!.facing.y, -card!.facing.x));
      if (p.status !== "ok") {
        fail = p.status === "no_path" ? `${card!.name} is unreachable (enclosed by obstacles).` : `${card!.name} can't be reached from here.`;
        break;
      }
      legs.push({ kind: "dwell", floor: cursor.floor, label: `looking at ${card!.name}`, seconds: view, battery: 0, stop: { name: card!.name, cardId: card!.id } });
      named.push({ name: card!.name, cardId: card!.id, point: card!.approach, floor: card!.floor });
    } else if (s.kind === "floor") {
      const target = s.floor ?? cursor.floor + (s.rel ?? 0);
      if (target < 1 || target > b.floors.length) {
        fail = target < 1 ? "I'm already on the ground floor. There's no basement, thankfully." : `There's no floor ${target}. The top floor is ${b.floors.length}.`;
        break;
      }
      fail = goToFloor(target);
      if (fail) break;
      // Pull clear of the ramp into the middle of the floor.
      const env = floorEnv(b, target);
      const mid = nearestReachable(grids(target), cursor, { x: env.width / 2, y: env.height / 2 });
      const name = `floor ${target} (${floorName(b, target)})`;
      if (mid && Math.hypot(mid.x - cursor.x, mid.y - cursor.y) > 0.05) {
        const p = drive(mid, `onto floor ${target}`, { name });
        if (p.status !== "ok") {
          fail = `I can't get onto floor ${target}.`;
          break;
        }
      }
      named.push({ name, point: { x: cursor.x, y: cursor.y }, floor: target });
    } else if (s.kind === "area") {
      const env = floorEnv(b, cursor.floor);
      const r = resolveArea(env, grids(cursor.floor), cursor, s.text);
      if (r.status !== "resolved") {
        fail = "I couldn't find that place.";
        break;
      }
      const p = drive(r.target.point, `to ${r.target.name.toLowerCase()}`, { name: r.target.name });
      if (p.status !== "ok") {
        fail = `${r.target.name} can't be reached.`;
        break;
      }
      named.push({ name: `${r.target.name.toLowerCase()} (floor ${cursor.floor})`, point: r.target.point, floor: cursor.floor });
    } else if (s.kind === "around") {
      const loop = loopAround(b, grids(cursor.floor), cursor.floor, cursor, s.target);
      if ("issue" in loop) {
        fail = loop.issue;
        break;
      }
      const name = s.target === "room" ? `floor ${cursor.floor}` : s.name;
      for (const [i, pt] of loop.points.entries()) {
        const p = drive(pt, `around ${name} (${i + 1}/${loop.points.length})`, i === loop.points.length - 1 ? { name: `a lap around ${name}` } : undefined);
        if (p.status !== "ok") {
          fail = `I can't get around ${name} from here.`;
          break;
        }
      }
      if (fail) break;
      named.push({ name: `around ${name}`, point: loop.points.at(-1)!, floor: cursor.floor });
    }
  }

  const moving = legs.filter((l): l is Exclude<Leg, { kind: "dwell" }> => l.kind !== "dwell");
  const meters = moving.reduce((a, l) => a + l.meters, 0);
  const dwell = legs.reduce((a, l) => a + (l.kind === "dwell" ? l.seconds : 0), 0);
  const dwellBattery = legs.reduce((a, l) => a + (l.kind === "dwell" ? l.battery : 0), 0);
  const home = planPath(grids(cursor.floor), cursor, floorEnv(b, cursor.floor).dock);
  const homeBattery = home.status === "ok" ? home.length * cfg.perMeter : 0;

  const seconds = meters / opts.speed + turnRad / opts.turnRate + dwell;
  const battery = meters * cfg.perMeter + turnRad * cfg.perRadian + climb * cfg.climbPerMeter + dwellBattery;
  const summary = named.length ? named.map((x) => x.name).join(" → ") : "nowhere";
  return {
    ok: !fail && named.length > 0,
    legs,
    stops: named,
    meters: r3(meters),
    seconds: Math.round(seconds),
    battery: Math.round(battery * 100) / 100,
    homeBattery: Math.round(homeBattery * 100) / 100,
    turnRad: Math.round(turnRad * 100) / 100,
    endFloor: cursor.floor,
    summary,
    ...(fail ? { issue: fail } : named.length ? {} : { issue: "There's nowhere to go in that request." }),
  };
}
