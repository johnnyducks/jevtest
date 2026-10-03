/**
 * Decision engine: message + world → batched Jev request → typed answers →
 * deterministic policy → selected action and next world state.
 * SERVER ONLY (imports the Jev client).
 */
import { evaluate, jevConfig, JevError } from "../jev/client";
import type { Answer } from "../jev/types";
import { nextWorld } from "../marty/mission";
import type { World } from "../marty/world";
import type { ChatTurn, DecisionResult, Mode } from "./contracts";
import { applyPolicy } from "./policy";
import { buildCandidates, buildQuestions, buildState } from "./questions";
import { simulateAnswers } from "./simulate";

export async function decide(message: string, mode: Mode, world: World, history: ChatTurn[] = []): Promise<DecisionResult> {
  const candidates = buildCandidates(world);
  const questions = buildQuestions(candidates);
  const state = buildState(message, world, history);
  const started = performance.now();

  let source: DecisionResult["source"];
  let model: string;
  let requestModel: string;
  let response: DecisionResult["response"];

  if (mode === "live") {
    // No silent fallback: if live is requested but unavailable, the caller gets an error.
    const cfg = jevConfig();
    if (!cfg.configured) {
      throw new JevError("not_configured", "Live mode needs JEV_API_KEY on the server. Switch to Demo mode or configure the key.");
    }
    response = await evaluate({ model: cfg.model, state, questions });
    source = "jev";
    model = response.model;
    requestModel = cfg.model;
  } else {
    const answers: Record<string, Answer> = simulateAnswers(message, world, candidates);
    response = { model: "simulator", answers };
    source = "simulated";
    model = "simulator";
    requestModel = "(not sent — demo mode)";
  }

  const effect = applyPolicy(message, world, candidates, response.answers, source === "jev" ? "Jev" : "Simulator");
  return {
    id: crypto.randomUUID(),
    mode,
    source,
    model,
    request: { model: requestModel, state, questions },
    response,
    candidates,
    effect,
    world,
    worldAfter: nextWorld(world, effect, candidates, message),
    latencyMs: Math.round(performance.now() - started),
    receivedAt: new Date().toISOString(),
  };
}
