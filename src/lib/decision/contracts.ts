/**
 * Shapes exchanged between the browser and the app's own API routes.
 * Shared by client and server; contains no secrets.
 */
import type { Question, SystemOneResponse } from "../jev/types";
import type { World } from "../marty/world";
import type { TwinContext } from "../twin/context";

/** Where a set of answers came from. Only the live Jev API is used. */
export type DecisionSource = "jev";

/** Every action Marty's policy may select. Anything else is unreachable. */
export const ACTION_IDS = [
  "continue_mission",
  "return_to_dock",
  "navigate",
  "navigate_card",
  "navigate_nearest",
  "navigate_area",
  "stop",
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
  source: DecisionSource;
  /** Model name returned by Jev. */
  model: string;
  /** Exactly what was sent to Jev. */
  request: { model: string; state: unknown; questions: Record<string, Question> };
  /** The answers object, verbatim from Jev. */
  response: SystemOneResponse;
  candidates: Candidate[];
  effect: Effect;
  /** True when this decision used the digital-twin navigation schema. */
  twin: boolean;
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
  world: World;
  /** Present when the request comes from the 2D digital twin. */
  twin?: TwinContext;
  history?: ChatTurn[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; retryable: boolean; detail?: unknown };
}

export interface StatusBody {
  jev: { configured: boolean; model: string };
  voice: { configured: boolean; model: string };
}

export const MAX_MESSAGE_CHARS = 4000;
