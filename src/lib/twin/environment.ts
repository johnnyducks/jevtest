/**
 * Marty's building: six stacked 4 ft × 8 ft floors, 16 in apart, joined by
 * long switchback ramps. Fictional; nothing here maps to a real place.
 *
 * Units are meters everywhere in code (the UI can show inches). Each floor's
 * origin is its south-west corner: +x east along the 8 ft side, +y north
 * along the 4 ft side. Floors are numbered 1 (ground) to 6 (top).
 */

export interface Vec {
  x: number;
  y: number;
}

/** Robot pose on a floor. Heading is radians, 0 = +x (east), counter-clockwise positive. */
export interface Pose extends Vec {
  heading: number;
}

export interface Obstacle {
  id: string;
  label: string;
  /** ramp: the inclined lane up to the next floor. opening: the hole where the ramp from below arrives. */
  kind: "wall" | "shelf" | "table" | "plinth" | "equipment" | "cage" | "ramp" | "opening";
  /** Axis-aligned rectangle: bottom-left corner plus size, in meters. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Link from a card to baseball knowledge records. */
export interface CardPlayer {
  /** Canonical Lahman playerID (verified against People.csv). */
  lahmanId: string;
  /** Exact English Wikipedia article title, used for supplemental facts only. */
  wikipediaTitle: string;
}

/** What is known about the physical card. Unknown fields are null, never guessed. */
export interface CardMeta {
  manufacturer: string | null;
  set: string | null;
  issueYear: number;
  teamShown: string;
  seasonRepresented: number | null;
  identification: "catalog";
  /** Printed card number ("311", "98T", "US175"); null when the card has none or it isn't known. */
  number: string | null;
}

export interface Card {
  /** Stable entity ID, used internally everywhere. */
  id: string;
  name: string;
  /** Lower-case phrases that refer to this card (full name included). */
  aliases: string[];
  year: number;
  team: string;
  /** Floor the card is on (1–6). */
  floor: number;
  /** Where the card is mounted. */
  position: Vec;
  /** Unit vector the card faces (out of the surface it is mounted on). */
  facing: Vec;
  /** Point in free space where Marty stops to view the card. */
  approach: Vec;
  /** Base points for visiting this card (game layer). */
  points: number;
  /** CardSight AI card UUID, when pinned by hand (skips the search). */
  cardsightId?: string;
  player: CardPlayer;
  meta: CardMeta;
  note?: string;
}

export interface Area {
  id: string;
  name: string;
  aliases: string[];
}

/** One ramp between two floors. Marty drives entry → foot → top → exit in a straight line along the lane. */
export interface Ramp {
  id: string;
  /** Lower and upper floor. */
  from: number;
  to: number;
  /** The inclined lane, in plan. */
  lane: { x: number; y: number; w: number; h: number };
  /** Bottom and top of the incline (plan coordinates, lane centre line). */
  foot: Vec;
  top: Vec;
  /** Where Marty lines up on the lower floor, and where he arrives on the upper floor. */
  entry: Vec;
  exit: Vec;
}

export interface FloorDef {
  level: number;
  name: string;
  /** Furniture and walls on this floor (ramp lanes and openings are added automatically). */
  obstacles: Obstacle[];
  dock: Vec;
}

/** Physical sizes, meters. */
export const IN = 0.0254;
export const DIMENSIONS = {
  floorWidth: 96 * IN, // 8 ft, east–west
  floorDepth: 48 * IN, // 4 ft, north–south
  floorHeight: 16 * IN, // floor to floor
  slab: 0.75 * IN,
  botWidth: 4 * IN,
  botLength: 4.3 * IN,
  cardWidth: 2.5 * IN,
  cardHeight: 3.5 * IN,
  rampLength: 64 * IN, // 16 in rise over 64 in run ≈ 14°: gentle enough for the treads
  rampWidth: 7.5 * IN,
};

/** A single floor as the planner sees it: one level's obstacles (incl. ramps and openings), cards and dock. */
export interface Environment {
  level: number;
  name: string;
  width: number;
  height: number;
  /** Robot footprint radius (half its diagonal: it turns in place) plus safety clearance, meters. */
  robotRadius: number;
  clearance: number;
  /** Occupancy-grid resolution, meters per cell. */
  resolution: number;
  obstacles: Obstacle[];
  cards: Card[];
  dock: Vec;
  defaultPose: Pose;
}

export interface Building {
  width: number;
  height: number;
  floorHeight: number;
  robotRadius: number;
  clearance: number;
  resolution: number;
  floors: FloorDef[];
  ramps: Ramp[];
  /** Every card in the building. */
  cards: Card[];
  defaultPose: Pose;
  defaultFloor: number;
}

const W = DIMENSIONS.floorWidth;
const D = DIMENSIONS.floorDepth;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Distance from a card's surface to where Marty parks to look at it (close: the card should fill his camera). */
export const APPROACH_DISTANCE = 0.13;

/** Base points per card: roughly how sought-after the card is. Data, not code. */
const CARD_POINTS: Record<string, number> = {
  "ruth-33": 100,
  "wagner-t206": 100,
  "gehrig-33": 70,
  "cobb-t206": 70,
  "mantle-52": 60,
  "dimaggio-41": 60,
  "mays-52": 55,
  "robinson-52": 50,
  "williams-54": 50,
  "clemente-55": 50,
  "koufax-55": 45,
  "ohtani-18": 45,
  "aaron-54": 40,
  "ryan-68": 40,
  "trout-11": 40,
  "griffey-89": 35,
  "banks-54": 35,
  "jeter-93": 35,
  "maris-58": 30,
  "bench-68": 30,
  "jackson-69": 30,
  "henderson-80": 25,
  "ripken-82": 25,
  "rose-63": 25,
  "schmidt-73": 25,
  "brett-75": 25,
  "bobby-bonds-69": 15,
};

/** Printed card numbers: the well-known base-set numbers for these issues (T206 cards are unnumbered). */
const CARD_NUMBERS: Record<string, string> = {
  "griffey-89": "1",
  "henderson-80": "482",
  "bobby-bonds-69": "630",
  "barry-bonds-87": "320",
  "ripken-82": "98T",
  "aaron-54": "128",
  "robinson-52": "312",
  "ichiro-01": "726",
  "mantle-52": "311",
  "rose-63": "537",
  "ohtani-18": "US1",
  "jeter-93": "279",
  "trout-11": "US175",
  "pujols-01": "340",
  "gwynn-83": "482",
  "mattingly-84": "248",
  "mcgwire-85": "401",
  "thomas-90": "300",
  "schmidt-73": "615",
  "brett-75": "228",
  "ozzie-79": "116",
  "jackson-69": "260",
  "maris-58": "47",
  "ryan-68": "177",
  "bench-68": "247",
  "koufax-55": "123",
  "mays-52": "261",
  "banks-54": "94",
  "williams-54": "1",
  "clemente-55": "164",
  "ruth-33": "53",
  "gehrig-33": "92",
  "dimaggio-41": "71",
};

const EAST = { x: 1, y: 0 };
const WEST = { x: -1, y: 0 };
const NORTH = { x: 0, y: 1 };
const SOUTH = { x: 0, y: -1 };

function card(
  id: string,
  floor: number,
  name: string,
  aliases: string[],
  year: number,
  team: string,
  position: Vec,
  facing: Vec,
  player: CardPlayer,
  meta: { manufacturer: string | null; set: string | null },
  note?: string,
): Card {
  return {
    id,
    floor,
    name,
    player,
    points: CARD_POINTS[id] ?? 20,
    meta: { ...meta, issueYear: year, teamShown: team, seasonRepresented: null, identification: "catalog", number: CARD_NUMBERS[id] ?? null },
    aliases: [...new Set([name.toLowerCase(), ...aliases])],
    year,
    team,
    position,
    facing,
    approach: { x: r4(position.x + facing.x * APPROACH_DISTANCE), y: r4(position.y + facing.y * APPROACH_DISTANCE) },
    ...(note ? { note } : {}),
  };
}

// ── Ramps: a switchback, like a parking garage ─────────────────────────────
// Odd floors climb along the south wall heading east; even floors climb along
// the north wall heading west. Each lane is 64 in long and 7.5 in wide.

const RAMP_X0 = 16 * IN; // west end of the incline
const RAMP_X1 = RAMP_X0 + DIMENSIONS.rampLength; // east end
const LANE = DIMENSIONS.rampWidth;
const LINE_UP = 0.13; // how far before/after the incline Marty lines up

function ramp(from: number): Ramp {
  const south = from % 2 === 1;
  const y = south ? 0 : D - LANE;
  const cy = y + LANE / 2;
  const west = { x: RAMP_X0, y: cy };
  const east = { x: RAMP_X1, y: cy };
  const foot = south ? west : east;
  const top = south ? east : west;
  const dir = south ? 1 : -1;
  return {
    id: `ramp-${from}-${from + 1}`,
    from,
    to: from + 1,
    lane: { x: RAMP_X0, y, w: RAMP_X1 - RAMP_X0, h: LANE },
    foot,
    top,
    entry: { x: r4(foot.x - dir * LINE_UP), y: r4(cy) },
    exit: { x: r4(top.x + dir * LINE_UP), y: r4(cy) },
  };
}

const RAMPS: Ramp[] = [1, 2, 3, 4, 5].map(ramp);

// ── Floors ────────────────────────────────────────────────────────────────

const DOCK = { x: 0.13, y: 0.5 };

const FLOORS: FloorDef[] = [
  {
    level: 1,
    name: "Lobby · Modern era",
    dock: DOCK,
    obstacles: [
      { id: "f1-desk", label: "Welcome desk", kind: "table", x: 0.85, y: 0.45, w: 0.4, h: 0.3 },
      { id: "f1-plinth", label: "Plinth", kind: "plinth", x: 1.65, y: 0.55, w: 0.2, h: 0.2 },
    ],
  },
  {
    level: 2,
    name: "The '80s & '90s",
    dock: DOCK,
    obstacles: [
      { id: "f2-case", label: "Display case", kind: "table", x: 0.55, y: 0.5, w: 0.25, h: 0.22 },
      { id: "f2-wall", label: "Partition", kind: "wall", x: 1.1, y: 0.4, w: 0.04, h: 0.42 },
      { id: "f2-plinth", label: "Plinth", kind: "plinth", x: 1.7, y: 0.52, w: 0.16, h: 0.16 },
    ],
  },
  {
    level: 3,
    name: "The '70s",
    dock: DOCK,
    obstacles: [
      { id: "f3-table", label: "Display table", kind: "table", x: 1.0, y: 0.45, w: 0.3, h: 0.3 },
      { id: "f3-shelf", label: "Shelf", kind: "shelf", x: 2.28, y: 0.35, w: W - 2.28, h: 0.5 },
    ],
  },
  {
    level: 4,
    name: "The '60s",
    dock: DOCK,
    obstacles: [
      { id: "f4-plinth-a", label: "Plinth A", kind: "plinth", x: 0.6, y: 0.52, w: 0.16, h: 0.16 },
      { id: "f4-plinth-b", label: "Plinth B", kind: "plinth", x: 1.4, y: 0.52, w: 0.16, h: 0.16 },
      { id: "f4-case", label: "Display case", kind: "table", x: 1.9, y: 0.5, w: 0.2, h: 0.22 },
    ],
  },
  {
    level: 5,
    name: "The '50s",
    dock: DOCK,
    obstacles: [
      { id: "f5-gallery", label: "Gallery case", kind: "table", x: 0.75, y: 0.52, w: 1.0, h: 0.18 },
      { id: "f5-plinth", label: "Plinth", kind: "plinth", x: 2.1, y: 0.53, w: 0.16, h: 0.16 },
    ],
  },
  {
    level: 6,
    name: "The Vault · Pre-war",
    dock: DOCK,
    obstacles: [
      { id: "f6-pedestal", label: "Pedestal", kind: "plinth", x: 1.05, y: 0.5, w: 0.2, h: 0.2 },
      { id: "f6-cage-s", label: "Vault cage", kind: "cage", x: 0, y: 0.85, w: 0.47, h: 0.02 },
      { id: "f6-cage-e", label: "Vault cage", kind: "cage", x: 0.45, y: 0.85, w: 0.02, h: D - 0.85 },
    ],
  },
];

const P = (lahmanId: string, wikipediaTitle: string): CardPlayer => ({ lahmanId, wikipediaTitle });
const topps = (year: number) => ({ manufacturer: "Topps", set: `${year} Topps` });

const CARDS: Card[] = [
  // Floor 1 · Lobby, modern era
  card("griffey-89", 1, "Ken Griffey Jr.", ["griffey", "ken griffey", "griffey jr", "junior", "the kid"], 1989, "Mariners", { x: W, y: 0.61 }, WEST, P("griffke02", "Ken Griffey Jr."), { manufacturer: "Upper Deck", set: "1989 Upper Deck" }),
  card("ichiro-01", 1, "Ichiro Suzuki", ["ichiro", "suzuki", "ichiro suzuki"], 2001, "Mariners", { x: W, y: 0.95 }, WEST, P("suzukic01", "Ichiro Suzuki"), topps(2001)),
  card("ohtani-18", 1, "Shohei Ohtani", ["ohtani", "shohei", "shohei ohtani", "shotime"], 2018, "Angels", { x: W, y: 0.3 }, WEST, P("ohtansh01", "Shohei Ohtani"), { manufacturer: "Topps", set: "2018 Topps Update" }),
  card("jeter-93", 1, "Derek Jeter", ["jeter", "derek jeter", "the captain"], 1993, "Yankees", { x: 1.05, y: 0.75 }, NORTH, P("jeterde01", "Derek Jeter"), { manufacturer: "Upper Deck", set: "1993 SP" }),
  card("trout-11", 1, "Mike Trout", ["trout", "mike trout"], 2011, "Angels", { x: 1.05, y: 0.45 }, SOUTH, P("troutmi01", "Mike Trout"), { manufacturer: "Topps", set: "2011 Topps Update" }),
  card("pujols-01", 1, "Albert Pujols", ["pujols", "albert pujols", "el hombre"], 2001, "Cardinals", { x: 1.65, y: 0.65 }, WEST, P("pujolal01", "Albert Pujols"), { manufacturer: "Bowman", set: "2001 Bowman Chrome" }),

  // Floor 2 · the '80s and '90s
  card("henderson-80", 2, "Rickey Henderson", ["rickey", "henderson", "rickey henderson"], 1980, "Athletics", { x: 1.1, y: 0.7 }, WEST, P("henderi01", "Rickey Henderson"), topps(1980)),
  card("ripken-82", 2, "Cal Ripken Jr.", ["ripken", "cal ripken", "cal", "iron man"], 1982, "Orioles", { x: 1.14, y: 0.7 }, EAST, P("ripkeca01", "Cal Ripken Jr."), { manufacturer: "Topps", set: "1982 Topps Traded" }),
  card("gwynn-83", 2, "Tony Gwynn", ["gwynn", "tony gwynn", "mr padre"], 1983, "Padres", { x: 1.1, y: 0.52 }, WEST, P("gwynnto01", "Tony Gwynn"), topps(1983)),
  card("mattingly-84", 2, "Don Mattingly", ["mattingly", "don mattingly", "donnie baseball"], 1984, "Yankees", { x: 1.14, y: 0.52 }, EAST, P("mattido01", "Don Mattingly"), { manufacturer: "Donruss", set: "1984 Donruss" }),
  card("mcgwire-85", 2, "Mark McGwire", ["mcgwire", "mark mcgwire", "big mac"], 1985, "USA", { x: 0.675, y: 0.72 }, NORTH, P("mcgwima01", "Mark McGwire"), topps(1985)),
  card("barry-bonds-87", 2, "Barry Bonds", ["bonds", "barry", "barry bonds"], 1987, "Pirates", { x: 1.86, y: 0.6 }, EAST, P("bondsba01", "Barry Bonds"), topps(1987)),
  card("thomas-90", 2, "Frank Thomas", ["thomas", "frank thomas", "big hurt", "the big hurt"], 1990, "White Sox", { x: W, y: 0.61 }, WEST, P("thomafr04", "Frank Thomas (designated hitter)"), { manufacturer: "Leaf", set: "1990 Leaf" }),

  // Floor 3 · the '70s
  card("schmidt-73", 3, "Mike Schmidt", ["schmidt", "mike schmidt"], 1973, "Phillies", { x: 1.0, y: 0.6 }, WEST, P("schmimi01", "Mike Schmidt"), topps(1973)),
  card("brett-75", 3, "George Brett", ["brett", "george brett"], 1975, "Royals", { x: 1.3, y: 0.6 }, EAST, P("brettge01", "George Brett"), topps(1975)),
  card("ozzie-79", 3, "Ozzie Smith", ["ozzie", "ozzie smith", "smith", "the wizard"], 1979, "Padres", { x: 1.15, y: 0.75 }, NORTH, P("smithoz01", "Ozzie Smith"), topps(1979)),
  card("jackson-69", 3, "Reggie Jackson", ["reggie", "jackson", "reggie jackson", "mr october"], 1969, "Athletics", { x: 2.28, y: 0.72 }, WEST, P("jacksre01", "Reggie Jackson"), topps(1969)),
  card("bobby-bonds-69", 3, "Bobby Bonds", ["bonds", "bobby", "bobby bonds"], 1969, "Giants", { x: 2.28, y: 0.48 }, WEST, P("bondsbo01", "Bobby Bonds"), topps(1969)),

  // Floor 4 · the '60s
  card("maris-58", 4, "Roger Maris", ["maris", "roger maris"], 1958, "Indians", { x: 0.6, y: 0.6 }, WEST, P("marisro01", "Roger Maris"), topps(1958)),
  card("rose-63", 4, "Pete Rose", ["rose", "pete rose", "charlie hustle"], 1963, "Reds", { x: 0.76, y: 0.6 }, EAST, P("rosepe01", "Pete Rose"), topps(1963)),
  card("ryan-68", 4, "Nolan Ryan", ["ryan", "nolan ryan", "the ryan express"], 1968, "Mets", { x: 1.4, y: 0.6 }, WEST, P("ryanno01", "Nolan Ryan"), topps(1968)),
  card("bench-68", 4, "Johnny Bench", ["bench", "johnny bench"], 1968, "Reds", { x: 1.56, y: 0.6 }, EAST, P("benchjo01", "Johnny Bench"), topps(1968)),
  card("koufax-55", 4, "Sandy Koufax", ["koufax", "sandy koufax", "sandy"], 1955, "Dodgers", { x: 2.1, y: 0.61 }, EAST, P("koufasa01", "Sandy Koufax"), topps(1955)),

  // Floor 5 · the '50s
  card("robinson-52", 5, "Jackie Robinson", ["jackie", "robinson", "jackie robinson"], 1952, "Dodgers", { x: 0.95, y: 0.52 }, SOUTH, P("robinja02", "Jackie Robinson"), topps(1952)),
  card("mantle-52", 5, "Mickey Mantle", ["mantle", "mickey", "mickey mantle", "the mick"], 1952, "Yankees", { x: 1.25, y: 0.52 }, SOUTH, P("mantlmi01", "Mickey Mantle"), topps(1952)),
  card("mays-52", 5, "Willie Mays", ["mays", "willie mays", "say hey kid", "the say hey kid"], 1952, "Giants", { x: 1.55, y: 0.52 }, SOUTH, P("mayswi01", "Willie Mays"), topps(1952)),
  card("aaron-54", 5, "Hank Aaron", ["aaron", "hank", "hank aaron", "hammerin hank"], 1954, "Braves", { x: 0.95, y: 0.7 }, NORTH, P("aaronha01", "Hank Aaron"), topps(1954)),
  card("banks-54", 5, "Ernie Banks", ["banks", "ernie banks", "mr cub"], 1954, "Cubs", { x: 1.25, y: 0.7 }, NORTH, P("bankser01", "Ernie Banks"), topps(1954)),
  card("williams-54", 5, "Ted Williams", ["williams", "ted williams", "teddy ballgame", "the splendid splinter"], 1954, "Red Sox", { x: 1.55, y: 0.7 }, NORTH, P("willite01", "Ted Williams"), topps(1954)),
  card("clemente-55", 5, "Roberto Clemente", ["clemente", "roberto clemente"], 1955, "Pirates", { x: 2.1, y: 0.61 }, WEST, P("clemero01", "Roberto Clemente"), topps(1955)),

  // Floor 6 · the Vault, pre-war
  card("ruth-33", 6, "Babe Ruth", ["ruth", "babe", "babe ruth", "the babe", "the bambino"], 1933, "Yankees", { x: 0.95, y: D }, SOUTH, P("ruthba01", "Babe Ruth"), { manufacturer: "Goudey", set: "1933 Goudey" }),
  card("gehrig-33", 6, "Lou Gehrig", ["gehrig", "lou gehrig", "the iron horse"], 1933, "Yankees", { x: 1.45, y: D }, SOUTH, P("gehrilo01", "Lou Gehrig"), { manufacturer: "Goudey", set: "1933 Goudey" }),
  card("cobb-t206", 6, "Ty Cobb", ["cobb", "ty cobb", "the georgia peach"], 1909, "Tigers", { x: 1.05, y: 0.6 }, WEST, P("cobbty01", "Ty Cobb"), { manufacturer: "American Tobacco Company", set: "T206" }),
  card("dimaggio-41", 6, "Joe DiMaggio", ["dimaggio", "joe dimaggio", "joltin joe", "the yankee clipper"], 1941, "Yankees", { x: 1.25, y: 0.6 }, EAST, P("dimagjo01", "Joe DiMaggio"), { manufacturer: "Gum, Inc.", set: "1941 Play Ball" }),
  card("wagner-t206", 6, "Honus Wagner", ["wagner", "honus", "honus wagner", "t206"], 1909, "Pirates", { x: 0.22, y: D }, SOUTH, P("wagneho01", "Honus Wagner"), { manufacturer: "American Tobacco Company", set: "T206" }, "Locked inside the vault cage. No opening, so it is unreachable by design."),
];

export const BUILDING: Building = {
  width: W,
  height: D,
  floorHeight: DIMENSIONS.floorHeight,
  // Half the diagonal of a 4 × 4.3 in body: the footprint swept when turning in place.
  robotRadius: r4(Math.hypot(DIMENSIONS.botWidth, DIMENSIONS.botLength) / 2),
  clearance: 0.5 * IN,
  resolution: 0.01,
  floors: FLOORS,
  ramps: RAMPS,
  cards: [...CARDS],
  defaultPose: { x: 0.3, y: 0.5, heading: 0 },
  defaultFloor: 1,
};

/** Kept for code that only needs the card catalog. */
export const ENVIRONMENT = BUILDING;

/** Ramp lanes and openings on a floor, as obstacles the planner avoids (ramps are driven as their own legs). */
export function rampObstacles(b: Building, level: number): Obstacle[] {
  const out: Obstacle[] = [];
  for (const r of b.ramps) {
    if (r.from === level) out.push({ id: `${r.id}-up`, label: `Ramp up to floor ${r.to}`, kind: "ramp", ...r.lane });
    if (r.to === level) out.push({ id: `${r.id}-down`, label: `Opening: ramp down to floor ${r.from}`, kind: "opening", ...r.lane });
  }
  return out;
}

const floorCache = new Map<Building, Map<number, Environment>>();

/** Forget cached floor views (after the card catalog changes). */
export function clearFloorCache(b?: Building) {
  if (b) floorCache.delete(b);
  else floorCache.clear();
}

/** The built-in cards, as shipped (the catalog's "reset to defaults"). */
export const DEFAULT_CARDS: readonly Card[] = CARDS.map((c) => ({ ...c, aliases: [...c.aliases], meta: { ...c.meta }, player: { ...c.player } }));

/** One floor of the building, as an Environment for the grid, planner and map. */
export function floorEnv(b: Building, level: number): Environment {
  let byLevel = floorCache.get(b);
  if (!byLevel) floorCache.set(b, (byLevel = new Map()));
  const hit = byLevel.get(level);
  if (hit) return hit;
  const f = b.floors.find((x) => x.level === level);
  if (!f) throw new Error(`No floor ${level}`);
  const env: Environment = {
    level,
    name: f.name,
    width: b.width,
    height: b.height,
    robotRadius: b.robotRadius,
    clearance: b.clearance,
    resolution: b.resolution,
    obstacles: [...f.obstacles, ...rampObstacles(b, level)],
    cards: b.cards.filter((c) => c.floor === level),
    dock: f.dock,
    defaultPose: b.defaultPose,
  };
  byLevel.set(level, env);
  return env;
}

export const floorName = (b: Building, level: number) => b.floors.find((f) => f.level === level)?.name ?? `Floor ${level}`;

/** Named places on the current floor. Resolved deterministically in resolve.ts. */
export const AREAS: Area[] = [
  { id: "other-side", name: "Other side of the floor", aliases: ["other side", "opposite side", "far side", "across the room", "across the floor"] },
  { id: "center", name: "Middle of the floor", aliases: ["middle", "center", "centre"] },
  { id: "dock", name: "Charging dock", aliases: ["dock", "home", "charger", "charging"] },
];

export function cardById(b: { cards: Card[] }, id: string): Card | undefined {
  return b.cards.find((c) => c.id === id);
}
