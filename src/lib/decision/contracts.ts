/**
 * Shapes exchanged between the browser and the app's own API routes.
 * Shared by client and server; contains no secrets.
 */
import type { Question, SystemOneResponse } from "../jev/types";
import type { World } from "../marty/world";

export type Mode = "demo" | "live";

/** Where a set of answers came from. Never conflated in the UI. */
export type DecisionSource = "jev" | "simulated";

/** Every action Marty's policy may select. Anything else is unreachable. */
export const ACTION_IDS = [
  "continue_mission",
  "return_to_dock",
  "navigate",
  "inspect_object",
  "explore_new_area",
  "revisit_popular_area",
  "viewer_request",
  "converse",
  "hold_and_ask",
  "request_human",
  "reject",
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

/** One option offered to Jev in the `next_action` choice question. */
export interface Candidate {
  /** Choice name sent to Jev. */
  key: string;
  action: ActionId;
  label: string;
  /** Criteria text sent to Jev. */
  description: string;
  /** Viewer handle, for viewer_request candidates. */
  viewer?: string;
}

export type RuleStatus = "pass" | "blocked" | "modified" | "triggered";

/** Outcome of one deterministic policy rule. Not a model output. */
export interface RuleResult {
  id: string;
  label: string;
  status: RuleStatus;
  detail: string;
}

export interface Effect {
  action: ActionId;
  label: string;
  /** Candidate key the policy selected, when the action came from `next_action`. */
  candidateKey: string | null;
  /** Jev's own top candidate, for comparison with the final selection. */
  modelTop: { key: string; label: string; p: number } | null;
  /** Candidate keys removed by deterministic rules. */
  blocked: string[];
  priority: "P0" | "P1" | "P2" | "P3";
  /** Short rationale lines citing the numbers and rules used. */
  reasons: string[];
  rules: RuleResult[];
  /** Conditions the action must be carried out under (e.g. speed caps). */
  constraints: string[];
  /** Instruction handed to the commentary generator. */
  directive: string;
}

export interface DecisionResult {
  id: string;
  mode: Mode;
  source: DecisionSource;
  /** Model name returned by Jev, or "simulator" in demo mode. */
  model: string;
  /** Exactly what was (or, in demo mode, would be) sent to Jev. */
  request: { model: string; state: unknown; questions: Record<string, Question> };
  /** The answers object, verbatim from Jev in live mode. */
  response: SystemOneResponse;
  candidates: Candidate[];
  effect: Effect;
  /** Scenario state the decision was made against, and the state after applying it. */
  world: World;
  worldAfter: World;
  latencyMs: number;
  receivedAt: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface DecideRequestBody {
  message: string;
  mode: Mode;
  world: World;
  history?: ChatTurn[];
}

export interface ReplyRequestBody {
  message: string;
  mode: Mode;
  history?: ChatTurn[];
  decision: {
    source: DecisionSource;
    intent: string;
    intentConfidence: number;
    effect: Pick<Effect, "action" | "label" | "priority" | "directive" | "constraints">;
  };
}

export type ReplySource = "generated" | "scripted";

export interface ReplyResult {
  text: string;
  source: ReplySource;
  model?: string;
  /** Why a scripted reply was used, when applicable. */
  note?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; retryable: boolean; detail?: unknown };
}

export interface StatusBody {
  jev: { configured: boolean; model: string };
  replies: { configured: boolean; model: string };
}

export const MAX_MESSAGE_CHARS = 4000;
