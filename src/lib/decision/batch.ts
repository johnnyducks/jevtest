/**
 * Live arbitration: one Jev call ingests a batch of viewer messages and decides
 * what Marty does next.
 *
 * Jev (typed questions, one request):
 *   intent_<n>  choice  what each message wants (move / question / chat / stop / other)
 *   next_action choice  which option to take: a viewer's route, keep going, dock, stop, or stay
 *   taxing_<n>  noul    is this request too taxing or too slow to be worth it right now?
 * Deterministic rules then apply hard limits (battery reserve including the way
 * home, trip duration, dead battery) and the best allowed option is chosen.
 * The result lists every option considered and why, for Marty to explain.
 */
import type { Bonus } from "../game/game.ts";
import type { ChoiceAnswer, NoulAnswer, Question, SystemOneRequest, SystemOneResponse } from "../jev/types.ts";
import type { ParsedRequest, RoutePlan } from "../twin/routes.ts";
import type { RuleResult } from "./contracts.ts";

export type MessageIntent = "move" | "question" | "chat" | "stop" | "other";

export interface Proposal {
  id: string;
  handle: string;
  text: string;
  parsed: ParsedRequest;
  /** Deterministic route estimate, when the message names places. */
  plan: RoutePlan | null;
  /** Points available along the planned stops right now. */
  points: number;
}

export interface BatchContext {
  pose: { x: number; y: number; headingDeg: number; floor: number; floorName: string };
  moving: boolean;
  battery: { level: number; range: number; reserve: number; dead: boolean; docked: boolean };
  current: { summary: string; handle: string; remainingMeters: number } | null;
  bonuses: Bonus[];
  limits: { maxTripSeconds: number; taxingThreshold: number };
}

export interface ConsideredOption {
  key: string;
  proposalId?: string;
  handle?: string;
  label: string;
  /** Jev's probability for this option (exactly as returned). */
  p: number | null;
  status: "chosen" | "queued" | "declined" | "not_chosen";
  reason: string;
  estimate?: { meters: number; seconds: number; battery: number; batteryAfter: number; homeBattery: number; points: number; summary: string };
}

export interface BatchDecision {
  model: string;
  intents: Record<string, { intent: MessageIntent; confidence: number }>;
  action: { kind: "proposal" | "continue" | "stay" | "dock" | "stop"; proposalId?: string };
  considered: ConsideredOption[];
  rules: RuleResult[];
  request: SystemOneRequest;
  response: SystemOneResponse;
}

export type Evaluate = (body: SystemOneRequest) => Promise<SystemOneResponse>;

