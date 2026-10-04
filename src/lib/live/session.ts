/**
 * The live session: one Marty, many viewers.
 *
 * The server owns the only simulation. Viewers post chat messages with a
 * @handle; messages are collected into short batches and Jev decides, in one
 * call, what each message wants and what Marty does next (see
 * decision/batch.ts). Deterministic rules (battery reserve including the way
 * home, trip duration) can veto Jev's pick. Marty then explains the decision
 * in chat, drives the chosen multi-stop route, drains battery by the distance
 * actually simulated, and earns points for the viewer who asked.
 *
 * Everything time-based happens in tick(now), so tests drive the clock
 * directly. No timers, no network and no robot commands live in this file:
 * Jev, the text model and the knowledge service are injected.
 */
import { CommentaryPolicy } from "../baseball/commentary.ts";
import type { KnowledgeBundle, KnowledgeRequest } from "../baseball/service.ts";
import { type BatchContext, type BatchDecision, decideBatch, type Evaluate, executable, type Proposal } from "../decision/batch.ts";
import { Game, type GameConfig, type GameSnapshot } from "../game/game.ts";
import { Battery, BATTERY, type BatteryConfig } from "../twin/battery.ts";
import { type Building, floorEnv, floorName, type Vec } from "../twin/environment.ts";
import { toDegrees } from "../twin/geometry.ts";
import { blockReason, buildGrid, type Grid, isFreePoint } from "../twin/grid.ts";
import { DEFAULT_PARAMS, type Scheduler, SimulatedMotion } from "../twin/motion.ts";
import { type FloorPose, type ParsedRequest, parseRequest, planRoute, type RoutePlan, type StopRef } from "../twin/routes.ts";
import { dist } from "../units.ts";
import type { ChatLine, ReplyResult, SayRequest } from "../voice/openai.ts";
import { answerLine, arrivalQuip, decisionFacts, decisionLine, IDLE_TOPICS, idleLine, jevDownLine } from "./lines.ts";
import { type ChatItem, type DecisionTrace, HANDLE, type LiveEvent, type LiveSnapshot, MAX_CHAT_CHARS, type PublicTrip, type Telemetry } from "./types.ts";

export interface LiveConfig {
  /** Wait this long after the first message so a burst becomes one batch. */
  debounceMs: number;
  /** Max messages per Jev call. */
  maxBatch: number;
  /** Minimum gap between messages from one handle. */
  rateLimitMs: number;
  /** Messages allowed per client connection (IP) within clientWindowMs. */
  clientBurst: number;
  clientWindowMs: number;
  /** Max messages waiting for a decision. */
  maxPending: number;
  /** Chat items kept in memory and sent to new viewers. */
  chatLimit: number;
  maxTripSeconds: number;
  /** Jev's "too taxing" probability at or above which a request is declined. */
  taxingThreshold: number;
  /** Queued requests are reconsidered this many times, then dropped. */
  queueAttempts: number;
  /** Questions answered per batch. */
  maxAnswers: number;
  /** After a trip, below this battery % Marty heads home (rule B3). */
  autoDockBelow: number;
  /** Quiet this long (ms) and Marty thinks out loud; each further musing waits twice as long, up to idleMaxMs. */
  idleAfterMs: number;
  idleMaxMs: number;
  game?: Partial<GameConfig>;
}

export const LIVE: LiveConfig = {
  debounceMs: 1000,
  maxBatch: 6,
  rateLimitMs: 3000,
  clientBurst: 6,
  clientWindowMs: 10_000,
  maxPending: 30,
  chatLimit: 150,
  maxTripSeconds: 240,
  taxingThreshold: 0.6,
  queueAttempts: 3,
  maxAnswers: 2,
  autoDockBelow: 20,
  idleAfterMs: 75_000,
  idleMaxMs: 15 * 60_000,
};

const RESERVED = new Set(["marty", "jev", "system", "operator", "admin", "mod", "moderator"]);

export interface LiveDeps {
  building: Building;
  /** Jev System One; null when not configured (Marty then never moves on viewer requests). */
  evaluate: Evaluate | null;
  jevModel: string;
  say: (r: SayRequest) => Promise<ReplyResult>;
  knowledge?: (req: KnowledgeRequest) => Promise<KnowledgeBundle | null>;
  /** Battery drain rates (default BATTERY; the server scales it by BATTERY_CAPACITY). */
  battery?: BatteryConfig;
  now: () => number;
  seed?: number;
  config?: Partial<LiveConfig>;
}

interface Waiting {
  id: string;
  handle: string;
  text: string;
  at: number;
  /** Times this request was considered and queued. */
  attempts: number;
}

interface Trip {
  id: string;
  handle: string;
  /** Viewer requests earn points; Marty's own trips (dock) don't. */
  viewer: boolean;
  /** Distance travelled on the current ramp leg already charged for climbing, meters. */
  climbed: number;
  /** Distance covered on the current ramp leg before a stop/resume (motion restarts its own count). */
  rampOffset: number;
  refs: StopRef[];
  plan: RoutePlan;
  leg: number;
  dwellLeft: number;
  stopsDone: number;
  status: PublicTrip["status"];
  startedAt: number;
  doing: string;
}

export type OperatorCommand =
  | { action: "stop" }
  | { action: "resume" }
  | { action: "reset" }
  | { action: "dock" }
  | { action: "place"; x: number; y: number; floor?: number }
  | { action: "rotate"; deg: number }
  | { action: "speed"; mps: number }
  | { action: "battery"; level: number };

export type PostResult = { ok: true; id: string } | { ok: false; code: "bad_handle" | "bad_text" | "rate_limited" | "busy"; message: string; retryAfterMs?: number };

