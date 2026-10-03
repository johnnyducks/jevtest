/**
 * Decision engine: message + world → batched Jev request → typed answers →
 * deterministic policy → selected action and next world state.
 * SERVER ONLY (imports the Jev client). Always uses the live Jev API.
 */
import { evaluate, jevConfig, JevError } from "../jev/client";
import { nextWorld } from "../marty/mission";
import type { World } from "../marty/world";
import type { TwinContext } from "../twin/context";
import type { ChatTurn, DecisionResult } from "./contracts";
import { applyPolicy } from "./policy";
import { buildCandidates, buildQuestions, buildState } from "./questions";

export async function decide(
  message: string,
  world: World,
  history: ChatTurn[] = [],
  twin: TwinContext | null = null,
): Promise<DecisionResult> {
  const candidates = buildCandidates(world, twin);
  const questions = buildQuestions(candidates);
  const state = buildState(message, world, history, twin);
  const started = performance.now();

  const cfg = jevConfig();
  if (!cfg.configured) {
    throw new JevError("not_configured", "JEV_API_KEY is not set on the server, so Marty can't interpret requests.");
  }
  const response = await evaluate({ model: cfg.model, state, questions });

  const effect = applyPolicy(message, world, candidates, response.answers, "Jev");
  return {
    id: crypto.randomUUID(),
    source: "jev",
    model: response.model,
    request: { model: cfg.model, state, questions },
    response,
    candidates,
    effect,
    twin: !!twin,
    world,
    worldAfter: nextWorld(world, effect, candidates, message),
    latencyMs: Math.round(performance.now() - started),
    receivedAt: new Date().toISOString(),
  };
}
