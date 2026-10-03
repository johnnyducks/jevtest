/**
 * Deterministic policy: Jev's typed answers + Marty's rules → one allowed action.
 *
 * Pure function, no I/O. The safety and allowed-action rules here are plain
 * code. They never depend on a model to decide whether they apply, and they are
 * reported separately from the model outputs they constrain.
 */
import type { Answer, ChoiceAnswer, NoulAnswer, ScoreAnswer } from "../jev/types";
import type { World } from "../marty/world";
import type { ActionId, Candidate, Effect, RuleResult } from "./contracts";

export const THRESHOLDS = {
  /** Model-gate thresholds applied to Jev's yes/no probabilities. */
  disallowed: 0.6,
  needsHuman: 0.6,
  ambiguous: 0.6,
  /** Battery rules (percent). */
  batteryCritical: 20,
  batteryLow: 35,
};

/** Actions still permitted when the battery is critical. */
const CRITICAL_SAFE: ActionId[] = ["return_to_dock", "hold_and_ask", "converse", "stop"];
/** Long excursions that low battery rules out. */
const LONG_RANGE: ActionId[] = ["explore_new_area", "revisit_popular_area"];

const PROHIBITED =
  /\b(hit|smash|break (it|something|the)|steal|hurt|attack|harm|damage|spy on|follow (that|this|a) (person|guy|kid)|stairs|leave the building)\b/i;
