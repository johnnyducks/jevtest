/**
 * Shapes the live session streams to every viewer. Shared by server and
 * browser; contains no secrets.
 */
import type { FactSource } from "../baseball/types.ts";
import type { ConsideredOption, MessageIntent } from "../decision/batch.ts";
import type { RuleResult } from "../decision/contracts.ts";
import type { GameSnapshot } from "../game/game.ts";
import type { Pose, Vec } from "../twin/environment.ts";
import type { MotionStatus } from "../twin/motion.ts";

export interface PublicFact {
  id: string;
  kind: string;
  playerId: string;
  text: string;
  verification: "dataset" | "sourced";
  source: FactSource;
}

/** What Jev decided for one batch of viewer messages, plus the rules applied to it. */
export interface DecisionTrace {
  id: string;
  model: string;
  latencyMs: number;
  intents: { messageId: string; handle: string; text: string; intent: MessageIntent; confidence: number }[];
  considered: ConsideredOption[];
  rules: RuleResult[];
  action: { kind: string; handle?: string; summary?: string };
}

export type ChatItem =
  | {
      id: string;
      kind: "viewer";
      at: number;
      handle: string;
      text: string;
      /** waiting → in a batch Jev is deciding → handled (or failed when Jev was unavailable). */
      state: "waiting" | "deciding" | "handled" | "failed";
      /** Jev's reading of the message, once decided. */
      intent?: MessageIntent;
      /** Typos that were corrected deterministically, e.g. "heanderson → henderson". */
      corrections?: string[];
    }
  | {
      id: string;
      kind: "marty";
      at: number;
      state: "pending" | "done";
      text?: string;
      source?: "openai" | "built-in";
      model?: string;
      /** Handles this line speaks to. */
      to?: string[];
      facts?: PublicFact[];
      decision?: DecisionTrace;
      /** Marty thinking out loud while nobody's talking. */
      idle?: boolean;
    }
  | { id: string; kind: "system"; at: number; text: string; tone: "info" | "game" | "warn" };

export interface TripStop {
  name: string;
  cardId?: string;
  point: Vec;
  floor: number;
  done: boolean;
}

export interface PublicTrip {
  id: string;
  handle: string;
  summary: string;
  status: "running" | "done" | "stopped" | "failed";
  stops: TripStop[];
  /** Every drive and ramp leg's path, in order. Ramp legs climb (or descend) between floors along `incline` (meters along the path). */
  legs: { path: Vec[]; done: boolean; floor: number; ramp?: { from: number; to: number; incline: [number, number] } }[];
  estimate: { meters: number; seconds: number; battery: number };
  startedAt: number;
  /** What Marty is doing right now ("to Pete Rose", "climbing to the mezzanine"). */
  doing: string;
}

export interface Telemetry {
  at: number;
  pose: Pose;
  /** Floor Marty is on (1–6), and his continuous height in floors (fractional on a ramp). */
  floor: number;
  level: number;
  status: MotionStatus;
  speed: number;
  battery: { level: number; range: number; reserve: number; charging: boolean; dead: boolean };
  trip: { remainingMeters: number; etaSeconds: number } | null;
  metersDriven: number;
}

export interface LiveSnapshot {
  epoch: number;
  chat: ChatItem[];
  telemetry: Telemetry;
  trip: PublicTrip | null;
  game: GameSnapshot;
  viewers: number;
  deciding: boolean;
  queue: { handle: string; summary: string }[];
}

export type LiveEvent =
  | { type: "snapshot"; snapshot: LiveSnapshot }
  | { type: "telemetry"; telemetry: Telemetry }
  | { type: "chat"; item: ChatItem }
  | { type: "trip"; trip: PublicTrip | null }
  | { type: "game"; game: GameSnapshot }
  | { type: "status"; viewers: number; deciding: boolean; queue: LiveSnapshot["queue"] };

/** Handles: 2–20 letters, digits or underscores. */
export const HANDLE = /^[A-Za-z0-9_]{2,20}$/;
export const MAX_CHAT_CHARS = 280;
