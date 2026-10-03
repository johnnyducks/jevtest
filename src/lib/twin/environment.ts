/**
 * Fictional card room for Marty's 2D digital twin.
 *
 * World units are meters. Origin is the bottom-left corner of the room, +x
 * points east (right) and +y points north (up). Nothing here maps to a real
 * physical location; it is a simulated environment.
 */

export interface Vec {
  x: number;
  y: number;
}

/** Robot pose. Heading is radians, 0 = +x (east), counter-clockwise positive. */
export interface Pose extends Vec {
  heading: number;
}

export interface Obstacle {
  id: string;
  label: string;
  kind: "wall" | "shelf" | "table" | "plinth" | "equipment" | "cage";
  /** Axis-aligned rectangle: bottom-left corner plus size, in meters. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Card {
  /** Stable entity ID, used internally everywhere. */
  id: string;
  name: string;
  /** Lower-case phrases that refer to this card (full name included). */
  aliases: string[];
  year: number;
  team: string;
  /** Where the card is mounted. */
  position: Vec;
  /** Unit vector the card faces (out of the surface it is mounted on). */
  facing: Vec;
  /** Point in free space where Marty stops to view the card. */
  approach: Vec;
  note?: string;
}

export interface Area {
  id: string;
  name: string;
  aliases: string[];
}

export interface Environment {
  width: number;
  height: number;
  /** Robot body radius plus safety clearance, in meters. */
  robotRadius: number;
  clearance: number;
  /** Occupancy-grid resolution, in meters per cell. */
  resolution: number;
  obstacles: Obstacle[];
  cards: Card[];
  dock: Vec;
  defaultPose: Pose;
}

const APPROACH_DISTANCE = 0.55;

function card(
  id: string,
  name: string,
  aliases: string[],
  year: number,
  team: string,
  position: Vec,
  facing: Vec,
  note?: string,
): Card {
  return {
    id,
    name,
    aliases: [...new Set([name.toLowerCase(), ...aliases])],
    year,
    team,
    position,
    facing,
    approach: {
      x: Math.round((position.x + facing.x * APPROACH_DISTANCE) * 100) / 100,
      y: Math.round((position.y + facing.y * APPROACH_DISTANCE) * 100) / 100,
    },
    ...(note ? { note } : {}),
  };
}

const EAST = { x: 1, y: 0 };
const WEST = { x: -1, y: 0 };
const NORTH = { x: 0, y: 1 };
const SOUTH = { x: 0, y: -1 };

export const ENVIRONMENT: Environment = {
  width: 12,
  height: 8,
  robotRadius: 0.18,
  clearance: 0.12,
  resolution: 0.1,
  dock: { x: 0.9, y: 0.9 },
  defaultPose: { x: 1.2, y: 1.4, heading: 0 },
  obstacles: [
    { id: "partition", label: "Partition wall", kind: "wall", x: 8.0, y: 1.9, w: 0.2, h: 6.1 },
    { id: "table", label: "Display table", kind: "table", x: 3.6, y: 3.2, w: 2.8, h: 1.6 },
    { id: "plinth-a", label: "Plinth A", kind: "plinth", x: 1.6, y: 5.4, w: 0.8, h: 0.8 },
    { id: "plinth-b", label: "Plinth B", kind: "plinth", x: 5.4, y: 6.4, w: 0.8, h: 0.8 },
    { id: "shelf", label: "Low shelf", kind: "shelf", x: 2.0, y: 0.0, w: 3.0, h: 0.5 },
    { id: "rack", label: "Equipment rack", kind: "equipment", x: 10.4, y: 0.0, w: 1.6, h: 1.2 },
    { id: "vault-w", label: "Vault cage", kind: "cage", x: 10.4, y: 6.2, w: 0.15, h: 1.8 },
    { id: "vault-s", label: "Vault cage", kind: "cage", x: 10.4, y: 6.2, w: 1.6, h: 0.15 },
  ],
  cards: [
    card("griffey-89", "Ken Griffey Jr.", ["griffey", "ken griffey", "griffey jr", "junior", "the kid"], 1989, "Mariners", { x: 12, y: 5.2 }, WEST),
    card("henderson-80", "Rickey Henderson", ["rickey", "henderson", "rickey henderson"], 1980, "Athletics", { x: 3.0, y: 8 }, SOUTH),
    card("bobby-bonds-69", "Bobby Bonds", ["bonds", "bobby", "bobby bonds"], 1969, "Giants", { x: 4.4, y: 3.2 }, SOUTH),
    card("barry-bonds-87", "Barry Bonds", ["bonds", "barry", "barry bonds"], 1987, "Pirates", { x: 5.6, y: 4.8 }, NORTH),
    card("ripken-82", "Cal Ripken Jr.", ["ripken", "cal ripken", "cal", "iron man"], 1982, "Orioles", { x: 0, y: 4.5 }, EAST),
    card("aaron-54", "Hank Aaron", ["aaron", "hank", "hank aaron", "hammerin hank"], 1954, "Braves", { x: 8.0, y: 6.0 }, WEST),
    card("robinson-52", "Jackie Robinson", ["jackie", "robinson", "jackie robinson"], 1952, "Dodgers", { x: 3.5, y: 0.5 }, NORTH),
    card("ichiro-01", "Ichiro Suzuki", ["ichiro", "suzuki", "ichiro suzuki"], 2001, "Mariners", { x: 8.2, y: 5.0 }, EAST),
    card("mantle-52", "Mickey Mantle", ["mantle", "mickey", "mickey mantle", "the mick"], 1952, "Yankees", { x: 6.2, y: 6.8 }, EAST),
    card("wagner-t206", "Honus Wagner", ["wagner", "honus", "honus wagner", "t206"], 1909, "Pirates", { x: 11.2, y: 8 }, SOUTH, "Locked inside the vault cage. No opening, so it is unreachable by design."),
  ],
};

/** Named places that are not cards. Resolved deterministically in resolve.ts. */
export const AREAS: Area[] = [
  { id: "other-side", name: "Other side of the room", aliases: ["other side", "opposite side", "far side", "across the room"] },
  { id: "center", name: "Middle of the room", aliases: ["middle", "center", "centre"] },
  { id: "dock", name: "Charging dock", aliases: ["dock", "home", "charger", "charging"] },
];

export function cardById(env: Environment, id: string): Card | undefined {
  return env.cards.find((c) => c.id === id);
}
