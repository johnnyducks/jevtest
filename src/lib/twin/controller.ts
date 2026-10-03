/**
 * Mission controller for the digital twin.
 *
 * Owns the mission lifecycle and wires the separate concerns together:
 *   decision engine (Jev / simulator)  → which action to take
 *   resolve.ts                          → which entity the words refer to
 *   pathfinding.ts                      → a collision-free route
 *   motion (PoseSource)                 → moving the simulated robot
 * Every status change is a real transition recorded with a timestamp; the UI
 * renders these, not a scripted sequence.
 *
 * No React, no DOM: everything here is unit-testable with a fake decide()
 * function and a manually-stepped motion source.
 */
import type { DecisionResult, RuleResult } from "../decision/contracts";
import type { ChoiceAnswer } from "../jev/types";
import type { TwinContext } from "./context.ts";
import type { Environment, Pose } from "./environment.ts";
import { toDegrees } from "./geometry.ts";
import { blockersAlong, blockReason, firstBlocker, type Grid } from "./grid.ts";
import type { MotionCommands, MotionState, PoseSource } from "./motion.ts";
import { type PlanResult, planPath } from "./pathfinding.ts";
import { type Resolution, type ResolvedTarget, resolveCardByName, resolveTarget, type TargetKind } from "./resolve.ts";

export type MissionStatus =
  | "received"
  | "interpreting"
  | "resolving"
  | "planning"
  | "route_ready"
  | "moving"
  | "arrived"
  | "stopped"
  | "cancelled"
  | "needs_clarification"
  | "no_route"
  | "rejected"
  | "answered"
  | "error";

export const TERMINAL: MissionStatus[] = ["arrived", "stopped", "cancelled", "needs_clarification", "no_route", "rejected", "answered", "error"];

export interface Transition {
  status: MissionStatus;
  at: number;
  note?: string;
}

export interface DecisionSummary {
  /** Who chose the action: Jev, or a deterministic rule (E-stop, clarification answer, resume). */
  source: "jev" | "rule";
  model?: string;
  intent?: ChoiceAnswer;
  nextAction?: ChoiceAnswer;
  labels?: Record<string, string>;
  action: string;
  actionLabel: string;
  reasons: string[];
  rules: RuleResult[];
  blocked: string[];
  latencyMs?: number;
  raw?: DecisionResult;
}

export interface Mission {
  id: string;
  seq: number;
  request: string;
  createdAt: number;
  status: MissionStatus;
  transitions: Transition[];
  /** How the mission was started. */
  via: "request" | "estop" | "clarification" | "resume" | "button";
  decision?: DecisionSummary;
  targetKind?: TargetKind;
  resolution?: Resolution;
  target?: ResolvedTarget;
  plan?: PlanResult;
  /** Pose the route was planned from. */
  from?: Pose;
  explanation: string;
  error?: { message: string; retryable: boolean };
  clarify?: { options: { id: string; name: string }[] };
}

export interface ControllerState {
  missions: Mission[];
  activeId: string | null;
  /** Transient message, e.g. why a manual placement was refused. */
  notice: { kind: "info" | "warn"; text: string } | null;
}

export type DecideFn = (req: { message: string; twin: TwinContext }) => Promise<DecisionResult>;

const NAV_KIND: Record<string, TargetKind> = {
  navigate_card: "card",
  navigate_nearest: "nearest_card",
  navigate_area: "area",
};

/** Deterministic E-stop: a bare stop command halts immediately, without waiting for the decision engine. */
export const ESTOP = /^(please )?(stop|halt|freeze|abort|e ?stop|emergency stop|cancel)( (now|moving|marty|please|it|the mission|right now))*$/;

