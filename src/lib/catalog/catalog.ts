/**
 * The card catalog: the editable list of cards in the building.
 *
 * A CatalogCard is the flat, human-editable form of a Card (one table row).
 * Positions are stored in meters like everything else; the admin table shows
 * them in the viewer's units. Shared by server and browser; pure.
 */
import { APPROACH_DISTANCE, type Building, type Card, clearFloorCache } from "../twin/environment.ts";

export type Facing = "N" | "E" | "S" | "W";

export interface CatalogCard {
  id: string;
  name: string;
  year: number;
  team: string;
  manufacturer: string;
  /** Set / release, e.g. "1952 Topps", "1982 Topps Traded", "T206". */
  set: string;
  /** Printed card number, e.g. "311", "98T", "US175". Empty when none. */
  number: string;
  floor: number;
  /** Where the card is mounted on its floor (meters from the west and south walls). */
  x: number;
  y: number;
  /** Which way the card faces (Marty parks in front of it on that side). */
  facing: Facing;
  points: number;
  /** Extra names viewers can use, comma-separated ("the mick, mickey"). The full and last name always work. */
  aliases: string;
  /** Lahman player ID for baseball facts (e.g. "mantlmi01"); empty = no stats. */
  lahmanId: string;
  wikipediaTitle: string;
  /** CardSight AI card UUID, to pin the exact card instead of searching. */
  cardsightId: string;
  note: string;
}

export const FACING: Record<Facing, { x: number; y: number }> = {
  N: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: -1 },
  W: { x: -1, y: 0 },
};

const facingOf = (v: { x: number; y: number }): Facing => (Math.abs(v.x) > Math.abs(v.y) ? (v.x > 0 ? "E" : "W") : v.y > 0 ? "N" : "S");
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

/** The names a card always answers to: full name, and last name (ignoring Jr./Sr.). */
function autoAliases(name: string): string[] {
  const words = name.toLowerCase().replace(/[.]/g, "").split(/\s+/).filter(Boolean);
  const core = words.filter((w) => !SUFFIX.test(w));
  return [...new Set([name.toLowerCase(), core.join(" "), core.at(-1) ?? ""].filter(Boolean))];
}

export function toCatalogCard(c: Card): CatalogCard {
  const auto = new Set(autoAliases(c.name));
  return {
    id: c.id,
    name: c.name,
    year: c.year,
    team: c.team,
    manufacturer: c.meta.manufacturer ?? "",
    set: c.meta.set ?? "",
    number: c.meta.number ?? "",
    floor: c.floor,
    x: c.position.x,
    y: c.position.y,
    facing: facingOf(c.facing),
    points: c.points,
    aliases: c.aliases.filter((a) => !auto.has(a)).join(", "),
    lahmanId: c.player.lahmanId,
    wikipediaTitle: c.player.wikipediaTitle,
    cardsightId: c.cardsightId ?? "",
    note: c.note ?? "",
  };
}

export function cardFromCatalog(c: CatalogCard): Card {
  const facing = FACING[c.facing];
  const extra = c.aliases
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  return {
    id: c.id,
    floor: c.floor,
    name: c.name.trim(),
    aliases: [...new Set([...autoAliases(c.name.trim()), ...extra])],
    year: c.year,
    team: c.team.trim(),
    position: { x: c.x, y: c.y },
    facing,
    approach: { x: r4(c.x + facing.x * APPROACH_DISTANCE), y: r4(c.y + facing.y * APPROACH_DISTANCE) },
    points: c.points,
    player: { lahmanId: c.lahmanId.trim(), wikipediaTitle: c.wikipediaTitle.trim() || c.name.trim() },
    meta: {
      manufacturer: c.manufacturer.trim() || null,
      set: c.set.trim() || null,
      issueYear: c.year,
      teamShown: c.team.trim(),
      seasonRepresented: null,
      identification: "catalog",
      number: c.number.trim() || null,
    },
    ...(c.cardsightId.trim() ? { cardsightId: c.cardsightId.trim() } : {}),
    ...(c.note.trim() ? { note: c.note.trim() } : {}),
  };
}

/** Replace the building's cards with the catalog (in place, so everything holding the list sees it). */
export function applyCatalog(b: Building, list: CatalogCard[]) {
  b.cards.splice(0, b.cards.length, ...list.map(cardFromCatalog));
  clearFloorCache(b);
}

/** A stable id for a new card: "mantle-52" style. */
export function newCardId(name: string, year: number, taken: Set<string>): string {
  const last = autoAliases(name).at(-1) ?? "card";
  const base = `${last.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card"}-${String(year).slice(-2)}`;
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** Fields that decide which real card this is: when they change, CardSight looks it up again. */
export const identityOf = (c: { name: string; year: number; set: string | null; manufacturer: string | null; number: string | null; cardsightId?: string }) =>
  [c.name, c.year, c.set ?? "", c.manufacturer ?? "", c.number ?? "", c.cardsightId ?? ""].join("|").toLowerCase();

export interface CatalogIssue {
  id: string;
  field?: keyof CatalogCard;
  level: "error" | "warning";
  message: string;
}

/** Check a catalog for mistakes. Errors block saving; warnings are shown (e.g. a card Marty can't reach). */
export function validateCatalog(b: Pick<Building, "width" | "height" | "floors">, list: CatalogCard[], reachable?: (card: Card) => boolean): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const ids = new Set<string>();
  const floors = b.floors.map((f) => f.level);
  for (const c of list) {
    const err = (field: keyof CatalogCard, message: string) => issues.push({ id: c.id, field, level: "error", message });
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(c.id)) err("id", "IDs are lower-case letters, numbers and dashes.");
    if (ids.has(c.id)) err("id", `Two cards share the ID "${c.id}".`);
    ids.add(c.id);
    if (!c.name.trim()) err("name", "Every card needs a name.");
    if (!Number.isInteger(c.year) || c.year < 1860 || c.year > 2100) err("year", "Year should be between 1860 and 2100.");
    if (!floors.includes(c.floor)) err("floor", `Floor must be ${floors[0]}–${floors.at(-1)}.`);
    const eps = 1e-6; // cards hang right on the outer walls
    if (!(c.x >= -eps && c.x <= b.width + eps && c.y >= -eps && c.y <= b.height + eps)) err("x", "The position is outside the floor.");
    if (!FACING[c.facing]) err("facing", "Facing must be N, E, S or W.");
    if (!Number.isFinite(c.points) || c.points < 0 || c.points > 1000) err("points", "Points should be 0–1000.");
    if (c.lahmanId && !/^[a-z]{2,7}\d{2}$/.test(c.lahmanId)) issues.push({ id: c.id, field: "lahmanId", level: "warning", message: "That doesn't look like a Lahman ID (e.g. mantlmi01)." });
  }
  if (reachable) {
    for (const c of list) {
      if (issues.some((i) => i.id === c.id && i.level === "error")) continue;
      if (!reachable(cardFromCatalog(c))) {
        issues.push({ id: c.id, field: "x", level: "warning", message: "Marty can't reach the spot in front of this card (blocked or walled off). It will be shown but never visited." });
      }
    }
  }
  return issues;
}
