/**
 * Decision engine: message → batched Jev request → typed answers → effect.
 * SERVER ONLY (imports the Jev client).
 */
import { evaluate, jevConfig, JevError } from "../jev/client";
import type { ChatTurn, DecisionResult, Mode } from "./contracts";
import { applyPolicy } from "./policy";
import { buildQuestions, buildState } from "./questions";
import { simulateAnswers } from "./simulate";

export async function decide(message: string, mode: Mode, history: ChatTurn[] = []): Promise<DecisionResult> {
  const questions = buildQuestions();
  const state = buildState(message, history);
  const started = performance.now();

  if (mode === "live") {
    // No silent fallback: if live is requested but unavailable, the caller gets an error.
    const { configured, model } = jevConfig();
    if (!configured) {
      throw new JevError("not_configured", "Live mode needs JEV_API_KEY on the server. Switch to Demo mode or configure the key.");
    }
    const response = await evaluate({ model, state, questions });
    return {
      id: crypto.randomUUID(),
      mode,
      source: "jev",
      model: response.model,
      request: { model, state, questions },
      response,
      effect: applyPolicy(response.answers),
      latencyMs: Math.round(performance.now() - started),
      receivedAt: new Date().toISOString(),
    };
  }

  const answers = simulateAnswers(message);
  return {
    id: crypto.randomUUID(),
    mode,
    source: "simulated",
    model: "simulator",
    request: { model: "(not sent — demo mode)", state, questions },
    response: { model: "simulator", answers },
    effect: applyPolicy(answers),
    latencyMs: Math.round(performance.now() - started),
    receivedAt: new Date().toISOString(),
  };
}
