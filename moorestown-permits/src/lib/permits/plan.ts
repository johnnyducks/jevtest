/**
 * The permit plan: maps wizard answers to a Rehabilitation Subcode category,
 * technical sections, zoning, plans, prior approvals, documents, inspections
 * and a timeline.
 *
 * These rules summarize the Township's homeowner guide. They are not a code
 * determination; the Construction Office should verify them (shed and fence
 * exemptions in particular are hedged). Shared by server and browser; pure.
 */
import { L } from "./links.ts";
import { DISC, type Discipline, PN } from "./projects.ts";

export interface PlanInput {
  projects: string[];
  answers: Record<string, string>;
}

/** "yes" = required, "check" = ask the office, "no" = not likely. */
export type Need = "yes" | "check" | "no";

export interface PlanDoc {
  id: string;
  n: string;
  p: string;
  link: string | null;
}

export interface PriorApproval {
  who: string;
  what: string;
  need: Exclude<Need, "no">;
}

export interface TimelineStep {
  label: string;
  duration: string;
  /** Highlighted milestones (intake, plan review, certificate). */
  key: boolean;
}

export interface Plan {
  permit: boolean;
  /** 0 maintenance, 1 repair, 2 renovation, 3 alteration, 4 addition / new. */
  cls: number;
  clsName: string;
  disc: Discipline[];
  zoning: Need;
  plans: boolean;
  prior: PriorApproval[];
  docs: PlanDoc[];
  insp: string[];
  tl: TimelineStep[];
  notes: string[];
}

export const CATEGORIES = ["Ordinary maintenance", "Repair", "Renovation", "Alteration", "Addition / new construction"];

