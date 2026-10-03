/**
 * Chat director: turns mission lifecycle changes into Marty's chat lines.
 *
 * Listens to the existing TwinController (no second event system). For each
 * mission it requests one reply when there is something to report, and at most
 * one follow-up when the mission finishes. Baseball knowledge is attached when
 * the commentary policy allows it (heading to / arriving at a card, revisits)
 * and always for questions. Requests are async and their failures fall back to
 * built-in lines; nothing here can block or move the robot.
 */
import { CommentaryPolicy } from "../baseball/commentary.ts";
import type { FactSource } from "../baseball/types.ts";
import type { ControllerState, Mission, TwinController } from "../twin/controller.ts";
import { afterLine, builtInReply, type Outcome, outcomeOf } from "./lines.ts";

export interface PublicFact {
  id: string;
  kind: string;
  playerId: string;
  text: string;
  verification: "dataset" | "sourced";
  source: FactSource;
}

export interface ReplyPayload {
  text: string;
  source: "openai" | "built-in";
  model?: string;
  facts?: PublicFact[];
}

export interface Reply {
  state: "pending" | "done";
  text?: string;
  source?: "openai" | "built-in";
  model?: string;
  /** Mission status the reply was written for. */
  at: string;
  facts?: PublicFact[];
}

export interface ChatEntry {
  reply?: Reply;
  /** Follow-up when the mission finished (arrival comment, or a short line). */
  after?: Reply;
}

export interface DirectorState {
  entries: Record<string, ChatEntry>;
}

export interface ReplyRequest {
  outcome: Outcome;
  history: { role: "user" | "assistant"; text: string }[];
  knowledge?: { trigger: "navigate" | "arrive" | "revisit" | "ask"; cardId?: string; text?: string; exclude: string[]; recentKinds: string[] };
}

export interface DirectorDeps {
  ctl: Pick<TwinController, "getState" | "subscribe">;
  request: (body: ReplyRequest) => Promise<ReplyPayload>;
  cardNames: string[];
  /** Lahman id per card id, for variety tracking. */
  cardPlayer?: Record<string, string>;
  policy?: CommentaryPolicy;
  now?: () => number;
}

const FINISHED = ["arrived", "stopped", "cancelled"];

export class ChatDirector {
  private deps: DirectorDeps;
  readonly policy: CommentaryPolicy;
  private now: () => number;
  private state: DirectorState = { entries: {} };
  private listeners = new Set<(s: DirectorState) => void>();
  /** Bumped on reset so late responses from before it are dropped. */
  private epoch = 0;

  constructor(deps: DirectorDeps) {
    this.deps = deps;
    this.policy = deps.policy ?? new CommentaryPolicy();
    this.now = deps.now ?? (() => Date.now());
    deps.ctl.subscribe((s) => this.sync(s));
    this.sync(deps.ctl.getState());
  }

  getState = () => this.state;

  subscribe = (l: (s: DirectorState) => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  private set(id: string, patch: Partial<ChatEntry>) {
    this.state = { entries: { ...this.state.entries, [id]: { ...this.state.entries[id], ...patch } } };
    for (const l of this.listeners) l(this.state);
  }

  private busy() {
    return Object.values(this.state.entries).some((e) => e.reply?.state === "pending" || e.after?.state === "pending");
  }

  private history(missions: Mission[], before: number) {
    return missions
      .filter((x) => x.seq < before && this.state.entries[x.id]?.reply?.text)
      .slice(-5)
      .flatMap((x) => [
        { role: "user" as const, text: x.request },
        { role: "assistant" as const, text: this.state.entries[x.id].reply!.text! },
      ]);
  }

  private sync(s: ControllerState) {
    if (s.missions.length === 0) {
      if (Object.keys(this.state.entries).length) {
        this.epoch++;
        this.policy.reset();
        this.state = { entries: {} };
        for (const l of this.listeners) l(this.state);
      }
      return;
    }
    for (const m of s.missions) {
      const entry = this.state.entries[m.id];
      if (!entry?.reply) {
        const o = outcomeOf(m);
        if (o) this.replyTo(m, o, s.missions);
      } else if (entry.reply.at === "moving" && !entry.after && FINISHED.includes(m.status)) {
        this.followUp(m, s.missions);
      }
    }
  }

  private knowledgeFor(m: Mission, o: Outcome, type: "navigate" | "arrive"): ReplyRequest["knowledge"] | undefined {
    if (o.status === "answered") {
      return { trigger: "ask", text: m.request, exclude: this.policy.said(), recentKinds: [] };
    }
    if (m.target?.kind !== "card") return undefined;
    const d = this.policy.decide({ type, cardId: m.target.id, missionId: m.id, at: this.now(), busy: type === "arrive" && this.busy() });
    if (!d.allow) return undefined;
    return {
      trigger: d.trigger,
      cardId: m.target.id,
      exclude: this.policy.said(),
      recentKinds: this.policy.recentKinds(this.deps.cardPlayer?.[m.target.id]),
    };
  }

  private async call(body: ReplyRequest): Promise<ReplyPayload> {
    try {
      return await this.deps.request(body);
    } catch {
      return { text: builtInReply(body.outcome, this.deps.cardNames), source: "built-in", facts: [] };
    }
  }

  private replyTo(m: Mission, o: Outcome, missions: Mission[]) {
    const knowledge = o.status === "moving" || o.status === "answered" ? this.knowledgeFor(m, o, "navigate") : undefined;
    this.set(m.id, { reply: { state: "pending", at: o.status } });
    const epoch = this.epoch;
    void this.call({ outcome: o, history: this.history(missions, m.seq), knowledge }).then((res) => {
      if (epoch !== this.epoch) return;
      this.policy.record({
        cardId: knowledge?.cardId,
        missionId: m.id,
        at: this.now(),
        facts: res.facts ?? [],
        volunteered: knowledge?.trigger !== "ask",
      });
      this.set(m.id, { reply: { state: "done", at: o.status, text: res.text, source: res.source, model: res.model, facts: res.facts ?? [] } });
    });
  }

  private followUp(m: Mission, missions: Mission[]) {
    const quip = afterLine(m.status, m.target?.name, m.seq);
    const o = outcomeOf(m);
    const knowledge = m.status === "arrived" && o ? this.knowledgeFor(m, o, "arrive") : undefined;
    if (!knowledge || !o) {
      if (quip) this.set(m.id, { after: { state: "done", at: m.status, text: quip, source: "built-in" } });
      else this.set(m.id, { after: { state: "done", at: m.status } });
      return;
    }
    this.set(m.id, { after: { state: "pending", at: m.status } });
    const epoch = this.epoch;
    void this.call({ outcome: o, history: this.history(missions, m.seq + 1), knowledge }).then((res) => {
      if (epoch !== this.epoch) return;
      const facts = res.facts ?? [];
      this.policy.record({ cardId: knowledge.cardId, missionId: m.id, at: this.now(), facts, volunteered: true });
      // No fact available: keep it short rather than padding.
      const text = facts.length ? res.text : (quip ?? res.text);
      this.set(m.id, { after: { state: "done", at: m.status, text, source: facts.length ? res.source : "built-in", model: res.model, facts } });
    });
  }
}