/** Scheduler that never fires: motion is advanced from tick(). */
const MANUAL: Scheduler = { request: () => 1, cancel: () => {}, now: () => 0 };


export class LiveSession {
  readonly config: LiveConfig;
  private deps: LiveDeps;
  private b: Building;
  private grids = new Map<number, Grid>();
  /** Floor Marty is on (the floor he's heading to, once on a ramp leg's upper half). */
  private floor: number;
  /** Continuous height in floors (e.g. 2.4 while climbing from 2 to 3), for the 3D view. */
  private level: number;
  readonly motion: SimulatedMotion;
  readonly battery: Battery;
  readonly game: Game;
  private policy = new CommentaryPolicy();
  private chat: ChatItem[] = [];
  private pending: Waiting[] = [];
  private queued: Waiting[] = [];
  private trip: Trip | null = null;
  private deciding = false;
  private dueAt: number | null = null;
  private epoch = 0;
  private seq = 0;
  /** Bumped by operator stops: a decision that started before one may not move Marty. */
  private stopToken = 0;
  private lastTick: number;
  private lastPost = new Map<string, number[]>();
  private listeners = new Set<(e: LiveEvent) => void>();
  private lastTelemetry = { key: "", at: 0 };
  private lastGame = { key: "", at: 0 };
  private lastJevDown = -Infinity;
  private charging = false;
  private work = new Set<Promise<unknown>>();
  /** Last time anyone (viewer or Marty's own trip) did something; drives idle musings. */
  private lastActivity: number;
  private idleCount = 0;
  private idleTopics: string[] = [];

  constructor(deps: LiveDeps) {
    this.deps = deps;
    this.b = deps.building;
    for (const f of this.b.floors) this.grids.set(f.level, buildGrid(floorEnv(this.b, f.level)));
    this.floor = this.b.defaultFloor;
    this.level = this.floor;
    this.config = { ...LIVE, ...deps.config };
    const now = deps.now();
    this.lastTick = now;
    this.lastActivity = now;
    this.motion = new SimulatedMotion(this.b.defaultPose, MANUAL, DEFAULT_PARAMS);
    this.battery = new Battery(100, deps.battery ?? BATTERY);
    this.battery.resync(this.b.defaultPose);
    // Battery drains by measured motion only; teleports (placement, reset) re-sync instead.
    this.motion.subscribe((s) => (s.status === "moving" || s.status === "arrived" ? this.battery.observe(s.pose) : this.battery.resync(s.pose)));
    this.game = new Game(this.b.cards, (c) => this.reachable(c), { seed: deps.seed, now, config: this.config.game });
  }

  private grid(floor: number): Grid {
    return this.grids.get(floor)!;
  }

  /** A card Marty can get to at all: its viewing spot is free and connected to its floor's dock. */
  private reachable(c: { floor: number; approach: Vec }): boolean {
    const g = this.grid(c.floor);
    if (!isFreePoint(g, c.approach)) return false;
    return connected(g, floorEnv(this.b, c.floor).dock, c.approach);
  }

  private where(): FloorPose {
    return { ...this.motion.getState().pose, floor: this.floor };
  }

  // ── Subscriptions ─────────────────────────────────────────────────────

  subscribe(listener: (e: LiveEvent) => void): () => void {
    this.listeners.add(listener);
    listener({ type: "snapshot", snapshot: this.snapshot() });
    this.emitStatus();
    return () => {
      this.listeners.delete(listener);
      this.emitStatus();
    };
  }

  get viewers() {
    return this.listeners.size;
  }

