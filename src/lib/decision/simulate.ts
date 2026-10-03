/**
 * DEMO MODE ONLY. A transparent keyword heuristic that produces answers in the
 * same shape as Jev so the UI can be explored without credentials.
 *
 * These numbers are NOT model outputs. Every result built from them carries
 * `source: "simulated"` and the UI labels it as such.
 */
import type { Answer, ChoiceAnswer, NoulAnswer, ScoreAnswer } from "../jev/types";
import { INTENT_CRITERIA, SENTIMENT_LEVELS, URGENCY_LEVELS } from "./questions";

const LEX: Record<keyof typeof INTENT_CRITERIA, RegExp[]> = {
  question: [/\?\s*$/, /^(what|why|how|when|where|who|which|can|does|is|are|do)\b/i, /\bexplain|difference between|meaning of\b/i],
  task: [/\b(write|draft|create|make|build|generate|plan|summari[sz]e|translate|rewrite|help me)\b/i, /^(please\s+)?(write|draft|create|make|build|give|list|plan)\b/i],
  problem: [/\b(error|bug|crash|broken|not working|doesn'?t work|fails?|failing|down|can'?t (log|sign|access|connect))\b/i, /\b(500|404|timeout|exception)\b/i],
  complaint: [/\b(unacceptable|terrible|awful|ridiculous|furious|angry|worst|charged twice|refund|disappointed|fed up)\b/i, /!{2,}/],
  feedback: [/\b(love|great|awesome|nice work|suggest(ion)?|it would be (nice|great)|feature request|i think you should)\b/i],
  smalltalk: [/^(hi|hello|hey|yo|good (morning|evening|afternoon)|thanks|thank you|cheers)\b/i, /\bhow are you\b/i],
};

const URGENT = [/\b(asap|urgent|immediately|right now|emergency|production|outage|down|blocked|deadline|today)\b/i, /!{2,}/];
const CRITICAL = [/\b(outage|production is down|data loss|security|breach|all users|emergency)\b/i];
const NEG = [/\b(angry|furious|terrible|awful|hate|worst|unacceptable|ridiculous|disappointed|frustrat\w*|annoy\w*)\b/i, /!{2,}/];
const POS = [/\b(love|great|awesome|amazing|thanks|thank you|perfect|nice|excellent|brilliant)\b/i];
const HUMAN = [/\b(human|real person|agent|manager|supervisor|speak to (someone|a person)|lawyer|cancel my account)\b/i];

const hits = (text: string, res: RegExp[]) => res.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);

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
  return round(1 - h / Math.log(Object.keys(p).length));
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp01 = (n: number) => Math.min(0.97, Math.max(0.03, n));

function levelDistribution(levels: string[], center: number, spread = 0.7) {
  const logits = Object.fromEntries(levels.map((_, i) => [String(i), -((i - center) ** 2) / (2 * spread * spread)]));
  return softmax(logits, 1);
}

function scoreAnswer(levels: string[], center: number): ScoreAnswer {
  const probabilities = levelDistribution(levels, center);
  const score = round(Object.entries(probabilities).reduce((a, [k, v]) => a + Number(k) * v, 0));
  return {
    type: "score",
    score,
    confidence: spreadConfidence(probabilities),
    legend: Object.fromEntries(levels.map((l, i) => [String(i), l])),
    probabilities,
  };
}

export function simulateAnswers(message: string): Record<string, Answer> {
  const text = message.trim();

  const logits = Object.fromEntries(
    Object.entries(LEX).map(([k, res]) => [k, hits(text, res) * 1.4]),
  ) as Record<string, number>;
  if (Object.values(logits).every((v) => v === 0)) logits.question = 0.6; // weak prior
  const probabilities = softmax(logits);
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
  const intent: ChoiceAnswer = { type: "choice", choice, confidence: spreadConfidence(probabilities), probabilities };

  const urgencyCenter = hits(text, CRITICAL) ? 3 : Math.min(2.4, hits(text, URGENT) * 1.1 + (choice === "problem" ? 0.8 : 0.2));
  const sentimentCenter = Math.max(0, Math.min(4, 2 - hits(text, NEG) * 0.9 + hits(text, POS) * 0.9));

  const negativity = hits(text, NEG);
  const escalate: NoulAnswer = {
    type: "noul",
    noul: round(clamp01(0.08 + hits(text, HUMAN) * 0.55 + (negativity >= 2 ? 0.3 : negativity * 0.12))),
  };
  const words = text.split(/\s+/).filter(Boolean).length;
  const clarify: NoulAnswer = {
    type: "noul",
    noul: round(clamp01(words <= 2 && choice !== "smalltalk" ? 0.72 : words <= 4 ? 0.3 : 0.08)),
  };

  return {
    intent,
    urgency: scoreAnswer(URGENCY_LEVELS, urgencyCenter),
    sentiment: scoreAnswer(SENTIMENT_LEVELS, sentimentCenter),
    escalate,
    clarify,
  };
}
