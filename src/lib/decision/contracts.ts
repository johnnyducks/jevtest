/**
 * Shapes exchanged between the browser and the app's own API routes, and the
 * deterministic rule results attached to Jev's decisions.
 * Shared by client and server; contains no secrets.
 */

export type RuleStatus = "pass" | "blocked" | "modified" | "triggered";

/** Outcome of one deterministic policy rule. Not a model output. */
export interface RuleResult {
  id: string;
  label: string;
  status: RuleStatus;
  detail: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; retryable: boolean; detail?: unknown };
}

export interface StatusBody {
  jev: { configured: boolean; model: string };
  voice: { configured: boolean; model: string };
  knowledge: { available: boolean; version: string | null; seasonsThrough: number | null; wikipedia: boolean };
  /** Whether operator controls need OPERATOR_KEY. */
  operator: { keyRequired: boolean };
  /** CardSight AI card images. */
  cards: { configured: boolean };
  /** ElevenLabs: Marty's spoken voice. */
  speech: { configured: boolean };
}

export const MAX_MESSAGE_CHARS = 4000;