const INTENTS: Record<MessageIntent, string> = {
  move: "Wants Marty to drive somewhere: one or more stops, a route, or around something.",
  question: "Asks a question or wants information, e.g. about a baseball player or Marty himself.",
  chat: "Greeting, reaction, joke or casual chat; no action needed.",
  stop: "Wants Marty to stop or stay where he is.",
  other: "Something else, unclear, or not something a small robot can do.",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function executable(p: Proposal): boolean {
  return !!p.plan?.ok && p.parsed.issues.length === 0;
}

export function buildBatchRequest(proposals: Proposal[], ctx: BatchContext, model: string): SystemOneRequest {
  const questions: Record<string, Question> = {};
  proposals.forEach((p, i) => {
    questions[`intent_${i + 1}`] = {
      type: "choice",
      instructions: `What does viewer message #${i + 1} (from @${p.handle}) want?`,
      criteria: { ...INTENTS },
    };
  });
  const options: Record<string, string> = {};
  proposals.forEach((p, i) => {
    if (!executable(p)) return;
    const e = p.plan!;
    const floors = e.endFloor !== ctx.pose.floor ? `, ends on floor ${e.endFloor}` : "";
    options[`p_${i + 1}`] = `Do @${p.handle}'s request: ${e.summary} (~${e.meters} m, ~${e.seconds} s, ~${r1(e.battery)}% battery${floors}, ${p.points} points available).`;
    questions[`taxing_${i + 1}`] = {
      type: "noul",
      instructions: `Carrying out @${p.handle}'s request now would be too taxing or take too long to be worth it, given Marty's battery, the time it takes and what it earns.`,
      criteria: {
        true: "Too much battery or time for what it's worth right now, or risky for the battery.",
        false: "Reasonable to do now.",
      },
    };
  });
  if (ctx.moving && ctx.current) options.continue = `Keep going with the current trip (${ctx.current.summary}, ${r1(ctx.current.remainingMeters)} m left) for @${ctx.current.handle}.`;
  if (ctx.moving) options.stop = "Stop where you are.";
  if (ctx.battery.level < 60 && !ctx.battery.docked) options.dock = "Go back to the dock and recharge.";
  options.stay = "Don't drive anywhere; just reply in chat.";
  questions.next_action = {
    type: "choice",
    instructions: "Given the viewer messages, Marty's battery, current trip and active bonuses, what should Marty do next?",
    criteria: options,
  };
  const state = {
    robot: "Marty, a 4-inch Moorebot Scout robot in a six-floor card house (each floor 4 ft × 8 ft, joined by long ramps; climbing a floor costs about 7% battery), streamed live; viewers chat requests and earn points when Marty visits cards for them",
    floor: `${ctx.pose.floor} (${ctx.pose.floorName})`,
    battery_percent: Math.round(ctx.battery.level),
    battery_range_m: r1(ctx.battery.range),
    battery_reserve_percent: ctx.battery.reserve,
    docked: ctx.battery.docked,
    moving: ctx.moving,
    current_trip: ctx.current,
    active_bonuses: ctx.bonuses.map((b) => ({ card: b.cardName, points: b.points, label: b.label })),
    max_trip_seconds: ctx.limits.maxTripSeconds,
    viewer_messages: proposals.map((p, i) => ({
      n: i + 1,
      handle: `@${p.handle}`,
      text: p.text,
      route_estimate: executable(p)
        ? { stops: p.plan!.summary, meters: p.plan!.meters, seconds: p.plan!.seconds, battery_percent: r1(p.plan!.battery), battery_home_after_percent: r1(p.plan!.homeBattery), ends_on_floor: p.plan!.endFloor, points: p.plan!.stops.length ? p.points : 0 }
        : null,
      parse_issue: p.parsed.issues.length ? p.parsed.issues.map((x) => `${x.reason}: "${x.segment}"`).join("; ") : p.plan && !p.plan.ok ? p.plan.issue : null,
    })),
  };
  return { model, state, questions };
}

/** Apply hard limits and pick the best allowed option. Pure: testable with any response. */
export function applyBatch(proposals: Proposal[], ctx: BatchContext, request: SystemOneRequest, response: SystemOneResponse): BatchDecision {
  const a = response.answers;
  const intents: BatchDecision["intents"] = {};
  proposals.forEach((p, i) => {
    const c = a[`intent_${i + 1}`] as ChoiceAnswer | undefined;
    intents[p.id] = { intent: (c?.choice as MessageIntent) ?? "other", confidence: c?.confidence ?? 0 };
  });
  const next = a.next_action as ChoiceAnswer;
  const rules: RuleResult[] = [];
  const blocked = new Map<string, string>();
  const reserve = ctx.battery.reserve;

  proposals.forEach((p, i) => {
    const key = `p_${i + 1}`;
    if (!(key in (next.probabilities ?? {}))) return;
    const e = p.plan!;
    const after = ctx.battery.level - e.battery;
    const taxing = (a[`taxing_${i + 1}`] as NoulAnswer | undefined)?.noul;
    if (ctx.battery.dead) blocked.set(key, "my battery is empty");
    else if (after - e.homeBattery < reserve)
      blocked.set(key, `it needs about ${Math.round(e.battery)}% plus ${Math.round(e.homeBattery)}% to get back to the dock, and I'm at ${Math.round(ctx.battery.level)}% with a ${reserve}% reserve`);
    else if (e.seconds > ctx.limits.maxTripSeconds) blocked.set(key, `it would take about ${e.seconds} seconds, over my ${ctx.limits.maxTripSeconds}-second limit`);
    else if (taxing !== undefined && taxing >= ctx.limits.taxingThreshold) blocked.set(key, `Jev judged it too taxing right now (${pct(taxing)})`);
    else if (intents[p.id].intent !== "move") blocked.set(key, `Jev read it as ${intents[p.id].intent}, not a request to move`);
  });
  rules.push({
    id: "B2",
    label: "Battery reserve incl. way home",
    status: [...blocked.values()].some((r) => r.includes("reserve") || r.includes("empty")) ? "blocked" : "pass",
    detail: `Trips must leave at least ${reserve}% after returning to the dock.`,
  });
  rules.push({
    id: "T1",
    label: "Trip duration",
    status: [...blocked.values()].some((r) => r.includes("limit")) ? "blocked" : "pass",
    detail: `Trips over ${ctx.limits.maxTripSeconds} s are declined.`,
  });
  rules.push({
    id: "G2",
    label: "Too taxing (model gate)",
    status: [...blocked.values()].some((r) => r.startsWith("Jev judged")) ? "triggered" : "pass",
    detail: `taxing ≥ ${pct(ctx.limits.taxingThreshold)} → decline.`,
  });

  // Low battery: going home overrides everything except stopping.
  const mustDock = !ctx.battery.docked && ctx.battery.level <= reserve + 5 && "dock" in next.probabilities;
  if (mustDock) rules.push({ id: "B3", label: "Low battery", status: "triggered", detail: `At ${Math.round(ctx.battery.level)}%, Marty heads home to recharge.` });

  const ranked = Object.entries(next.probabilities).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  let chosenKey = mustDock ? "dock" : ranked.find(([k]) => !blocked.has(k))?.[0] ?? "stay";
  if (!mustDock && ranked[0]?.[0] === "stop") chosenKey = "stop";

  const considered: ConsideredOption[] = ranked.map(([key, p]) => {
    const i = key.startsWith("p_") ? Number(key.slice(2)) - 1 : -1;
    const prop = i >= 0 ? proposals[i] : undefined;
    const e = prop?.plan;
    const status: ConsideredOption["status"] =
      key === chosenKey ? "chosen" : blocked.has(key) ? "declined" : prop ? "queued" : "not_chosen";
    const reason =
      key === chosenKey
        ? mustDock
          ? "battery is low, so going home comes first"
          : `Jev ranked it ${ranked[0][0] === key ? "highest" : "best of the allowed options"} (${pct(p)})`
        : (blocked.get(key) ?? `Jev ranked it lower (${pct(p)})`);
    return {
      key,
      ...(prop ? { proposalId: prop.id, handle: prop.handle } : {}),
      label: labelFor(key, prop, ctx),
      p,
      status,
      reason,
      ...(e
        ? { estimate: { meters: e.meters, seconds: e.seconds, battery: e.battery, batteryAfter: Math.round(ctx.battery.level - e.battery), homeBattery: e.homeBattery, points: prop!.points, summary: e.summary } }
        : {}),
    };
  });

  const action: BatchDecision["action"] = chosenKey.startsWith("p_")
    ? { kind: "proposal", proposalId: proposals[Number(chosenKey.slice(2)) - 1].id }
    : { kind: chosenKey as "continue" | "stay" | "dock" | "stop" };
  return { model: response.model, intents, action, considered, rules, request, response };
}

function labelFor(key: string, prop: Proposal | undefined, ctx: BatchContext): string {
  if (prop?.plan) return `@${prop.handle}: ${prop.plan.summary}`;
  if (key === "continue") return `keep going (${ctx.current?.summary ?? "current trip"})`;
  if (key === "dock") return "go recharge at the dock";
  if (key === "stop") return "stop";
  return "stay put";
}

export async function decideBatch(proposals: Proposal[], ctx: BatchContext, evaluate: Evaluate, model: string): Promise<BatchDecision> {
  const request = buildBatchRequest(proposals, ctx, model);
  const response = await evaluate(request);
  // Jev must answer every question we asked; anything missing is an error, never filled in.
  for (const name of Object.keys(request.questions)) {
    if (!response.answers?.[name]) throw new Error(`Jev did not answer "${name}".`);
  }
  return applyBatch(proposals, ctx, request, response);
}
