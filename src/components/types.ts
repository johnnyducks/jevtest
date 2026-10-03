import type { DecisionResult, Mode, ReplyResult } from "@/lib/decision/contracts";
import type { ClientError } from "@/lib/api";

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
  decision: DecisionState;
  reply: ReplyState;
}
