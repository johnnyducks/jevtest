/**
 * The card catalog on the server. SERVER ONLY.
 *
 * The built-in cards live in lib/twin/environment.ts. Once you edit the catalog,
 * the whole list is saved to catalog.json in the data folder (~/.marty-live by
 * default, outside the project, so it survives app updates) and used instead.
 */
import fs from "node:fs";
import { dataFile } from "../datadir.ts";
import { BUILDING, type Card, DEFAULT_CARDS, floorEnv } from "../twin/environment.ts";
import { buildGrid, connected, type Grid, isFreePoint } from "../twin/grid.ts";
import { applyCatalog, type CatalogCard, type CatalogIssue, toCatalogCard, validateCatalog } from "./catalog.ts";

/** Finds a Lahman player ID from a name when it's unambiguous (supplied by the caller: the baseball knowledge service). */
export type PlayerLookup = (name: string) => string | null;

const FILE = () => dataFile("catalog.json");

const g = globalThis as unknown as { __martyCatalog?: { loaded: boolean; listeners: Set<() => void>; grids: Map<number, Grid> } };
const st = () => (g.__martyCatalog ??= { loaded: false, listeners: new Set(), grids: new Map() });

function grid(floor: number) {
  const s = st();
  let gr = s.grids.get(floor);
  if (!gr) s.grids.set(floor, (gr = buildGrid(floorEnv(BUILDING, floor))));
  return gr;
}

/** Can Marty get to the spot in front of this card from its floor's dock? */
export function reachable(card: Card): boolean {
  if (!BUILDING.floors.some((f) => f.level === card.floor)) return false;
  const gr = grid(card.floor);
  return isFreePoint(gr, card.approach) && connected(gr, floorEnv(BUILDING, card.floor).dock, card.approach);
}

/** Load the saved catalog once (idempotent). A missing or broken file means the built-in cards. */
export function ensureCatalog() {
  const s = st();
  if (s.loaded) return;
  s.loaded = true;
  try {
    const body = JSON.parse(fs.readFileSync(FILE(), "utf8")) as { cards?: CatalogCard[] };
    const list = Array.isArray(body.cards) ? body.cards.map(normalizeRow) : null;
    if (!list?.length) return;
    const errors = validateCatalog(BUILDING, list).filter((i) => i.level === "error");
    if (errors.length) {
      console.warn(`Card catalog at ${FILE()} has problems (${errors[0].message}); using the built-in cards.`);
      return;
    }
    applyCatalog(BUILDING, list);
    console.log(`Card catalog: ${list.length} cards from ${FILE()}`);
  } catch {
    /* no saved catalog yet: built-in cards */
  }
}

export function onCatalogChange(fn: () => void) {
  st().listeners.add(fn);
  return () => st().listeners.delete(fn);
}

export interface CatalogState {
  cards: CatalogCard[];
  issues: CatalogIssue[];
  /** "custom" once you've saved edits; "built-in" otherwise. */
  source: "custom" | "built-in";
  file: string;
  floors: { level: number; name: string }[];
  size: { width: number; height: number };
}

export function catalogState(): CatalogState {
  ensureCatalog();
  const cards = BUILDING.cards.map(toCatalogCard);
  return {
    cards,
    issues: validateCatalog(BUILDING, cards, reachable),
    source: fs.existsSync(FILE()) ? "custom" : "built-in",
    file: FILE(),
    floors: BUILDING.floors.map((f) => ({ level: f.level, name: f.name })),
    size: { width: BUILDING.width, height: BUILDING.height },
  };
}

const str = (v: unknown, n = 120) => (typeof v === "string" ? v.slice(0, n) : v == null ? "" : String(v).slice(0, n));
const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

/** Coerce an untrusted row from the browser into a CatalogCard. */
export function normalizeRow(v: unknown): CatalogCard {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const facing = str(r.facing, 1).toUpperCase();
  return {
    id: str(r.id, 41).trim().toLowerCase(),
    name: str(r.name, 80),
    year: Math.round(num(r.year)),
    team: str(r.team, 60),
    manufacturer: str(r.manufacturer, 60),
    set: str(r.set, 80),
    number: str(r.number, 20),
    floor: Math.round(num(r.floor)),
    x: num(r.x),
    y: num(r.y),
    facing: (["N", "E", "S", "W"].includes(facing) ? facing : "N") as CatalogCard["facing"],
    points: Math.round(num(r.points)),
    aliases: str(r.aliases, 300),
    lahmanId: str(r.lahmanId, 12).trim().toLowerCase(),
    wikipediaTitle: str(r.wikipediaTitle, 120),
    cardsightId: str(r.cardsightId, 64).trim(),
    note: str(r.note, 300),
  };
}

/** Fill in what we can work out: a Lahman ID from the player's name, when it's unambiguous. */
function enrich(c: CatalogCard, lookup?: PlayerLookup): CatalogCard {
  if (c.lahmanId || !lookup) return c;
  try {
    const id = lookup(c.name);
    if (id) return { ...c, lahmanId: id };
  } catch {
    /* knowledge is optional */
  }
  return c;
}

/** Validate, save to disk and apply. Errors block the save; warnings don't. */
export function saveCatalog(rows: unknown[], lookup?: PlayerLookup): { ok: true; state: CatalogState } | { ok: false; issues: CatalogIssue[] } {
  ensureCatalog();
  const list = rows.map(normalizeRow).map((c) => enrich(c, lookup));
  const issues = validateCatalog(BUILDING, list, reachable);
  if (issues.some((i) => i.level === "error")) return { ok: false, issues };
  fs.mkdirSync(dataFile(""), { recursive: true });
  const body = { note: "Marty's card catalog. Edit it in the app (Cards → Edit). Delete this file to go back to the built-in cards.", savedAt: new Date().toISOString(), cards: list };
  fs.writeFileSync(FILE(), `${JSON.stringify(body, null, 2)}\n`);
  applyCatalog(BUILDING, list);
  for (const fn of st().listeners) fn();
  return { ok: true, state: catalogState() };
}

/** Back to the built-in cards (removes the saved catalog). */
export function resetCatalog(): CatalogState {
  ensureCatalog();
  try {
    fs.rmSync(FILE());
  } catch {
    /* nothing saved */
  }
  applyCatalog(BUILDING, DEFAULT_CARDS.map(toCatalogCard));
  for (const fn of st().listeners) fn();
  return catalogState();
}