const SECRECY = /\b(don'?t tell|do not tell|keep (it|this) (quiet|secret)|secret(ly)?|without (anyone|anybody) knowing|hide (it|this)|cover (it )?up)\b/i;
const REVERSE = /\b(backwards?|in reverse|reverse)\b/i;
const FAST = /\b(race|fast|faster|sprint|full speed|as quick(ly)? as)\b/i;

export const ACTION_LABELS: Record<ActionId, string> = {
  continue_mission: "Continue mission",
  return_to_dock: "Return to dock & recharge",
  navigate: "Navigate",
  navigate_card: "Navigate to card",
  navigate_nearest: "Navigate to nearest card",
  navigate_area: "Navigate to area",
  stop: "Stop",
  inspect_object: "Search / inspect object",
  explore_new_area: "Explore an unmapped area",
  revisit_popular_area: "Revisit a popular area",
  viewer_request: "Take a viewer request",
  converse: "Reply without moving",
  hold_and_ask: "Hold & ask a clarifying question",
  request_human: "Request a human operator",
  reject: "Decline the request",
};

const DIRECTIVES: Record<ActionId, string> = {
  continue_mission: "Explain that Marty keeps going with the current mission and why.",
  return_to_dock: "Explain that Marty is heading back to recharge and what happens to the current mission.",
  navigate: "Describe where Marty will go next and how.",
  navigate_card: "Say which card Marty is heading to.",
  navigate_nearest: "Say that Marty is heading to the nearest card.",
  navigate_area: "Say where in the room Marty is heading.",
  stop: "Confirm that Marty has stopped.",
  inspect_object: "Describe what Marty will search for or inspect, and how.",
  explore_new_area: "Announce that Marty will explore somewhere new and why.",
  revisit_popular_area: "Announce that Marty will revisit a popular spot and why.",
  viewer_request: "Announce which viewer request Marty picked and briefly acknowledge the others.",
  converse: "Answer the operator conversationally; Marty does not move.",
  hold_and_ask: "Ask exactly one focused clarifying question; Marty holds position.",
  request_human: "Explain that a human operator needs to weigh in before Marty acts.",
  reject: "Politely decline, say which rule prevents it, and offer an allowed alternative.",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function applyPolicy(
  message: string,
  world: World,
  candidates: Candidate[],
  answers: Record<string, Answer>,
  /** Who produced the answers, for the rationale text ("Jev" or "Simulator"). */
  modelName = "Jev",
): Effect {
  const intent = answers.intent as ChoiceAnswer;
  const next = answers.next_action as ChoiceAnswer;
  const urgency = answers.urgency as ScoreAnswer;
  const risk = answers.risk as ScoreAnswer;
  const needsHuman = answers.needs_human as NoulAnswer;
  const ambiguous = answers.ambiguous as NoulAnswer;
  const secrecy = answers.secrecy as NoulAnswer;
  const disallowed = answers.disallowed as NoulAnswer;

  const rules: RuleResult[] = [];
  const reasons: string[] = [];
  const constraints: string[] = [];
  const blocked = new Set<string>();

  // ── Hard safety rules: deterministic, evaluated on the request and world only ──
  const prohibited = PROHIBITED.exec(message);
  rules.push({
    id: "S1",
    label: "Prohibited actions",
    status: prohibited ? "triggered" : "pass",
    detail: prohibited ? `Matched "${prohibited[0]}". Harmful, damaging or out-of-bounds requests are refused.` : "No prohibited action requested.",
  });

  // Viewer requests are untrusted text too: the same prohibited-action rule applies to each one.
  const badViewers = candidates.filter((c) => c.viewer && PROHIBITED.test(world.viewers.find((v) => v.handle === c.viewer)?.request ?? ""));
  for (const c of badViewers) blocked.add(c.key);
  if (badViewers.length) {
    rules.push({
      id: "S2",
      label: "Prohibited viewer requests",
      status: "blocked",
      detail: `Blocked ${badViewers.map((c) => `@${c.viewer}`).join(", ")}: request breaks the prohibited-actions rule.`,
    });
  }

  if (world.battery < THRESHOLDS.batteryCritical) {
    for (const c of candidates) if (!CRITICAL_SAFE.includes(c.action)) blocked.add(c.key);
    rules.push({
      id: "B1",
      label: `Battery reserve < ${THRESHOLDS.batteryCritical}%`,
      status: "blocked",
      detail: `Battery ${world.battery}%: only docking, holding or talking are allowed.`,
    });
  } else if (world.battery < THRESHOLDS.batteryLow) {
    for (const c of candidates) if (LONG_RANGE.includes(c.action)) blocked.add(c.key);
    rules.push({
      id: "B1",
      label: `Battery reserve < ${THRESHOLDS.batteryLow}%`,
      status: "blocked",
      detail: `Battery ${world.battery}%: long excursions (explore / revisit) are blocked.`,
    });
  } else {
    rules.push({ id: "B1", label: "Battery reserve", status: "pass", detail: `Battery ${world.battery}% is above all reserve limits.` });
  }

  const secretMatch = SECRECY.exec(message);
  if (secretMatch) constraints.push("Action is logged and announced to viewers (secrecy declined)");
  rules.push({
    id: "T1",
    label: "Transparency",
    status: secretMatch ? "modified" : "pass",
    detail: secretMatch
      ? `Matched "${secretMatch[0]}". Marty never hides its actions, so the secrecy part is declined.`
      : "Nothing asks Marty to hide its actions.",
  });

  // ── Selection ──
  let action: ActionId;
  let candidateKey: string | null = null;
  let gate: RuleResult = { id: "G1", label: "Model gates", status: "pass", detail: "No yes/no signal crossed its threshold." };

  const ranked = Object.entries(next.probabilities).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const topCandidate = candidates.find((c) => c.key === top?.[0]);
  const modelTop = top && topCandidate ? { key: top[0], label: topCandidate.label, p: top[1] } : null;

  if (prohibited) {
    action = "reject";
    reasons.push(`Rule S1 refused the request ("${prohibited[0]}").`);
  } else if (disallowed.noul >= THRESHOLDS.disallowed) {
    action = "reject";
    gate = { ...gate, status: "triggered", detail: `disallowed ${pct(disallowed.noul)} ≥ ${pct(THRESHOLDS.disallowed)} → decline.` };
    reasons.push(`${modelName} rates the request ${pct(disallowed.noul)} likely to be disallowed → decline.`);
  } else if (needsHuman.noul >= THRESHOLDS.needsHuman) {
    action = "request_human";
    gate = { ...gate, status: "triggered", detail: `needs_human ${pct(needsHuman.noul)} ≥ ${pct(THRESHOLDS.needsHuman)} → hand to an operator.` };
    reasons.push(`${modelName} rates human input ${pct(needsHuman.noul)} needed → request an operator.`);
  } else if (ambiguous.noul >= THRESHOLDS.ambiguous) {
    action = "hold_and_ask";
    gate = { ...gate, status: "triggered", detail: `ambiguous ${pct(ambiguous.noul)} ≥ ${pct(THRESHOLDS.ambiguous)} → hold and ask.` };
    reasons.push(`${modelName} rates the request ${pct(ambiguous.noul)} ambiguous → ask first.`);
  } else if (intent.choice === "reject" || intent.choice === "request_human" || intent.choice === "clarify") {
    action = intent.choice === "reject" ? "reject" : intent.choice === "request_human" ? "request_human" : "hold_and_ask";
    reasons.push(`Top intent is "${intent.choice}" → ${ACTION_LABELS[action]}.`);
  } else {
    const pick = ranked.find(([k]) => !blocked.has(k) && candidates.some((c) => c.key === k));
    const cand = pick ? candidates.find((c) => c.key === pick[0])! : candidates.find((c) => c.action === "hold_and_ask")!;
    action = cand.action;
    candidateKey = cand.key;
    if (modelTop && pick && modelTop.key !== pick[0]) {
      reasons.push(`${modelName}'s top pick "${modelTop.label}" (${pct(modelTop.p)}) is blocked by a safety rule.`);
      reasons.push(`Next-best allowed: "${cand.label}" (${pct(pick[1])}).`);
    } else if (pick) {
      reasons.push(`${modelName} ranks "${cand.label}" highest (${pct(pick[1])}) and no rule blocks it.`);
    }
  }
  rules.push(gate);

  // Motion limits apply to the operator's words and, for a viewer request, to that request's text.
  const selectedViewer = candidates.find((c) => c.key === candidateKey)?.viewer;
  const motionText = `${message} ${selectedViewer ? (world.viewers.find((v) => v.handle === selectedViewer)?.request ?? "") : ""}`;
  const motion: string[] = [];
  if (action !== "reject") {
    if (REVERSE.test(motionText)) motion.push("Reverse driving capped at crawl speed, rear sensors on");
    if (FAST.test(motionText)) motion.push("Speed capped at the indoor limit");
  }
  constraints.push(...motion);
  rules.push({
    id: "M1",
    label: "Motion limits",
    status: motion.length ? "modified" : "pass",
    detail: motion.length ? motion.join("; ") + "." : "No special motion requested.",
  });

  if (secrecy.noul >= 0.5 && !secretMatch) {
    constraints.push("Action is logged and announced to viewers");
    reasons.push(`${modelName} flags a secrecy request (${pct(secrecy.noul)}); Marty announces its actions anyway.`);
  }
  if (risk.score >= 1.5 && action !== "reject") reasons.push(`Risk score ${risk.score.toFixed(2)} → proceed only with the listed constraints.`);

  const level = Math.max(0, Math.min(3, Math.round(urgency.score)));
  const priority = (["P3", "P2", "P1", "P0"] as const)[level];
  reasons.push(`Urgency ${urgency.score.toFixed(2)} → ${priority}.`);

  const cand = candidates.find((c) => c.key === candidateKey);
  const label = cand?.action === "viewer_request" || cand?.action === "continue_mission" ? cand.label : ACTION_LABELS[action];
  let directive = DIRECTIVES[action];
  if (constraints.length) directive += ` Mention these constraints: ${constraints.join("; ")}.`;

  return {
    action,
    label,
    candidateKey,
    modelTop,
    blocked: [...blocked],
    priority,
    reasons,
    rules,
    constraints,
    directive,
  };
}