export function computePlan(s: PlanInput): Plan {
  const pr = s.projects;
  const a = s.answers;
  const has = (id: string) => pr.includes(id);
  const y = (k: string) => a[k] === "Yes";
  const u = (k: string) => a[k] === "Not sure";
  const d = new Set<Discipline>();
  let cls = 0;
  const notes: string[] = [];
  const prior: PriorApproval[] = [];
  const docs: string[] = [];
  const insp = new Set<string>();
  let zoning: Need = "no";
  let plans = false;
  let permit = true;
  const bump = (n: number) => {
    cls = Math.max(cls, n);
  };

  for (const id of pr) {
    switch (id) {
      case "kitchen":
        d.add("B"); bump(2);
        if (y("plumbing")) { d.add("P"); bump(3); }
        if (y("electric") || !a.electric) d.add("E");
        if (y("gas")) d.add("M");
        break;
      case "bath":
        d.add("B"); d.add("P"); d.add("E"); bump(2);
        if (y("plumbing")) bump(3);
        break;
      case "basement":
        d.add("B"); d.add("E"); d.add("F"); bump(3);
        if (y("plumbing")) d.add("P");
        if (y("gas")) d.add("M");
        docs.push("basement");
        break;
      case "interior":
        d.add("B"); d.add("F"); bump(3);
        if (y("electric")) d.add("E");
        break;
      case "deck":
        d.add("B"); bump(4); zoning = "yes"; plans = true;
        if (y("electric")) d.add("E");
        docs.push("deck");
        break;
      case "addition":
        d.add("B"); d.add("E"); d.add("F"); bump(4); zoning = "yes"; plans = true;
        if (y("plumbing")) d.add("P");
        if (y("gas")) d.add("M");
        docs.push("survey");
        break;
      case "shed":
        zoning = "yes";
        if (y("bigShed") || u("bigShed")) { d.add("B"); bump(4); plans = true; }
        else notes.push("Sheds 200 sq ft or smaller generally don't need a construction permit in New Jersey, but still need zoning approval for placement.");
        if (y("electric")) d.add("E");
        docs.push("survey");
        break;
      case "fence":
        zoning = "yes";
        if (y("tallFence") || u("tallFence")) { d.add("B"); bump(4); }
        else notes.push("Fences 6 feet tall or less generally don't need a construction permit, but zoning approval is required.");
        docs.push("survey");
        break;
      case "pool":
        d.add("B"); d.add("E"); bump(4); zoning = "yes"; plans = true;
        if (y("gas")) d.add("M");
        docs.push("poolbar", "survey");
        notes.push("Pools need a compliant barrier (fence or wall). If you share a barrier with a neighbor, file the shared barrier form.");
        break;
      case "roof":
        d.add("B"); bump(2);
        if (y("structural")) { bump(3); plans = true; }
        break;
      case "siding":
        d.add("B"); bump(2);
        break;
      case "windows":
        d.add("B"); bump(2);
        if (y("openings")) { bump(3); plans = true; }
        break;
      case "waterheater":
        d.add("P"); bump(2);
        if (y("gas")) d.add("M"); else d.add("E");
        docs.push("spec");
        notes.push("Water heater replacements are usually a quick review. Include the manufacturer's spec sheet.");
        break;
      case "hvac":
        d.add("M"); d.add("E"); bump(2);
        docs.push("spec", "manualj");
        break;
      case "generator":
        d.add("E"); d.add("M"); bump(4); zoning = "yes";
        docs.push("spec", "survey");
        break;
      case "solar":
        d.add("B"); d.add("E"); bump(3); zoning = "check"; plans = true;
        docs.push("spec");
        break;
      case "electric":
        d.add("E"); bump(2);
        if (y("electric")) bump(3);
        break;
      case "other":
        d.add("B"); bump(2);
        if (zoning === "no") zoning = "check";
        break;
    }
  }
  if (y("walls") || y("structural") || y("openings")) { bump(3); plans = true; d.add("B"); }
  if (cls >= 3) plans = true;
  if (y("gas")) { d.add("M"); docs.push("spec"); }
  if (cls >= 3 && (d.has("E") || has("basement") || has("addition"))) d.add("F");
  if (!d.size) permit = false;
  const interiorIds = ["kitchen", "bath", "basement", "interior", "windows", "waterheater", "hvac", "electric"];
  if (pr.some((id) => interiorIds.includes(id)) && zoning === "no" && pr.some((id) => PN[id]?.x)) zoning = "check";
  if (u("walls") || u("structural") || u("plumbing")) notes.push("You answered “not sure” to a scope question. That's fine. The office will confirm what's needed during intake.");
  if (y("flood") || u("flood")) prior.push({ who: "Floodplain administrator", what: "Floodplain development permit and affidavits", need: y("flood") ? "yes" : "check" });
  if (y("soil")) prior.push({ who: "Burlington County Soil Conservation District", what: "Soil erosion and sediment control approval", need: "yes" });
  if (has("addition") || has("pool")) prior.push({ who: "Township engineer", what: "Grading and drainage review may be required", need: "check" });
  if (zoning !== "no") prior.unshift({ who: "Zoning Office", what: "Zoning permit and fee", need: zoning });

  // documents
  const D: PlanDoc[] = [];
  const add = (id: string, n: string, p: string, link: string | null) => {
    if (!D.find((x) => x.id === id)) D.push({ id, n, p, link });
  };
  if (permit) add("jacket", "Construction Permit Application", "The permit “jacket.” Complete boxes I, IIa and IIb, then sign the certification.", L.app);
  for (const k of d) add("tech-" + k, `${DISC[k][0]} technical section`, "Include the cost and a description of the work. Write “self” if you're the contractor.", L[DISC[k][1]]);
  if (zoning !== "no") add("zoning", "Zoning permit application and fee", zoning === "yes" ? "Zoning reviews first, then construction." : "Ask the Zoning Office whether your project needs approval.", L.zoning);
  if (plans) add("plans", "Two sets of plans, drawn to scale", "Plan view, plus elevations, sections or trade plans as the work requires.", L.pamphlet);
  if (docs.includes("survey")) add("survey", "Property survey showing the new work", "Mark the location and distances to property lines.", null);
  if (docs.includes("deck")) add("deck", "Residential deck permit guide", "Use it to prepare your deck plans: footings, framing, ledger and guards.", L.deck);
  if (docs.includes("basement")) add("basement", "Finished basement permit guide", "Covers egress, ceiling height, smoke and CO alarms.", L.basement);
  if (docs.includes("spec")) add("spec", "Manufacturer spec sheets", "For every appliance or piece of equipment being installed.", null);
  if (docs.includes("manualj")) add("manualj", "HVAC design (Manual J and Manual S)", "Heat-loss and equipment-sizing calculations.", null);
  if (docs.includes("poolbar")) add("poolbar", "Shared barrier for swimming pools form", "Only if your pool barrier is shared with a neighbor.", L.pool);
  if (y("flood") || u("flood")) add("flood", "Floodplain development application", "Plus owner's and contractor's affidavits.", L.floodapp);
  if (d.has("F")) add("smoke", "Smoke and CO alarm plan", "Show alarm locations on your plans.", L.smoke);

  // inspections
  if (has("deck") || has("addition") || (has("shed") && d.has("B")) || has("pool")) insp.add("Footing");
  if (d.has("B") && cls >= 3) insp.add("Framing");
  if (d.has("E")) insp.add("Rough electrical");
  if (d.has("P")) insp.add("Rough plumbing");
  if (d.has("M")) insp.add("Gas / mechanical rough");
  if (d.has("B") && cls >= 3 && (has("addition") || has("basement") || y("walls"))) insp.add("Insulation");
  if (has("pool")) insp.add("Pool barrier and bonding");
  if (permit) insp.add("Final inspections (each trade)");

  // timeline
  const tl: TimelineStep[] = [{ label: "Completeness check at intake", duration: "Same day", key: true }];
  for (const p of prior) tl.push({ label: p.who, duration: p.who === "Zoning Office" ? "Up to 10 business days" : "Varies", key: false });
  if (permit) {
    tl.push(
      { label: "Construction plan review", duration: "Up to 20 business days", key: true },
      { label: "Permit issued, then work and inspections", duration: "Your schedule", key: false },
      { label: "Certificate issued, permit closed", duration: "After finals", key: true },
    );
  }

  return { permit, cls, clsName: CATEGORIES[cls], disc: [...d], zoning, plans, prior, docs: D, insp: [...insp], tl, notes };
}