  private emit(e: LiveEvent) {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        /* a broken connection must not affect the others */
      }
    }
  }

  private emitStatus() {
    this.emit({ type: "status", viewers: this.viewers, deciding: this.deciding, queue: this.queueView() });
  }

  private queueView() {
    return this.queued.map((q) => ({ handle: q.handle, summary: q.text.slice(0, 60) }));
  }

  snapshot(): LiveSnapshot {
    const now = this.deps.now();
    return {
      epoch: this.epoch,
      chat: [...this.chat],
      telemetry: this.telemetry(now),
      trip: this.publicTrip(),
      game: this.game.snapshot(now),
      viewers: this.viewers,
      deciding: this.deciding,
      queue: this.queueView(),
    };
  }

  /** Resolves when every pending Jev / voice call has finished (for tests). */
  async settle() {
    while (this.work.size) await Promise.allSettled([...this.work]);
  }

  private track<T>(p: Promise<T>) {
    this.work.add(p);
    void p.finally(() => this.work.delete(p)).catch(() => {});
    return p;
  }

  // ── Chat ──────────────────────────────────────────────────────────────

  private id(prefix: string) {
    return `${prefix}${this.epoch}-${++this.seq}`;
  }

  private upsert(item: ChatItem) {
    const i = this.chat.findIndex((c) => c.id === item.id);
    if (i >= 0) this.chat[i] = item;
    else {
      this.chat.push(item);
      if (this.chat.length > this.config.chatLimit) this.chat.splice(0, this.chat.length - this.config.chatLimit);
    }
    this.emit({ type: "chat", item });
  }

  private system(text: string, tone: "info" | "game" | "warn" = "info") {
    this.upsert({ id: this.id("s"), kind: "system", at: this.deps.now(), text, tone });
  }

  private viewerItem(id: string) {
    const c = this.chat.find((x) => x.id === id);
    return c?.kind === "viewer" ? c : undefined;
  }

  private history(): ChatLine[] {
    return this.chat
      .filter((c) => c.kind === "viewer" || (c.kind === "marty" && c.text))
      .slice(-10)
      .map((c) => (c.kind === "viewer" ? { role: "user" as const, text: `@${c.handle}: ${c.text}` } : { role: "assistant" as const, text: (c as { text: string }).text }));
  }

  /** Marty says something. Shows a typing indicator, then the line (model or built-in). */
  private speak(req: Omit<SayRequest, "history">, extra: { decision?: DecisionTrace; idle?: boolean } = {}) {
    const id = this.id("m");
    const base = { id, kind: "marty" as const, at: this.deps.now(), to: req.to, ...extra };
    this.upsert({ ...base, state: "pending" });
    const epoch = this.epoch;
    const done = (r: ReplyResult) => {
      if (epoch !== this.epoch) return;
      this.upsert({ ...base, state: "done", text: r.text, source: r.source, ...(r.model ? { model: r.model } : {}), facts: publicFacts(req.knowledge) });
    };
    return this.track(
      this.deps
        .say({ ...req, history: this.history() })
        .then(done)
        .catch(() => done({ text: req.fallback, source: "built-in" })),
    );
  }

  /** A viewer message. Validated, rate-limited, then queued for the next Jev batch. */
  post(handleRaw: string, textRaw: string, client = ""): PostResult {
    const handle = String(handleRaw ?? "").trim().replace(/^@/, "");
    const text = String(textRaw ?? "").replace(/\s+/g, " ").trim();
    if (!HANDLE.test(handle) || RESERVED.has(handle.toLowerCase())) {
      return { ok: false, code: "bad_handle", message: "Pick a handle of 2–20 letters, numbers or underscores." };
    }
    if (!text || text.length > MAX_CHAT_CHARS) return { ok: false, code: "bad_text", message: `Messages are 1–${MAX_CHAT_CHARS} characters.` };
    const now = this.deps.now();
    const hk = `h:${handle.toLowerCase()}`;
    const last = this.lastPost.get(hk)?.at(-1);
    if (last !== undefined && now - last < this.config.rateLimitMs) {
      return { ok: false, code: "rate_limited", message: "Easy, slugger. One message every few seconds.", retryAfterMs: this.config.rateLimitMs - (now - last) };
    }
    // Several viewers can share one connection (a household, an office), so a client gets a small burst allowance.
    const ck = client ? `c:${client}` : "";
    const recent = ck ? (this.lastPost.get(ck) ?? []).filter((t) => now - t < this.config.clientWindowMs) : [];
    if (ck && recent.length >= this.config.clientBurst) {
      return { ok: false, code: "rate_limited", message: "Lots of messages from this connection. Give it a few seconds.", retryAfterMs: this.config.clientWindowMs - (now - recent[0]) };
    }
    if (this.pending.length >= this.config.maxPending) return { ok: false, code: "busy", message: "Marty's inbox is full. Try again in a moment." };
    this.lastPost.set(hk, [now]);
    if (ck) this.lastPost.set(ck, [...recent, now]);
    if (this.lastPost.size > 5000) for (const [k, t] of this.lastPost) if (now - (t.at(-1) ?? 0) > 60_000) this.lastPost.delete(k);

    const id = this.id("v");
    this.lastActivity = now;
    this.idleCount = 0;
    this.upsert({ id, kind: "viewer", at: now, handle, text, state: "waiting" });
    this.pending.push({ id, handle, text, at: now, attempts: 0 });
    const first = this.pending[0].at;
    this.dueAt = this.pending.length >= this.config.maxBatch ? now : first + this.config.debounceMs;
    return { ok: true, id };
  }

  // ── Decisions ─────────────────────────────────────────────────────────

  private plan(from: FloorPose, stops: StopRef[]) {
    return planRoute(this.b, (f) => this.grid(f), from, stops, { speed: this.motion.getSpeed(), turnRate: DEFAULT_PARAMS.turnRate, battery: this.battery.config });
  }

  private proposal(w: Waiting, from: FloorPose): Proposal {
    const parsed: ParsedRequest = parseRequest(this.b, w.text);
    const plan = parsed.stops.length ? this.plan(from, parsed.stops) : null;
    const now = this.deps.now();
    const points = (plan?.stops ?? []).reduce((a, s) => {
      if (!s.cardId) return a;
      const v = this.game.valueAt(s.cardId, now);
      return a + v.base + (v.bonus?.points ?? 0);
    }, 0);
    return { id: w.id, handle: w.handle, text: w.text, parsed, plan, points };
  }

  private dock() {
    return floorEnv(this.b, this.floor).dock;
  }

  private docked() {
    const p = this.motion.getState().pose;
    const d = this.dock();
    return Math.hypot(p.x - d.x, p.y - d.y) <= this.battery.config.dockRadius;
  }

  private context(): BatchContext {
    const s = this.motion.getState();
    const t = this.running();
    return {
      pose: { x: Math.round(s.pose.x * 100) / 100, y: Math.round(s.pose.y * 100) / 100, headingDeg: Math.round(toDegrees(s.pose.heading)), floor: this.floor, floorName: floorName(this.b, this.floor) },
      moving: s.status === "moving" || !!t,
      battery: { level: this.battery.level, range: this.battery.range, reserve: this.battery.config.reserve, dead: this.battery.dead, docked: this.docked() },
      current: t ? { summary: t.plan.summary, handle: t.handle, remainingMeters: this.remaining().meters } : null,
      bonuses: this.game.snapshot(this.deps.now()).bonuses,
      limits: { maxTripSeconds: this.config.maxTripSeconds, taxingThreshold: this.config.taxingThreshold },
    };
  }

  private async runBatch() {
    this.dueAt = null;
    const replay = this.queued.splice(0, Math.min(3, this.config.maxBatch));
    const fresh = this.pending.splice(0, this.config.maxBatch - replay.length);
    const batch = [...replay, ...fresh];
    if (!batch.length) return;
    this.deciding = true;
    this.emitStatus();
    for (const w of fresh) this.markViewer(w.id, { state: "deciding" });

    const epoch = this.epoch;
    const token = this.stopToken;
    const from = this.where();
    const proposals = batch.map((w) => this.proposal(w, from));
    for (const p of proposals) if (p.parsed.corrections.length) this.markViewer(p.id, { corrections: p.parsed.corrections });
    const ctx = this.context();
    const started = this.deps.now();

    let d: BatchDecision | null = null;
    let failure = "";
    try {
      if (!this.deps.evaluate) throw new Error("JEV_API_KEY is not set on the server.");
      d = await decideBatch(proposals, ctx, this.deps.evaluate, this.deps.jevModel);
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    if (epoch !== this.epoch) return;
    this.deciding = false;

    if (!d) {
      console.warn(`Live decision failed: ${failure}`);
      for (const w of fresh) this.markViewer(w.id, { state: "failed" });
      const now = this.deps.now();
      if (now - this.lastJevDown > 15_000) {
        this.lastJevDown = now;
        const handles = [...new Set(fresh.map((w) => w.handle))];
        this.upsert({ id: this.id("m"), kind: "marty", at: now, state: "done", text: jevDownLine(handles, this.seq), source: "built-in", to: handles });
      }
      this.afterBatch();
      return;
    }
    this.apply(d, proposals, batch, new Set(replay.map((w) => w.id)), token, this.deps.now() - started);
    this.afterBatch();
  }

  private afterBatch() {
    this.emitStatus();
    if (this.pending.length) this.dueAt = Math.max(this.deps.now(), this.pending[0].at + this.config.debounceMs);
  }

  private markViewer(id: string, patch: Partial<Extract<ChatItem, { kind: "viewer" }>>) {
    const v = this.viewerItem(id);
    if (v) this.upsert({ ...v, ...patch });
  }

  private apply(d: BatchDecision, proposals: Proposal[], batch: Waiting[], replayIds: Set<string>, token: number, latencyMs: number) {
    const byId = new Map(proposals.map((p) => [p.id, p]));
    for (const p of proposals) this.markViewer(p.id, { state: "handled", intent: d.intents[p.id]?.intent });

    // Movement only if no operator stop happened while Jev was thinking.
    const stoppedMeanwhile = token !== this.stopToken;
    const chosen = d.action.kind === "proposal" ? byId.get(d.action.proposalId!) : undefined;
    let actionNote = "";
    if (stoppedMeanwhile && d.action.kind !== "stay" && d.action.kind !== "continue") {
      actionNote = "The operator stopped Marty while Jev was deciding, so this decision was not carried out.";
    } else if (chosen?.plan) {
      this.startTrip(chosen.handle, true, chosen.parsed.stops, chosen.plan);
    } else if (d.action.kind === "dock") {
      this.startDock("Jev chose to recharge");
    } else if (d.action.kind === "stop") {
      this.halt("stopped at a viewer's request");
    }

    // Requests Jev ranked lower but allowed wait in the queue; declined ones are explained and dropped.
    for (const o of d.considered) {
      if (o.status !== "queued" || !o.proposalId) continue;
      const w = batch.find((x) => x.id === o.proposalId)!;
      if (w.attempts + 1 >= this.config.queueAttempts) {
        this.system(`@${w.handle}'s request ("${w.text.slice(0, 50)}") left the queue after ${this.config.queueAttempts} tries.`, "info");
      } else this.queued.push({ ...w, attempts: w.attempts + 1 });
    }

    const trace: DecisionTrace = {
      id: this.id("d"),
      model: d.model,
      latencyMs,
      intents: proposals.map((p) => ({ messageId: p.id, handle: p.handle, text: p.text, intent: d.intents[p.id]?.intent ?? "other", confidence: d.intents[p.id]?.confidence ?? 0 })),
      considered: d.considered,
      rules: d.rules,
      action: { kind: d.action.kind, ...(chosen ? { handle: chosen.handle, summary: chosen.plan?.summary } : {}) },
    };

    // Requests that couldn't be planned: say why, in plain words.
    const issues: { handle: string; text: string }[] = [];
    for (const p of proposals) {
      if (d.intents[p.id]?.intent !== "move" || executable(p) || replayIds.has(p.id)) continue;
      const issue = p.parsed.issues[0];
      if (issue?.reason === "ambiguous") issues.push({ handle: p.handle, text: `"${issue.matched ?? issue.segment}" could be ${issue.options!.map((o) => o.name).join(" or ")}. Which one?` });
      else if (issue) issues.push({ handle: p.handle, text: `I couldn't find "${issue.segment}" anywhere in the building.` });
      else if (p.plan?.issue) issues.push({ handle: p.handle, text: p.plan.issue });
      else issues.push({ handle: p.handle, text: "I couldn't tell where you want me to go. Name a card, or chain a few with \"then\"." });
    }

    const fresh = proposals.filter((p) => !replayIds.has(p.id));
    const chats = fresh.filter((p) => d.intents[p.id]?.intent === "chat" || d.intents[p.id]?.intent === "other");
    const questions = fresh.filter((p) => d.intents[p.id]?.intent === "question").slice(0, this.config.maxAnswers);
    const bat = { level: this.battery.level, range: this.battery.range, reserve: this.battery.config.reserve };
    const doing = this.doing();

    const base = decisionLine(d, bat, this.seq, chats.map((c) => c.handle));
    const issueText = issues.map((i) => `@${i.handle}, ${i.text}`).join(" ");
    const fallback = [base, issueText, actionNote].filter(Boolean).join(" ");
    const handles = [...new Set([...d.considered.flatMap((o) => (o.handle ? [o.handle] : [])), ...chats.map((c) => c.handle), ...issues.map((i) => i.handle)])];

    if (fallback) {
      const facts = [
        decisionFacts(d, bat, doing, chats.map((c) => ({ handle: c.handle, text: c.text, intent: d.intents[c.id]?.intent ?? "chat" }))),
        ...issues.map((i) => `- could not plan for @${i.handle}: ${i.text}`),
        actionNote ? `- ${actionNote}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      void this.speak(
        {
          kind: "decision",
          to: handles,
          instruction: "Tell the viewers what you're doing next and why. Mention every declined request by @handle with its reason, then the chosen one. Riff briefly on any chat messages.",
          facts,
          fallback,
        },
        { decision: trace },
      );
    }
    questions.forEach((q, i) => void this.answer(q, i === 0 && !fallback ? trace : undefined));
  }

  private async answer(p: Proposal, trace?: DecisionTrace) {
    const k = await this.lookup({ trigger: "ask", text: p.text, exclude: this.policy.said(), recentKinds: [] });
    const bat = { level: this.battery.level, range: this.battery.range, reserve: this.battery.config.reserve };
    const doing = this.doing();
    await this.speak(
      {
        kind: "answer",
        to: [p.handle],
        instruction: `Answer @${p.handle}'s question: "${p.text}"`,
        facts: `battery: ${Math.round(bat.level)}% (about ${dist(bat.range)} of driving left)\nfloor: ${this.floor} of ${this.b.floors.length} (${floorName(this.b, this.floor)})\nright now: ${doing}\npoints leader: ${this.game.snapshot(this.deps.now()).scores[0]?.handle ?? "nobody yet"}`,
        fallback: answerLine(p.handle, k, bat, `${doing} on floor ${this.floor}`),
        knowledge: k,
      },
      trace ? { decision: trace } : {},
    );
    if (k?.facts.length) this.policy.record({ at: this.deps.now(), facts: k.facts.map((f) => ({ id: f.id, kind: f.kind, playerId: f.subject.playerId })), volunteered: false });
  }

  private async lookup(req: KnowledgeRequest): Promise<KnowledgeBundle | null> {
    if (!this.deps.knowledge) return null;
    try {
      return await this.deps.knowledge(req);
    } catch {
      return null;
    }
  }

  // ── Trips ─────────────────────────────────────────────────────────────

  private running() {
    return this.trip?.status === "running" ? this.trip : null;
  }

  private doing(): string {
    const t = this.running();
    if (t) return `${t.doing} (trip for @${t.handle}: ${t.plan.summary})`;
    if (this.charging) return `charging at the dock on floor ${this.floor}`;
    return `parked on floor ${this.floor}, waiting for requests`;
  }

  private startTrip(handle: string, viewer: boolean, refs: StopRef[], plan: RoutePlan) {
    const prev = this.running();
    if (prev) {
      this.motion.stop();
      prev.status = "stopped";
      this.system(`Trip for @${prev.handle} (${prev.plan.summary}) was replaced.`, "info");
    }
    this.trip = { id: this.id("t"), handle, viewer, refs, plan, leg: -1, dwellLeft: 0, stopsDone: 0, status: "running", startedAt: this.deps.now(), doing: "", climbed: 0, rampOffset: 0 };
    this.lastActivity = this.deps.now();
    this.nextLeg();
  }

  private startDock(why: string) {
    const refs: StopRef[] = [{ kind: "area", text: "dock" }];
    const plan = this.plan(this.where(), refs);
    if (!plan.ok) {
      this.system(`Can't get back to the dock: ${plan.issue ?? "no route"}.`, "warn");
      return false;
    }
    this.system(`Heading to the dock (${why}).`, "info");
    this.startTrip("marty", false, refs, plan);
    return true;
  }

  private nextLeg() {
    const t = this.trip!;
    const prevLeg = t.plan.legs[t.leg];
    t.leg++;
    const leg = t.plan.legs[t.leg];
    // A stop is done once its last leg is (a card's drive + look, a full lap, arriving on a floor).
    const stopOf = (l: typeof leg) => (l && l.kind !== "ramp" ? l.stop?.name : undefined);
    if (stopOf(prevLeg) && stopOf(leg) !== stopOf(prevLeg)) t.stopsDone++;
    if (prevLeg?.kind === "ramp") {
      this.floor = prevLeg.to;
      this.level = prevLeg.to;
    }
    if (!leg) {
      this.finishTrip("done");
      return;
    }
    t.doing = leg.label;
    if (leg.kind === "drive") this.motion.follow(leg.path, `${t.id}:${t.leg}`, leg.face ?? null);
    else if (leg.kind === "ramp") {
      t.climbed = 0;
      t.rampOffset = 0;
      this.motion.follow(leg.path, `${t.id}:${t.leg}`);
    } else t.dwellLeft = leg.seconds;
    this.emit({ type: "trip", trip: this.publicTrip() });
  }

  private onDriveArrived() {
    const t = this.trip!;
    const leg = t.plan.legs[t.leg];
    if (leg.kind === "drive" && leg.stop?.cardId && t.viewer) this.arriveAtCard(t, leg.stop.cardId, leg.stop.name);
    this.nextLeg();
  }

  private arriveAtCard(t: Trip, cardId: string, name: string) {
    const now = this.deps.now();
    const award = this.game.arrive(cardId, t.handle, now);
    if (award) {
      const parts = [award.base ? `${award.base} base` : "", award.bonus ? `${award.bonus} ${award.bonusLabel ?? "bonus"}` : ""].filter(Boolean).join(" + ");
      this.system(`+${award.total} for @${t.handle} at ${name} (${parts}).`, "game");
      this.emitGame(true);
    } else this.system(`${name} already paid out recently. No points this time.`, "game");

    const last = t.plan.stops.at(-1)?.cardId === cardId && t.plan.legs.slice(t.leg + 1).every((l) => l.kind === "dwell");
    const d = this.policy.decide({ type: "arrive", cardId, missionId: `${t.id}:${cardId}`, at: now });
    if (!d.allow) {
      if (last) this.upsert({ id: this.id("m"), kind: "marty", at: now, state: "done", text: arrivalQuip(name, this.seq), source: "built-in", to: [t.handle] });
      return;
    }
    const card = this.b.cards.find((c) => c.id === cardId);
    void this.track(
      this.lookup({ trigger: d.trigger, cardId, exclude: this.policy.said(), recentKinds: this.policy.recentKinds(card?.player.lahmanId) }).then((k) => {
        const fact = k?.facts[0]?.text;
        if (k?.facts.length) this.policy.record({ cardId, missionId: `${t.id}:${cardId}`, at: now, facts: k.facts.map((f) => ({ id: f.id, kind: f.kind, playerId: f.subject.playerId })), volunteered: true });
        if (!fact) {
          if (last) this.upsert({ id: this.id("m"), kind: "marty", at: this.deps.now(), state: "done", text: arrivalQuip(name, this.seq), source: "built-in", to: [t.handle] });
          return;
        }
        return this.speak({
          kind: "arrive",
          to: [t.handle],
          instruction: `You just pulled up to the ${name} card on @${t.handle}'s trip. One fresh observation using the fact.`,
          facts: `arrived at: ${name}\ntrip for @${t.handle}: ${t.plan.summary}${award ? `\npoints just earned by @${t.handle}: ${award.total}` : ""}`,
          fallback: `${arrivalQuip(name, this.seq)} While I'm here: ${fact}`,
          knowledge: k,
        });
      }),
    );
  }

  private finishTrip(status: "done" | "stopped" | "failed", note?: string) {
    const t = this.trip;
    if (!t) return;
    t.status = status;
    t.doing = status === "done" ? "finished" : (note ?? status);
    this.emit({ type: "trip", trip: this.publicTrip() });
    this.lastActivity = this.deps.now();
    if (status === "done") {
      if (t.viewer) this.system(`Trip complete for @${t.handle}: ${t.plan.summary}. Now on floor ${this.floor}.`, "info");
      if (t.viewer && this.battery.level < this.config.autoDockBelow && !this.docked()) {
        this.system(`Rule B3: battery at ${Math.round(this.battery.level)}%, below ${this.config.autoDockBelow}%.`, "warn");
        this.startDock("low battery");
        return;
      }
      // Queued requests get another look now that Marty is free.
      if (this.queued.length && this.dueAt === null) this.dueAt = this.deps.now() + 500;
    }
  }

  private halt(why: string) {
    const t = this.running();
    this.motion.stop();
    if (t) {
      this.finishTrip("stopped", why);
      this.system(`Stopped: ${why}.`, "warn");
    }
  }

  /** Remaining distance and time on the current trip. */
  private remaining() {
    const t = this.running();
    if (!t) return { meters: 0, seconds: 0 };
    const s = this.motion.getState();
    const leg = t.plan.legs[t.leg];
    let meters = 0;
    let dwell = t.dwellLeft;
    if ((leg?.kind === "drive" || leg?.kind === "ramp") && s.status === "moving") {
      let prev: Vec = s.pose;
      for (const p of s.path.slice(s.waypoint)) {
        meters += Math.hypot(p.x - prev.x, p.y - prev.y);
        prev = p;
      }
    }
    for (const l of t.plan.legs.slice(t.leg + 1)) {
      if (l.kind === "dwell") dwell += l.seconds;
      else meters += l.meters;
    }
    return { meters, seconds: meters / this.motion.getSpeed() + dwell };
  }

  private publicTrip(): PublicTrip | null {
    const t = this.trip;
    if (!t) return null;
    return {
      id: t.id,
      handle: t.handle,
      summary: t.plan.summary,
      status: t.status,
      stops: t.plan.stops.map((s, i) => ({ name: s.name, ...(s.cardId ? { cardId: s.cardId } : {}), point: s.point, floor: s.floor, done: i < t.stopsDone })),
      legs: t.plan.legs.flatMap((l, i) => {
        const done = i < t.leg || t.status === "done";
        if (l.kind === "drive") return [{ path: l.path, done, floor: l.floor }];
        if (l.kind === "ramp") return [{ path: l.path, done, floor: l.from, ramp: { from: l.from, to: l.to, incline: l.incline } }];
        return [];
      }),
      estimate: { meters: t.plan.meters, seconds: t.plan.seconds, battery: t.plan.battery },
      startedAt: t.startedAt,
      doing: t.doing,
    };
  }

  // ── Operator ──────────────────────────────────────────────────────────

  operator(cmd: OperatorCommand): { ok: boolean; message: string } {
    const s = this.motion.getState();
    const moving = s.status === "moving" || !!this.running();
    switch (cmd.action) {
      case "stop":
        this.stopToken++;
        if (!moving) return { ok: true, message: "Marty wasn't moving." };
        this.halt("operator stop");
        return { ok: true, message: "Stopped." };
      case "resume": {
        const t = this.trip;
        if (!t || t.status !== "stopped" || moving) return { ok: false, message: "Nothing to resume." };
        const refs = t.refs.slice(t.stopsDone);
        if (t.plan.legs[t.leg]?.kind === "ramp") {
          // Stopped part-way up (or down) a ramp: finish it, then carry on with the rest of the trip.
          const st = this.motion.getState();
          t.rampOffset += st.travelled;
          t.status = "running";
          t.doing = t.plan.legs[t.leg].label;
          this.motion.follow([{ x: st.pose.x, y: st.pose.y }, ...st.path.slice(st.waypoint)], `${t.id}:${t.leg}`);
          this.system(`Resuming @${t.handle}'s trip from the ramp.`, "info");
          this.emit({ type: "trip", trip: this.publicTrip() });
          return { ok: true, message: "Resumed." };
        }
        const plan = this.plan(this.where(), refs);
        if (!plan.ok) return { ok: false, message: plan.issue ?? "No route from here." };
        this.system(`Resuming @${t.handle}'s trip: ${plan.summary}.`, "info");
        this.startTrip(t.handle, t.viewer, refs, plan);
        return { ok: true, message: "Resumed." };
      }
      case "dock":
        if (moving) return { ok: false, message: "Stop Marty first." };
        return this.startDock("operator") ? { ok: true, message: "Heading to the dock." } : { ok: false, message: "No route to the dock." };
      case "reset":
        this.reset();
        return { ok: true, message: "Reset." };
      case "place": {
        if (moving) return { ok: false, message: "Stop Marty before repositioning him." };
        const floor = cmd.floor ?? this.floor;
        if (!this.b.floors.some((f) => f.level === floor)) return { ok: false, message: `There's no floor ${floor}.` };
        const pose = { x: Math.round(cmd.x * 1000) / 1000, y: Math.round(cmd.y * 1000) / 1000, heading: s.pose.heading };
        const why = blockReason(floorEnv(this.b, floor), this.grid(floor), pose);
        if (why) return { ok: false, message: `Can't place Marty there: ${why}.` };
        this.floor = floor;
        this.level = floor;
        this.motion.setPose(pose);
        this.emitTelemetry(true);
        return { ok: true, message: `Placed on floor ${floor}.` };
      }
      case "rotate":
        if (moving) return { ok: false, message: "Stop Marty before turning him." };
        this.motion.setPose({ ...s.pose, heading: s.pose.heading + (cmd.deg * Math.PI) / 180 });
        this.emitTelemetry(true);
        return { ok: true, message: "Rotated." };
      case "speed":
        this.motion.setSpeed(cmd.mps);
        this.emitTelemetry(true);
        return { ok: true, message: `Speed set.` };
      case "battery":
        this.battery.set(cmd.level);
        this.emitTelemetry(true);
        return { ok: true, message: `Battery set to ${Math.round(this.battery.level)}%.` };
    }
  }

  reset() {
    this.epoch++;
    this.stopToken++;
    this.motion.stop();
    this.motion.setPose(this.b.defaultPose);
    this.floor = this.b.defaultFloor;
    this.level = this.floor;
    this.battery.set(100);
    this.battery.metersDriven = 0;
    const now = this.deps.now();
    this.game.reset(now);
    this.policy.reset();
    this.chat = [];
    this.pending = [];
    this.queued = [];
    this.trip = null;
    this.deciding = false;
    this.dueAt = null;
    this.lastPost.clear();
    this.lastActivity = now;
    this.idleCount = 0;
    this.emit({ type: "snapshot", snapshot: this.snapshot() });
  }

  // ── Clock ─────────────────────────────────────────────────────────────

  /** Advance the world to `now` (ms). Called ~10× a second by the server. */
  tick(now: number) {
    const dt = Math.min(0.25, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    const t = this.running();

    if (t && this.battery.dead) {
      this.motion.stop();
      this.finishTrip("failed", "battery empty");
      this.system("Battery empty. Marty can't move until he's carried back to the dock (operator: place him on the dock) or the session is reset.", "warn");
    } else if (t) {
      const leg = t.plan.legs[t.leg];
      if (leg?.kind === "drive") {
        this.motion.advance(dt);
        const s = this.motion.getState();
        if (s.status === "arrived" && s.missionId === `${t.id}:${t.leg}`) this.onDriveArrived();
      } else if (leg?.kind === "ramp") {
        this.motion.advance(dt);
        const s = this.motion.getState();
        // Height follows the distance actually travelled along the incline; climbing costs extra battery.
        const [a, z] = leg.incline;
        const along = Math.min(z, Math.max(a, s.travelled + t.rampOffset));
        const frac = (along - a) / (z - a);
        this.level = leg.from + (leg.to - leg.from) * frac;
        if (leg.to > leg.from) {
          this.battery.spend((along - a - t.climbed) * this.battery.config.climbPerMeter);
          t.climbed = along - a;
        }
        if (s.status === "arrived" && s.missionId === `${t.id}:${t.leg}`) this.nextLeg();
      } else if (leg?.kind === "dwell") {
        const used = Math.min(dt, t.dwellLeft);
        if (leg.battery) this.battery.spend((leg.battery * used) / leg.seconds);
        t.dwellLeft -= dt;
        if (t.dwellLeft <= 1e-9) this.nextLeg();
      }
    }

    const moving = this.motion.getState().status === "moving";
    const wasCharging = this.charging;
    this.charging = this.battery.charge(this.motion.getState().pose, this.dock(), dt, moving || !!this.running());
    if (wasCharging && !this.charging && this.battery.level >= 100) this.system("Fully charged.", "info");

    const g = this.game.tick(now);
    for (const b of g.spawned) this.system(`Bonus! ${b.label}: +${b.points} at ${b.cardName} for the next ${Math.round((b.expiresAt - now) / 1000)} s.`, "game");
    this.emitGame(g.spawned.length > 0 || g.expired.length > 0);

    if (!this.deciding && this.dueAt !== null && now >= this.dueAt) {
      if (this.pending.length || this.queued.length) void this.track(this.runBatch());
      else this.dueAt = null;
    }
    this.maybeMuse(now);
    this.emitTelemetry(false);
  }

  // ── Idle thoughts ─────────────────────────────────────────────────────

  /** How long Marty waits before his next musing: doubles each time nobody answers. */
  private idleDelay() {
    return Math.min(this.config.idleMaxMs, this.config.idleAfterMs * 2 ** this.idleCount);
  }

  /** When the room has been quiet for a while (and someone is watching), Marty thinks out loud. */
  private maybeMuse(now: number) {
    if (!this.viewers || this.running() || this.deciding || this.pending.length) return;
    if (now - this.lastActivity < this.idleDelay()) return;
    this.lastActivity = now;
    this.idleCount++;
    if (!this.idleTopics.length) this.idleTopics = shuffle(IDLE_TOPICS, this.seq + this.idleCount);
    const topic = this.idleTopics.pop()!;
    const env = floorEnv(this.b, this.floor);
    const nearby = env.cards.map((c) => `${c.name} (${c.year} ${c.team})`).join(", ");
    const quiet = Math.round((this.idleDelay() / 2 / 60_000) * 10) / 10;
    void this.speak(
      {
        kind: "idle",
        to: [],
        instruction: `Nobody has said anything for a while. Think out loud in 1 or 2 short sentences, as if to yourself: ${topic} Be wry, a little existential, never gloomy or needy. Don't ask viewers to do anything unless it's a fun idea. Don't repeat an earlier musing.`,
        facts: `floor: ${this.floor} of ${this.b.floors.length} (${env.name})\ncards on this floor: ${nearby || "none"}\nbattery: ${Math.round(this.battery.level)}%\nquiet for about ${quiet} minutes\nviewers watching: ${this.viewers}`,
        fallback: idleLine(topic, { floor: this.floor, floorName: env.name, battery: this.battery.level, card: env.cards[this.idleCount % Math.max(1, env.cards.length)]?.name }),
      },
      { idle: true },
    );
  }

  private telemetry(now: number): Telemetry {
    const s = this.motion.getState();
    const t = this.running();
    const rem = this.remaining();
    return {
      at: now,
      pose: { x: Math.round(s.pose.x * 10000) / 10000, y: Math.round(s.pose.y * 10000) / 10000, heading: Math.round(s.pose.heading * 1000) / 1000 },
      floor: this.floor,
      level: Math.round(this.level * 1000) / 1000,
      status: t ? "moving" : s.status,
      speed: this.motion.getSpeed(),
      battery: { level: Math.round(this.battery.level * 10) / 10, range: Math.round(this.battery.range * 100) / 100, reserve: this.battery.config.reserve, charging: this.charging, dead: this.battery.dead },
      trip: t ? { remainingMeters: Math.round(rem.meters * 1000) / 1000, etaSeconds: Math.round(rem.seconds) } : null,
      metersDriven: Math.round(this.battery.metersDriven * 1000) / 1000,
    };
  }

  private emitTelemetry(force: boolean) {
    const now = this.deps.now();
    const tel = this.telemetry(now);
    const key = JSON.stringify({ ...tel, at: 0 });
    if (!force && key === this.lastTelemetry.key && now - this.lastTelemetry.at < 2000) return;
    this.lastTelemetry = { key, at: now };
    this.emit({ type: "telemetry", telemetry: tel });
  }

  private emitGame(force: boolean) {
    const now = this.deps.now();
    if (!force && now - this.lastGame.at < 1000) return;
    const game: GameSnapshot = this.game.snapshot(now);
    const key = JSON.stringify(game);
    this.lastGame.at = now;
    if (key === this.lastGame.key) return;
    this.lastGame.key = key;
    this.emit({ type: "game", game });
  }
}

function publicFacts(k: KnowledgeBundle | null | undefined) {
  return (k?.facts ?? []).map((f) => ({ id: f.id, kind: f.kind, playerId: f.subject.playerId, text: f.text, verification: f.verification, source: f.source }));
}

/** True when `to` is in the same connected free region as `from`. */
function connected(g: Grid, from: Vec, to: Vec): boolean {
  const cell = (p: Vec) => ({ c: Math.floor(p.x / g.resolution), r: Math.floor(p.y / g.resolution) });
  const a = cell(from);
  const z = cell(to);
  const seen = new Uint8Array(g.cols * g.rows);
  const free = (c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && !g.blocked[r * g.cols + c];
  if (!free(a.c, a.r) || !free(z.c, z.r)) return false;
  const q = [a.r * g.cols + a.c];
  seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    if (i === z.r * g.cols + z.c) return true;
    const c = i % g.cols;
    const r = (i - c) / g.cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (free(nc, nr) && !seen[nr * g.cols + nc]) {
        seen[nr * g.cols + nc] = 1;
        q.push(nr * g.cols + nc);
      }
    }
  }
  return false;
}

/** Deterministic shuffle (so tests are repeatable). */
function shuffle<T>(list: readonly T[], seed: number): T[] {
  const out = [...list];
  let a = (seed * 2654435761) >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    a = (a * 1664525 + 1013904223) >>> 0;
    const j = a % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
