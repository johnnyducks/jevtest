/**
 * Deterministic target resolution: request text → catalog entity.
 *
 * Never guesses. Several cards matching equally well → "ambiguous", nothing
 * matching → "not_found". The decision engine chooses the *kind* of
 * navigation; this module only maps words to stable IDs and points.
 */
import { AREAS, type Card, type Environment, type Pose, type Vec } from "./environment.ts";
import { fuzzyPhraseIn } from "./fuzzy.ts";
import type { Grid } from "./grid.ts";
import { nearestReachable, planPath } from "./pathfinding.ts";

export type TargetKind = "card" | "nearest_card" | "area";

export interface ResolvedTarget {
  kind: "card" | "area";
  /** Card ID or area ID. */
  id: string;
  name: string;
  /** Point Marty should drive to. */
  point: Vec;
  /** For cards: where the card itself is mounted. */
  cardPosition?: Vec;
}

export type Resolution =
  | { status: "resolved"; target: ResolvedTarget; method: string; matched?: string }
  | { status: "ambiguous"; options: { id: string; name: string }[]; matched: string; method: string }
  | { status: "not_found"; method: string; detail: string };

/** Lower-case, strip punctuation and possessives, collapse spaces. */
export function normalize(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

const aliasNorm = (a: string) => normalize(a);

/**
 * Match card names/aliases as whole phrases. The longest matching phrase wins;
 * if more than one card ties for the longest match, the request is ambiguous.
 */
export function resolveCardByName(env: { cards: Card[] }, text: string, restrictTo?: string[]): Resolution {
  const t = normalize(text);
  const pool = restrictTo ? env.cards.filter((c) => restrictTo.includes(c.id)) : env.cards;
  let bestLen = 0;
  let best: { card: Card; alias: string }[] = [];
  for (const card of pool) {
    let cardBest = "";
    for (const alias of card.aliases) {
      const a = aliasNorm(alias);
      if (t.includes(a) && a.length > cardBest.length) cardBest = a;
    }
    if (!cardBest) continue;
    if (cardBest.length > bestLen) {
      bestLen = cardBest.length;
      best = [{ card, alias: cardBest.trim() }];
    } else if (cardBest.length === bestLen) {
      best.push({ card, alias: cardBest.trim() });
    }
  }
  if (best.length === 1) {
    const c = best[0].card;
    return {
      status: "resolved",
      method: "alias match",
      matched: best[0].alias,
      target: { kind: "card", id: c.id, name: c.name, point: c.approach, cardPosition: c.position },
    };
  }
  if (best.length > 1) {
    return {
      status: "ambiguous",
      method: "alias match",
      matched: best[0].alias,
      options: best.map((b) => ({ id: b.card.id, name: b.card.name })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  return fuzzyCard(pool, t) ?? { status: "not_found", method: "alias match", detail: "No card in the catalog matches that name." };
}

/** Second pass for typos ("heanderson"): closest alias within a small edit distance. Ties → ambiguous. */
function fuzzyCard(pool: Card[], normalized: string): Resolution | null {
  const words = normalized.trim().split(" ").filter(Boolean);
  let best: { card: Card; alias: string; matched: string; distance: number }[] = [];
  for (const card of pool) {
    let cardBest: { alias: string; matched: string; distance: number } | null = null;
    for (const alias of card.aliases) {
      const a = aliasNorm(alias).trim();
      if (a.replace(/ /g, "").length < 4) continue;
      const hit = fuzzyPhraseIn(words, a);
      if (hit && hit.distance > 0 && (!cardBest || hit.distance < cardBest.distance || (hit.distance === cardBest.distance && a.length > cardBest.alias.length))) {
        cardBest = { alias: a, ...hit };
      }
    }
    if (!cardBest) continue;
    if (!best.length || cardBest.distance < best[0].distance) best = [{ card, ...cardBest }];
    else if (cardBest.distance === best[0].distance) best.push({ card, ...cardBest });
  }
  if (!best.length) return null;
  if (best.length === 1) {
    const { card: c, alias, matched } = best[0];
    return {
      status: "resolved",
      method: "fuzzy match",
      matched: `${matched} → ${alias}`,
      target: { kind: "card", id: c.id, name: c.name, point: c.approach, cardPosition: c.position },
    };
  }
  return {
    status: "ambiguous",
    method: "fuzzy match",
    matched: best[0].matched,
    options: best.map((b) => ({ id: b.card.id, name: b.card.name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Nearest card by actual route length (not straight-line), ignoring unreachable cards. */
export function resolveNearestCard(env: Environment, grid: Grid, pose: Pose): Resolution {
  let best: { card: Card; length: number } | null = null;
  for (const card of [...env.cards].sort((a, b) => a.id.localeCompare(b.id))) {
    const plan = planPath(grid, pose, card.approach);
    if (plan.status !== "ok") continue;
    if (!best || plan.length < best.length - 1e-9) best = { card, length: plan.length };
  }
  if (!best) return { status: "not_found", method: "nearest reachable", detail: "No card is reachable from Marty's current position." };
  const c = best.card;
  return {
    status: "resolved",
    method: `nearest reachable (${best.length} m route)`,
    target: { kind: "card", id: c.id, name: c.name, point: c.approach, cardPosition: c.position },
  };
}

/** Named areas, e.g. "the other side of the room". Snapped to the nearest reachable free point. */
export function resolveArea(env: Environment, grid: Grid, pose: Pose, text: string): Resolution {
  const t = normalize(text);
  const area = AREAS.find((a) => a.aliases.some((al) => t.includes(aliasNorm(al))));
  if (!area) return { status: "not_found", method: "area match", detail: "That place is not a named area in this room." };
  let raw: Vec;
  if (area.id === "other-side") raw = { x: env.width - pose.x, y: pose.y };
  else if (area.id === "center") raw = { x: env.width / 2, y: env.height / 2 };
  else raw = env.dock;
  const point = nearestReachable(grid, pose, raw);
  if (!point) return { status: "not_found", method: "area match", detail: "No reachable free space near that area." };
  return {
    status: "resolved",
    method: area.id === "other-side" ? "mirrored across the room's centre line, snapped to free space" : "named area, snapped to free space",
    matched: area.aliases.find((al) => t.includes(aliasNorm(al))),
    target: { kind: "area", id: area.id, name: area.name, point: { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 } },
  };
}

export function resolveTarget(env: Environment, grid: Grid, pose: Pose, kind: TargetKind, text: string): Resolution {
  if (kind === "nearest_card") return resolveNearestCard(env, grid, pose);
  if (kind === "area") return resolveArea(env, grid, pose, text);
  return resolveCardByName(env, text);
}