export function isEStop(text: string) {
  return ESTOP.test(text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim());
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export interface ControllerDeps {
  env: Environment;
  grid: Grid;
  motion: PoseSource & MotionCommands;
  decide: DecideFn;
  now?: () => number;
}

export class TwinController {
  private env: Environment;
  private grid: Grid;
  private motion: PoseSource & MotionCommands;
  private decideFn: DecideFn;
  private now: () => number;
  private state: ControllerState = { missions: [], activeId: null, notice: null };
  private listeners = new Set<(s: ControllerState) => void>();
  /** Increments on every request and reset; decisions that come back for an older value are stale. */
  private seq = 0;
  private latest = 0;
  /** Increments on reset so IDs and in-flight decisions from before a reset can never collide. */
  private epoch = 0;

  constructor(deps: ControllerDeps) {
    this.env = deps.env;
    this.grid = deps.grid;
    this.motion = deps.motion;
    this.decideFn = deps.decide;
    this.now = deps.now ?? (() => Date.now());
    this.motion.subscribe((m) => this.onMotion(m));
  }

  getState = () => this.state;

  subscribe = (l: (s: ControllerState) => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  private emit(patch: Partial<ControllerState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private mission(id: string) {
    return this.state.missions.find((m) => m.id === id);
  }

  private update(id: string, patch: Partial<Mission>, status?: MissionStatus, note?: string) {
    this.emit({
      missions: this.state.missions.map((m) =>
        m.id !== id
          ? m
          : {
              ...m,
              ...patch,
              ...(status ? { status, transitions: [...m.transitions, { status, at: this.now(), ...(note ? { note } : {}) }] } : {}),
            },
      ),
    });
  }

  active(): Mission | undefined {
    return this.state.activeId ? this.mission(this.state.activeId) : undefined;
  }

  /** Context the decision engine sees: pose, motion and destination. */
  context(): TwinContext {
    const s = this.motion.getState();
    const a = this.active();
    return {
      pose: { x: Math.round(s.pose.x * 100) / 100, y: Math.round(s.pose.y * 100) / 100, headingDeg: Math.round(toDegrees(s.pose.heading)) },
      moving: s.status === "moving",
      destination: s.status === "moving" && a?.target ? a.target.name : null,
    };
  }

  private newMission(request: string, via: Mission["via"]): Mission {
    const seq = ++this.seq;
    const m: Mission = {
      id: `e${this.epoch}-m${seq}`,
      seq,
      request,
      createdAt: this.now(),
      status: "received",
      transitions: [{ status: "received", at: this.now() }],
      via,
      explanation: "",
    };
    this.emit({ missions: [...this.state.missions, m], notice: null });
    return m;
  }

  // ── Requests ───────────────────────────────────────────────────────────

  async submit(text: string): Promise<void> {
    const request = text.trim();
    if (!request) return;

    if (isEStop(request)) {
      const m = this.newMission(request, "estop");
      this.supersedePending(`stopped by request #${m.seq}`);
      this.halt(m.id, {
        source: "rule",
        action: "stop",
        actionLabel: "Emergency stop",
        reasons: ["Deterministic E-stop rule: a stop command halts motion immediately, without waiting for the decision engine."],
        rules: [],
        blocked: [],
      });
      return;
    }

    // A reply to an open clarification is resolved against the offered options only.
    const open = [...this.state.missions].reverse().find((x) => x.status === "needs_clarification" && x.clarify?.options.length);
    if (open && open === this.state.missions[this.state.missions.length - 1]) {
      const r = resolveCardByName(this.env, request, open.clarify!.options.map((o) => o.id));
      if (r.status === "resolved") {
        this.chooseClarification(r.target.id, request);
        return;
      }
    }

    const m = this.newMission(request, "request");
    const token = m.seq;
    const epoch = this.epoch;
    this.latest = token;
    this.update(m.id, {}, "interpreting");

    let decision: DecisionResult;
    try {
      decision = await this.decideFn({ message: request, twin: this.context() });
    } catch (err) {
      if (!this.isCurrent(epoch, token, m.id)) return this.discard(m.id);
      const e = err as { message?: string; retryable?: boolean };
      this.update(
        m.id,
        {
          error: { message: e?.message ?? "The decision engine failed.", retryable: e?.retryable ?? true },
          explanation: "The decision engine could not interpret this request, so Marty did not act.",
        },
        "error",
      );
      return;
    }
    if (!this.isCurrent(epoch, token, m.id)) return this.discard(m.id);
    this.apply(m.id, decision);
  }

  private isCurrent(epoch: number, token: number, id: string) {
    return epoch === this.epoch && token === this.latest && !!this.mission(id);
  }

  /** A decision came back for a request that is no longer current: record it, never act on it. */
  private discard(id: string) {
    const m = this.mission(id);
    if (m && !TERMINAL.includes(m.status)) {
      this.update(id, { explanation: "A newer request or a stop arrived before this decision returned, so it was discarded." }, "cancelled", "superseded");
    }
  }

  /** Make every in-flight decision stale (used by stop commands). */
  private supersedePending(note: string) {
    this.latest = -1;
    for (const m of this.state.missions) {
      if (m.status === "interpreting") {
        this.update(m.id, { explanation: "Stopped before the decision engine answered; this request was discarded." }, "cancelled", note);
      }
    }
  }

  private summarize(d: DecisionResult): DecisionSummary {
    return {
      source: d.source,
      model: d.model,
      intent: d.response.answers.intent as ChoiceAnswer | undefined,
      nextAction: d.response.answers.next_action as ChoiceAnswer | undefined,
      labels: Object.fromEntries(d.candidates.map((c) => [c.key, c.label])),
      action: d.effect.action,
      actionLabel: d.effect.label,
      reasons: d.effect.reasons,
      rules: d.effect.rules,
      blocked: d.effect.blocked,
      latencyMs: d.latencyMs,
      raw: d,
    };
  }

  private apply(id: string, d: DecisionResult) {
    const summary = this.summarize(d);
    const who = "Jev";
    const action = d.effect.action;
    this.update(id, { decision: summary });

    if (action === "stop") {
      this.halt(id, summary);
      return;
    }
    const kind = NAV_KIND[action];
    if (kind) {
      this.navigate(id, kind, `${who} selected “${d.effect.label}”.`);
      return;
    }
    const why = d.effect.reasons[0] ?? "";
    if (action === "hold_and_ask" || action === "request_human") {
      this.update(
        id,
        { explanation: `${who} chose to ask before moving. ${why} Try naming a card, e.g. “Go to Griffey”.` },
        "needs_clarification",
      );
    } else if (action === "converse") {
      this.update(id, { explanation: `${who} treated this as conversation, not a movement request, so Marty stays put.` }, "answered");
    } else if (action === "reject") {
      this.update(id, { explanation: `Declined. ${why}` }, "rejected");
    } else {
      this.update(id, { explanation: `“${d.effect.label}” is not a navigation action the twin supports, so Marty stays put.` }, "rejected");
    }
  }

  private navigate(id: string, kind: TargetKind, lead: string) {
    const m = this.mission(id)!;
    this.update(id, { targetKind: kind }, "resolving");
    const pose = this.motion.getState().pose;
    const res = resolveTarget(this.env, this.grid, pose, kind, m.request);
    this.update(id, { resolution: res });

    if (res.status === "ambiguous") {
      this.update(
        id,
        {
          clarify: { options: res.options },
          explanation: `${lead} “${res.matched}” matches ${res.options.length} cards (${res.options.map((o) => o.name).join(", ")}). Which one?`,
        },
        "needs_clarification",
      );
      return;
    }
    if (res.status === "not_found") {
      this.update(
        id,
        {
          explanation:
            kind === "card"
              ? `${lead} ${res.detail} Known cards: ${this.env.cards.map((c) => c.name).join(", ")}.`
              : `${lead} ${res.detail}`,
        },
        "needs_clarification",
      );
      return;
    }
    this.driveTo(id, res.target, `${lead} Target resolved to ${res.target.name} (${res.method}${res.matched ? `: “${res.matched}”` : ""}).`);
  }

  /** Plan from the current pose and start moving. Cancels whatever was moving before. */
  private driveTo(id: string, target: ResolvedTarget, lead: string) {
    this.cancelActive(id);
    this.emit({ activeId: id });
    const from = { ...this.motion.getState().pose };
    this.update(id, { target, from }, "planning");
    const plan = planPath(this.grid, from, target.point);
    this.update(id, { plan });

    if (plan.status !== "ok") {
      const why =
        plan.status === "start_blocked"
          ? "Marty's start position is inside an obstacle's clearance zone."
          : plan.status === "goal_blocked"
            ? `${target.name}'s approach point is blocked by ${firstBlocker(this.env, this.grid, target.point, target.point) ?? "an obstacle"}.`
            : `${target.name}'s approach point is enclosed by obstacles; A* searched all ${plan.expanded} reachable cells without finding a collision-free route.`;
      this.update(id, { explanation: `${lead} No valid route: ${why} Marty stays where it is.` }, "no_route");
      return;
    }
    const blockers = plan.detour ? blockersAlong(this.env, this.grid, from, target.point) : [];
    const blocker = blockers.length > 1 ? `${blockers.slice(0, -1).join(", ")} and ${blockers.at(-1)}` : blockers[0];
    const routeText = plan.detour
      ? `Route ${plan.length} m with ${plan.waypoints.length - 2} turn${plan.waypoints.length === 3 ? "" : "s"}, detouring around the ${blocker} (direct line ${plan.directDistance} m is blocked).`
      : `Route ${plan.length} m, clear line of sight.`;
    this.update(id, { explanation: `${lead} ${routeText}` }, "route_ready");
    this.update(id, {}, "moving");
    this.motion.follow(plan.waypoints, id);
  }

  /** Mark the previously active mission cancelled (if still running) because `byId` replaces it. */
  private cancelActive(byId: string) {
    const prev = this.active();
    if (!prev || prev.id === byId) return;
    if (prev.status === "moving" || prev.status === "route_ready") {
      this.update(prev.id, {}, "cancelled", `replaced by request #${this.mission(byId)?.seq ?? "?"}`);
      this.motion.stop();
    }
  }

  private halt(id: string, decision: DecisionSummary) {
    const s = this.motion.getState();
    const prev = this.active();
    const wasMoving = s.status === "moving";
    if (wasMoving) this.motion.stop();
    if (prev && prev.id !== id && (prev.status === "moving" || prev.status === "route_ready")) {
      this.update(prev.id, {}, "stopped", `stopped by request #${this.mission(id)?.seq}`);
    }
    const at = `(${s.pose.x.toFixed(2)}, ${s.pose.y.toFixed(2)})`;
    this.update(
      id,
      {
        decision,
        explanation: wasMoving ? `Motion halted immediately at ${at}. Marty holds position.` : `Marty was not moving; holding position at ${at}.`,
      },
      "stopped",
    );
  }

  // ── Controls ───────────────────────────────────────────────────────────

  /** Stop button: halts the active mission. */
  stop() {
    this.supersedePending("stop button");
    const a = this.active();
    if (this.motion.getState().status !== "moving" || !a) return;
    this.motion.stop();
    this.update(a.id, { explanation: `${a.explanation} Stopped by the operator.` }, "stopped", "stop button");
  }

  /** Re-plan from the current position to the stopped mission's target. */
  resume() {
    const a = this.active();
    if (!a || a.status !== "stopped" || !a.target) return;
    const m = this.newMission(`Resume → ${a.target.name}`, "resume");
    this.update(m.id, {
      decision: {
        source: "rule",
        action: "resume",
        actionLabel: "Resume",
        reasons: ["Operator pressed Resume: same target, re-planned from the current position."],
        rules: [],
        blocked: [],
      },
    });
    this.driveTo(m.id, a.target, `Resuming mission #${a.seq}.`);
  }

  /** Answer an open clarification with a specific card (button click or a typed reply). */
  chooseClarification(cardId: string, typed?: string) {
    const open = [...this.state.missions].reverse().find((x) => x.status === "needs_clarification" && x.clarify);
    const card = this.env.cards.find((c) => c.id === cardId);
    if (!open || !card || !open.clarify!.options.some((o) => o.id === cardId)) return;
    const m = this.newMission(typed ?? card.name, "clarification");
    this.latest = m.seq; // supersede anything in flight
    const inherited = open.decision;
    this.update(m.id, {
      targetKind: "card",
      decision: {
        source: "rule",
        action: "navigate_card",
        actionLabel: "Navigate to card",
        reasons: [
          `Clarification for request #${open.seq}. The action (${inherited?.actionLabel ?? "navigate"}) came from that decision${inherited?.source === "jev" ? " by Jev" : ""}; the target was chosen by the operator.`,
        ],
        rules: [],
        blocked: [],
      },
      resolution: { status: "resolved", method: "operator choice", target: { kind: "card", id: card.id, name: card.name, point: card.approach, cardPosition: card.position } },
    });
    this.update(open.id, {}, "answered", `answered by #${m.seq}`);
    this.update(m.id, {}, "resolving");
    this.driveTo(m.id, { kind: "card", id: card.id, name: card.name, point: card.approach, cardPosition: card.position }, `You picked ${card.name}.`);
  }

  /** Manual placement. Refused while moving, outside the room or inside an obstacle's clearance. */
  placeRobot(pose: Pose): { ok: true } | { ok: false; reason: string } {
    if (this.motion.getState().status === "moving") {
      const reason = "Stop the current mission before repositioning Marty.";
      this.emit({ notice: { kind: "warn", text: reason } });
      return { ok: false, reason };
    }
    const why = blockReason(this.env, this.grid, pose);
    if (why) {
      const reason = `Can't place Marty there: ${why}.`;
      this.emit({ notice: { kind: "warn", text: reason } });
      return { ok: false, reason };
    }
    this.motion.setPose(pose);
    this.emit({ activeId: null, notice: { kind: "info", text: `Start set to (${pose.x.toFixed(2)}, ${pose.y.toFixed(2)}).` } });
    return { ok: true };
  }

  rotateRobot(deltaRad: number) {
    const s = this.motion.getState();
    if (s.status === "moving") {
      this.emit({ notice: { kind: "warn", text: "Stop the current mission before changing Marty's heading." } });
      return;
    }
    this.motion.setPose({ ...s.pose, heading: s.pose.heading + deltaRad });
    this.emit({ activeId: null, notice: null });
  }

  /** Restore the default environment, pose and empty mission log. In-flight decisions become stale. */
  reset() {
    this.motion.stop();
    this.motion.setPose(this.env.defaultPose);
    this.epoch++;
    this.seq = 0;
    this.latest = -1;
    this.state = { missions: [], activeId: null, notice: { kind: "info", text: "Environment reset to defaults." } };
    for (const l of this.listeners) l(this.state);
  }

  clearNotice() {
    this.emit({ notice: null });
  }

  private onMotion(s: MotionState) {
    const a = this.active();
    if (!a || s.missionId !== a.id || a.status !== "moving") return;
    if (s.status === "arrived") {
      this.update(a.id, { explanation: `${a.explanation} Arrived at ${a.target?.name ?? "the destination"}.` }, "arrived");
    }
  }
}

/** Label for a decision source, used in the UI and tests. */
export function sourceLabel(d: DecisionSummary | undefined) {
  if (!d) return "—";
  return d.source === "jev" ? `model · jev (${d.model})` : "rule";
}

/** Short summary of a choice answer's top value. */
export function topOf(a: ChoiceAnswer | undefined) {
  if (!a) return null;
  const p = a.probabilities[a.choice];
  return { choice: a.choice, p: typeof p === "number" ? pct(p) : "n/a", confidence: pct(a.confidence) };
}
