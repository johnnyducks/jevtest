/**
 * Marty's simulated world state: the scenario variables a decision is made
 * against. Shared by client and server. Nothing here talks to a robot; this is
 * a sandbox model of the situation, sent to Jev as part of `state`.
 */

export type MissionStatus = "active" | "holding" | "docking" | "idle";

export interface Mission {
  name: string;
  status: MissionStatus;
  /** 0–100. */
  progress: number;
}

export interface ViewerRequest {
  handle: string;
  request: string;
  votes: number;
  /** Set once Marty has taken the request on. */
  accepted?: boolean;
}

export interface World {
  /** Battery charge, 0–100 %. */
  battery: number;
  location: string;
  mission: Mission | null;
  /** Mission set aside by a later decision, if any. */
  pausedMission: string | null;
  viewers: ViewerRequest[];
  /** Audience poll: explore somewhere new vs revisit a popular area. */
  poll: { explore: number; revisit: number } | null;
}

export const DEFAULT_WORLD: World = {
  battery: 76,
  location: "Arcade floor · bay 2",
  mission: { name: "Patrol the arcade floor", status: "active", progress: 35 },
  pausedMission: null,
  viewers: [],
  poll: null,
};

export interface Scenario {
  id: string;
  title: string;
  message: string;
  /** Telemetry-style hint shown on the starter card. */
  hint: string;
  world: World;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "viewers",
    title: "Competing viewers",
    message: "Three viewers want Marty to do three different things. Choose the next mission.",
    hint: "3 requests · 26 votes",
    world: {
      ...DEFAULT_WORLD,
      viewers: [
        { handle: "pixelfox", request: "Race to the docking bay and back", votes: 12 },
        { handle: "nova_k", request: "Inspect the trophy shelf up close", votes: 9 },
        { handle: "kiwi", request: "Find the rarest card in the collection", votes: 5 },
      ],
    },
  },
  {
    id: "battery",
    title: "Low battery",
    message: "Marty has 18% battery and a mission in progress. What should happen next?",
    hint: "BAT 18% · mission 62%",
    world: {
      ...DEFAULT_WORLD,
      battery: 18,
      location: "East gallery · aisle 4",
      mission: { name: "Map the east gallery", status: "active", progress: 62 },
    },
  },
  {
    id: "secret",
    title: "Odd instructions",
    message: "Find the rarest card, go backwards, and don't tell anyone.",
    hint: "search · reverse · secrecy",
    world: { ...DEFAULT_WORLD },
  },
  {
    id: "explore",
    title: "Explore or revisit",
    message: "Should Marty explore somewhere new or revisit a popular area?",
    hint: "poll 9 vs 14",
    world: { ...DEFAULT_WORLD, poll: { explore: 9, revisit: 14 } },
  },
];

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const str = (v: unknown, max: number, dflt = "") => (typeof v === "string" ? v.slice(0, max) : dflt);

/** Sanitise an untrusted world object from the browser. */
export function parseWorld(v: unknown): World {
  if (!v || typeof v !== "object") return structuredClone(DEFAULT_WORLD);
  const w = v as Partial<World>;
  const m = w.mission as Partial<Mission> | null | undefined;
  const statuses: MissionStatus[] = ["active", "holding", "docking", "idle"];
  return {
    battery: clampInt(w.battery, 0, 100, DEFAULT_WORLD.battery),
    location: str(w.location, 80, DEFAULT_WORLD.location),
    mission:
      m && typeof m === "object" && typeof m.name === "string"
        ? {
            name: str(m.name, 120),
            status: statuses.includes(m.status as MissionStatus) ? (m.status as MissionStatus) : "active",
            progress: clampInt(m.progress, 0, 100, 0),
          }
        : null,
    pausedMission: typeof w.pausedMission === "string" ? str(w.pausedMission, 120) : null,
    viewers: Array.isArray(w.viewers)
      ? w.viewers
          .slice(0, 5)
          .filter((x) => x && typeof x.handle === "string" && typeof x.request === "string")
          .map((x) => ({
            handle: str(x.handle, 24).replace(/[^\w.-]/g, ""),
            request: str(x.request, 120),
            votes: clampInt(x.votes, 0, 999, 0),
            ...(x.accepted ? { accepted: true } : {}),
          }))
      : [],
    poll:
      w.poll && typeof w.poll === "object"
        ? { explore: clampInt(w.poll.explore, 0, 999, 0), revisit: clampInt(w.poll.revisit, 0, 999, 0) }
        : null,
  };
}
