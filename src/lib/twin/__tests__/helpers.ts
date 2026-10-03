import type { DecisionResult } from "../../decision/contracts";
import { ENVIRONMENT } from "../environment.ts";
import { buildGrid } from "../grid.ts";
import { type Scheduler, SimulatedMotion } from "../motion.ts";

export const env = ENVIRONMENT;
export const grid = buildGrid(env);

/** Scheduler that never fires on its own; tests drive motion with advance(). */
export const manualScheduler: Scheduler = { request: () => 1, cancel: () => {}, now: () => 0 };

export const newMotion = () => new SimulatedMotion(env.defaultPose, manualScheduler);

/** Minimal decision shaped like the engine's output, for a given action. */
export function fakeDecision(action: string, label = action): DecisionResult {
  return {
    id: "d",
    source: "jev",
    model: "test-double",
    request: { model: "-", state: {}, questions: {} },
    response: {
      model: "test-double",
      answers: {
        intent: { type: "choice", choice: "navigate", confidence: 0.9, probabilities: { navigate: 0.9, converse: 0.1 } },
        next_action: { type: "choice", choice: action, confidence: 0.8, probabilities: { [action]: 0.8, converse: 0.2 } },
      },
    },
    candidates: [],
    effect: { action, label, candidateKey: action, modelTop: null, blocked: [], priority: "P2", reasons: ["test"], rules: [], constraints: [], directive: "" },
    twin: true,
    world: {} as never,
    worldAfter: {} as never,
    latencyMs: 0,
    receivedAt: "",
  } as unknown as DecisionResult;
}

/** Run the motion until it stops moving (or a step budget runs out). */
export function runToEnd(m: SimulatedMotion, maxSteps = 5000) {
  for (let i = 0; i < maxSteps && m.getState().status === "moving"; i++) m.advance(0.05);
}

export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
