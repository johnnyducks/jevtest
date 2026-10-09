/**
 * What a homeowner can pick in the wizard: project types, scope questions and
 * the technical sections (disciplines) they map to. Shared by server and
 * browser; pure.
 */
import type { LinkKey } from "./links.ts";

export interface ProjectType {
  id: string;
  n: string;
  h: string;
  /** Exterior work, which usually involves zoning. */
  x?: boolean;
}

export const PROJECTS: ProjectType[] = [
  { id: "kitchen", n: "Kitchen remodel", h: "Cabinets, counters, layout, appliances" },
  { id: "bath", n: "Bathroom remodel", h: "Fixtures, tile, layout" },
  { id: "basement", n: "Finish a basement", h: "New rooms, bath, egress" },
  { id: "interior", n: "Move or add walls", h: "Closets, open floor plans" },
  { id: "deck", n: "Deck or porch", h: "New, rebuilt or enlarged", x: true },
  { id: "addition", n: "Addition", h: "New rooms, second story, garage", x: true },
  { id: "shed", n: "Shed or detached garage", h: "Accessory buildings", x: true },
  { id: "fence", n: "Fence", h: "Any height", x: true },
  { id: "pool", n: "Pool or hot tub", h: "In-ground, above-ground, spa", x: true },
  { id: "roof", n: "Roof replacement", h: "Tear-off or overlay", x: true },
  { id: "siding", n: "Siding", h: "Replace or re-side", x: true },
  { id: "windows", n: "Windows or doors", h: "Replace or add openings" },
  { id: "waterheater", n: "Water heater", h: "Gas, electric or tankless" },
  { id: "hvac", n: "Furnace, boiler or AC", h: "Replace or add equipment" },
  { id: "generator", n: "Standby generator", h: "Whole-house or partial", x: true },
  { id: "solar", n: "Solar panels", h: "Roof or ground mount", x: true },
  { id: "electric", n: "Electrical work", h: "Service upgrade, circuits, EV charger" },
  { id: "other", n: "Something else", h: "Describe it on the next step" },
];

export const PN: Record<string, ProjectType> = Object.fromEntries(PROJECTS.map((p) => [p.id, p]));

export const projectNames = (ids: string[]) => ids.map((id) => PN[id]?.n ?? id).join(", ");

export type Answer = "Yes" | "No" | "Not sure";
export const ANSWERS: Answer[] = ["Yes", "No", "Not sure"];

export interface ScopeQuestion {
  k: string;
  t: string;
  s?: string;
  for: string[] | "*";
}

export const QUESTIONS: ScopeQuestion[] = [
  { k: "walls", t: "Will you add, remove or move any walls?", s: "Including closets and openings between rooms.", for: ["kitchen", "bath", "basement", "interior", "addition", "other"] },
  { k: "openings", t: "Are any windows or doors new, or changing size?", s: "Same-size replacements are simpler.", for: ["windows", "kitchen", "bath", "basement", "interior", "addition"] },
  { k: "structural", t: "Does the work touch beams, joists, rafters or load-bearing walls?", for: ["kitchen", "bath", "basement", "interior", "roof", "windows", "solar", "other"] },
  { k: "plumbing", t: "Are sinks, toilets, tubs or showers being added or moved?", s: "Swapping a fixture in the same spot doesn't count.", for: ["kitchen", "bath", "basement", "addition", "other"] },
  { k: "electric", t: "Are you adding circuits, outlets, switches or light fixtures?", for: ["kitchen", "bath", "basement", "interior", "deck", "addition", "shed", "pool", "electric", "other"] },
  { k: "gas", t: "Is a gas appliance or gas line part of the job?", s: "Range, furnace, water heater, pool heater, generator, fireplace.", for: ["kitchen", "basement", "addition", "pool", "waterheater", "hvac", "generator", "other"] },
  { k: "bigShed", t: "Is the shed or garage larger than 200 sq ft?", for: ["shed"] },
  { k: "tallFence", t: "Is the fence taller than 6 feet?", for: ["fence"] },
  { k: "soil", t: "Will you disturb more than 5,000 sq ft of soil?", s: "Large excavations can need Burlington County Soil Conservation District approval.", for: ["addition", "pool"] },
  { k: "flood", t: "Is the property in a flood hazard area?", s: "You can check the FEMA flood map.", for: "*" },
];

export const questionsFor = (projects: string[]) =>
  QUESTIONS.filter((q) => q.for === "*" || q.for.some((f) => projects.includes(f)));

/** Questions about the home and the people, with their allowed answers. */
export const PEOPLE_QUESTIONS = {
  ownerOcc: ["Yes", "No"],
  doer: ["Me", "A contractor", "Both"],
  plansBy: ["Me", "Architect or engineer", "Licensed trade", "None needed"],
} as const;

export type Discipline = "B" | "E" | "P" | "M" | "F";
export const DISC: Record<Discipline, [name: string, link: LinkKey]> = {
  B: ["Building", "bldg"],
  E: ["Electrical", "elec"],
  P: ["Plumbing", "plumb"],
  M: ["Mechanical", "mech"],
  F: ["Fire", "fire"],
};
