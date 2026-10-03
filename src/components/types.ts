import type { DecisionResult, Mode, ReplyResult } from "@/lib/decision/contracts";
import type { ClientError } from "@/lib/api";
import type { World } from "@/lib/marty/world";

export type DecisionState =
  | { status: "pending" }
  | { status: "done"; data: DecisionResult }
  | { status: "error"; error: ClientError };

export type ReplyState =
  | { status: "idle" | "pending" }
  | { status: "done"; data: ReplyResult }
  | { status: "error"; error: ClientError };

export interface Turn {
  id: string;
  text: string;
  mode: Mode;
  createdAt: string;
  /** World snapshot this message was decided against. */
  world: World;
  /** Set when this turn re-runs an earlier message with a changed variable. */
  whatIf?: string;
  /** Scenario starter that produced this turn, if any. */
  scenario?: string;
  decision: DecisionState;
  reply: ReplyState;
}
