/**
 * Types for the Jev System One API (POST /v1/systemone), transcribed from the
 * provider's published OpenAPI 3.1 document (https://api.typesafe.ai/openapi.json).
 *
 * Shared by server and client: these describe data shapes only, no secrets.
 */

/** Instructions / criteria descriptions may be a string, object or array. */
export type Describable = string | Record<string, unknown> | unknown[];

export interface ChoiceQuestion {
  type: "choice";
  instructions?: Describable | null;
  /** Choice name → description of when it applies. */
  criteria: Record<string, Describable | null>;
}

export interface ScoreQuestion {
  type: "score";
  instructions?: Describable | null;
  /** Ordered level descriptions; position = score, starting at 0. */
  criteria: Describable[];
}

export interface NoulQuestion {
  type: "noul";
  instructions?: Describable | null;
  criteria?: { true?: Describable | null; false?: Describable | null } | null;
}

export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion;

export interface SystemOneRequest {
  state: string | Record<string, unknown> | unknown[];
  model: string;
  questions: Record<string, Question>;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, Describable>;
  probabilities: Record<string, number>;
}

export interface NoulAnswer {
  type: "noul";
  /** Probability of yes / true, 0–1. */
  noul: number;
}

export type Answer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  /** Required by the spec; typed optional so a missing value is never shown as 0. */
  usage?: { input_tokens: number; output_tokens: number };
}
