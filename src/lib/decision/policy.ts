/**
 * Deterministic policy: turns typed answers into a downstream effect.
 * Pure function: no I/O, identical for live and simulated answers.
 */
import type { Answer, ChoiceAnswer, NoulAnswer, ScoreAnswer } from "../jev/types";
import type { ActionId, Effect } from "./contracts";

export const THRESHOLDS = {
  escalate: 0.6,
  clarify: 0.6,
  lowConfidence: 0.5,
  negativeSentiment: 1.5,
};

const ACTIONS: Record<ActionId, { label: string; directive: string }> = {
  answer: { label: "Answer directly", directive: "Answer the question clearly and concisely." },
  execute: { label: "Execute task", directive: "Carry out the requested task, or outline the concrete steps." },
  troubleshoot: {
    label: "Troubleshoot",
    directive: "Acknowledge the problem and walk through likely causes and next diagnostic steps.",
  },
  deescalate: {
    label: "De-escalate & resolve",
    directive: "Acknowledge the frustration sincerely, take ownership, and propose a concrete resolution.",
  },
  acknowledge: { label: "Acknowledge & log", directive: "Thank the user and confirm the feedback is noted." },
  converse: { label: "Converse", directive: "Respond warmly and briefly, and invite the user to continue." },
  clarify: { label: "Ask a clarifying question", directive: "Ask one focused clarifying question before acting." },
  escalate: {
    label: "Escalate to a human",
    directive: "Empathise briefly and explain that a human teammate will take over; do not attempt a fix.",
  },
};

const INTENT_ACTION: Record<string, ActionId> = {
  question: "answer",
  task: "execute",
  problem: "troubleshoot",
  complaint: "deescalate",
  feedback: "acknowledge",
  smalltalk: "converse",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function applyPolicy(answers: Record<string, Answer>): Effect {
  const intent = answers.intent as ChoiceAnswer;
  const urgency = answers.urgency as ScoreAnswer;
  const sentiment = answers.sentiment as ScoreAnswer;
  const escalate = answers.escalate as NoulAnswer;
  const clarify = answers.clarify as NoulAnswer;

  const reasons: string[] = [];
  const flags: string[] = [];
  let action: ActionId;

  if (escalate.noul >= THRESHOLDS.escalate) {
    action = "escalate";
    reasons.push(`escalate = ${pct(escalate.noul)} yes ≥ ${pct(THRESHOLDS.escalate)} threshold → hand off to a human`);
  } else if (clarify.noul >= THRESHOLDS.clarify) {
    action = "clarify";
    reasons.push(`clarify = ${pct(clarify.noul)} yes ≥ ${pct(THRESHOLDS.clarify)} threshold → ask before acting`);
  } else {
    action = INTENT_ACTION[intent.choice] ?? "answer";
    const p = intent.probabilities[intent.choice];
    reasons.push(`intent = "${intent.choice}"${typeof p === "number" ? ` (${pct(p)})` : ""} → ${ACTIONS[action].label}`);
  }

  const level = Math.max(0, Math.min(3, Math.round(urgency.score)));
  const priority = (["P3", "P2", "P1", "P0"] as const)[level];
  reasons.push(`urgency score ${urgency.score.toFixed(2)} → ${priority}`);

  if (intent.confidence < THRESHOLDS.lowConfidence) {
    flags.push("low-confidence intent");
    reasons.push(`intent confidence ${pct(intent.confidence)} < ${pct(THRESHOLDS.lowConfidence)} → flagged for review`);
  }
  if (sentiment.score <= THRESHOLDS.negativeSentiment) {
    flags.push("negative tone");
  }
  if (level >= 2) flags.push("time-sensitive");

  let directive = ACTIONS[action].directive;
  if (sentiment.score <= THRESHOLDS.negativeSentiment && action !== "escalate") {
    directive += " Open with genuine empathy.";
  }
  if (level >= 2) directive += " Treat this as time-sensitive.";

  return { action, label: ACTIONS[action].label, priority, reasons, directive, flags };
}
