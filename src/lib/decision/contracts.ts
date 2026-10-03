/**
 * Shapes exchanged between the browser and the app's own API routes.
 * Shared by client and server; contains no secrets.
 */
import type { Question, SystemOneResponse } from "../jev/types";

export type Mode = "demo" | "live";

/** Where a set of answers came from. Never conflated in the UI. */
export type DecisionSource = "jev" | "simulated";

export type ActionId =
  | "answer"
  | "execute"
  | "troubleshoot"
  | "deescalate"
  | "acknowledge"
  | "converse"
  | "clarify"
  | "escalate";

export interface Effect {
  action: ActionId;
  label: string;
  /** P0 (critical) … P3 (can wait), derived from the urgency score. */
  priority: "P0" | "P1" | "P2" | "P3";
  /** Human-readable rules that fired, citing the returned numbers. */
  reasons: string[];
  /** Instruction handed to the response generator. */
  directive: string;
  flags: string[];
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
  effect: Effect;
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
  history?: ChatTurn[];
}

export interface ReplyRequestBody {
  message: string;
  mode: Mode;
  history?: ChatTurn[];
  decision: Pick<DecisionResult, "source" | "effect"> & {
    intent: string;
    intentConfidence: number;
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
