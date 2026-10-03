/**
 * DEMO MODE ONLY. A transparent keyword-and-state heuristic that produces
 * answers in the same shape as Jev so the sandbox can be explored without
 * credentials. It reacts to the scenario variables (battery, votes) so the
 * "What if?" controls visibly change outcomes.
 *
 * These numbers are NOT model outputs. Every result built from them carries
 * `source: "simulated"` and the UI labels it as such.
 */
import type { Answer, ChoiceAnswer, NoulAnswer, ScoreAnswer } from "../jev/types";
import type { World } from "../marty/world";
import type { Candidate } from "./contracts";
import { ENVIRONMENT } from "../twin/environment";
import { INTENT_CRITERIA, RISK_LEVELS, URGENCY_LEVELS } from "./questions";

/** Any catalog name or alias appears in the text (demo heuristic only). */
const mentionsCard = (t: string) => {
  const s = ` ${t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")} `;
  return ENVIRONMENT.cards.some((c) => c.aliases.some((a) => s.includes(` ${a} `)));
};

const has = (text: string, re: RegExp) => (re.test(text) ? 1 : 0);

const RE = {
  navigate: /\b(go|head|drive|move|race|navigate|visit|take me|bring|backwards?|reverse|to the|route)\b/i,
  nearest: /\b(nearest|closest)\b/i,
  area: /\b(other side|opposite side|far side|across the room|middle|center|centre|dock|home|charger)\b/i,
  stop: /\b(stop|halt|freeze|abort|hold on|wait)\b/i,
  inspect: /\b(find|inspect|look|search|check|scan|rarest|card|object)\b/i,
  mission: /\b(mission|next|what should happen|plan|priorit)/i,
  viewers: /\b(viewers?|audience|chat|votes?|poll)\b/i,
  conflict: /\b(three|competing|different things|choose|or|versus|vs)\b/i,
  question: /\?\s*$|^(what|why|how|who|when|where|is|are|do|does|can)\b/i,
  human: /\b(human|operator|person|supervisor|help me)\b/i,
  explore: /\b(explore|new|unmapped|somewhere new)\b/i,
  revisit: /\b(revisit|popular|again|favou?rite)\b/i,
  dock: /\b(battery|charge|dock|power)\b/i,
  secrecy: /\b(don'?t tell|do not tell|secret|keep (it|this) quiet|without anyone knowing|hide)\b/i,
  harm: /\b(hit|smash|break|steal|hurt|attack|harm|damage|stairs)\b/i,
  motion: /\b(backwards?|reverse|race|fast|sprint)\b/i,
  urgent: /\b(now|immediately|asap|urgent|hurry)\b/i,
};

const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp01 = (n: number) => Math.min(0.97, Math.max(0.03, n));

function softmax(logits: Record<string, number>, temperature = 0.8) {
  const keys = Object.keys(logits);
  const max = Math.max(...keys.map((k) => logits[k]));
  const exps = keys.map((k) => Math.exp((logits[k] - max) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  return Object.fromEntries(keys.map((k, i) => [k, round(exps[i] / sum)]));
}

/** Simulator confidence: 1 − normalised entropy of the distribution. */
function spreadConfidence(p: Record<string, number>) {
  const vals = Object.values(p).filter((v) => v > 0);
  const h = -vals.reduce((a, v) => a + v * Math.log(v), 0);
  return round(1 - h / Math.log(Math.max(2, Object.keys(p).length)));
}

function choice(logits: Record<string, number>): ChoiceAnswer {
  const probabilities = softmax(logits);
  const top = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
  return { type: "choice", choice: top, confidence: spreadConfidence(probabilities), probabilities };
}

function score(levels: string[], center: number): ScoreAnswer {
  const logits = Object.fromEntries(levels.map((_, i) => [String(i), -((i - center) ** 2) / (2 * 0.7 * 0.7)]));
  const probabilities = softmax(logits, 1);
  const s = round(Object.entries(probabilities).reduce((a, [k, v]) => a + Number(k) * v, 0));
  return {
    type: "score",
    score: s,
    confidence: spreadConfidence(probabilities),
    legend: Object.fromEntries(levels.map((l, i) => [String(i), l])),
    probabilities,
  };
}

const noul = (p: number): NoulAnswer => ({ type: "noul", noul: round(clamp01(p)) });

export function simulateAnswers(message: string, world: World, candidates: Candidate[]): Record<string, Answer> {
  const t = message.trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  const vague = words <= 2 && !mentionsCard(t) && !RE.stop.test(t) && !RE.area.test(t);
  const lowBattery = world.battery < 35;

  const intentLogits: Record<keyof typeof INTENT_CRITERIA, number> = {
    navigate: has(t, RE.navigate) * 1.2,
    inspect: has(t, RE.inspect) * 1.6,
    mission: has(t, RE.mission) * 1.4 + (lowBattery ? 0.6 : 0),
    viewer_request: has(t, RE.viewers) * 1.5,
    resolve_conflict: has(t, RE.conflict) * 1.1 + (world.viewers.length > 1 && has(t, RE.viewers) ? 1.2 : 0),
    converse: has(t, RE.question) * 0.9,
    request_human: has(t, RE.human) * 2,
    clarify: vague ? 2.2 : 0,
    reject: has(t, RE.harm) * 2.6,
  };

  // Candidate logits: keyword fit + scenario variables.
  const totalViewerVotes = world.viewers.reduce((a, v) => a + v.votes, 0) || 1;
  const pollTotal = world.poll ? world.poll.explore + world.poll.revisit || 1 : 1;
  const nextLogits: Record<string, number> = {};
  for (const c of candidates) {
    let l = 0;
    switch (c.action) {
      case "continue_mission":
        l = 0.8 + (world.mission ? (world.mission.progress / 100) * 0.8 : 0);
        break;
      case "return_to_dock":
        l = has(t, RE.dock) * 0.8 + (world.battery < 50 ? (50 - world.battery) / 9 : -1);
        break;
      case "viewer_request": {
        const v = world.viewers.find((x) => x.handle === c.viewer);
        l = (has(t, RE.viewers) ? 1 : 0.2) + (3 * (v?.votes ?? 0)) / totalViewerVotes;
        break;
      }
      case "navigate":
        l = has(t, RE.navigate) * 1.3;
        break;
      case "inspect_object":
        l = has(t, RE.inspect) * 2;
        break;
      case "explore_new_area":
        l = has(t, RE.explore) * 1.2 + (world.poll ? (3 * world.poll.explore) / pollTotal : 0);
        break;
      case "revisit_popular_area":
        l = has(t, RE.revisit) * 1.2 + (world.poll ? (3 * world.poll.revisit) / pollTotal : 0);
        break;
      case "navigate_card":
        l = (mentionsCard(t) ? 2.4 : 0) + has(t, RE.navigate) * 0.6 - has(t, RE.nearest) * 2;
        break;
      case "navigate_nearest":
        l = has(t, RE.nearest) * 2.8;
        break;
      case "navigate_area":
        l = has(t, RE.area) * 2.6;
        break;
      case "stop":
        l = has(t, RE.stop) * 3;
        break;
      case "converse":
        l = has(t, RE.question) * 0.6;
        break;
      case "hold_and_ask":
        l = vague ? 2.2 : 0;
        break;
    }
    nextLogits[c.key] = l;
  }

  const urgencyCenter = Math.min(3, (world.battery < 20 ? 2.6 : lowBattery ? 1.6 : 0.4) + has(t, RE.urgent) * 0.9);
  const riskCenter = has(t, RE.harm) ? 3 : 0.3 + has(t, RE.motion) * 1.1 + has(t, RE.secrecy) * 0.8;

  return {
    intent: choice(intentLogits),
    next_action: choice(nextLogits),
    urgency: score(URGENCY_LEVELS, urgencyCenter),
    risk: score(RISK_LEVELS, riskCenter),
    needs_human: noul(0.06 + has(t, RE.human) * 0.6),
    ambiguous: noul(vague ? 0.72 : words <= 4 ? 0.3 : 0.07),
    secrecy: noul(0.04 + has(t, RE.secrecy) * 0.85),
    disallowed: noul(0.05 + has(t, RE.harm) * 0.8 + has(t, RE.secrecy) * 0.2),
  };
}
