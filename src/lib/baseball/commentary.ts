/**
 * Commentary policy: decides when Marty may volunteer a baseball fact, and
 * remembers what he has already said this session. Pure and client-safe.
 *
 * - Direct questions are never gated here (they always get an answer).
 * - At most one volunteered fact per trip: heading to a card and arriving at it
 *   are one moment, not two.
 * - A card discussed recently stays quiet; after `revisitAfterMs` a new trip
 *   to it counts as a revisit and gets a different fact.
 * - Arrival comments respect a global cooldown and never talk over a reply in progress.
 */

export interface CommentaryConfig {
  /** A card mentioned less than this long ago is not commented on again. */
  revisitAfterMs: number;
  /** Minimum gap between volunteered (unprompted) comments. */
  minGapMs: number;
}

export const DEFAULT_COMMENTARY: CommentaryConfig = { revisitAfterMs: 60_000, minGapMs: 8_000 };

export interface CommentaryEvent {
  type: "navigate" | "arrive";
  cardId: string;
  missionId: string;
  at: number;
  /** Another reply is being written (e.g. answering a question). */
  busy?: boolean;
}

export type CommentaryDecision =
  | { allow: true; trigger: "navigate" | "arrive" | "revisit" }
  | { allow: false; reason: "busy" | "same_trip" | "cooldown" | "recent" };

export class CommentaryPolicy {
  private config: CommentaryConfig;
  private lastByCard = new Map<string, { at: number; missionId: string }>();
  private saidIds = new Set<string>();
  private kindsByPlayer = new Map<string, string[]>();
  private lastVolunteered = -Infinity;

  constructor(config: Partial<CommentaryConfig> = {}) {
    this.config = { ...DEFAULT_COMMENTARY, ...config };
  }

  decide(e: CommentaryEvent): CommentaryDecision {
    const last = this.lastByCard.get(e.cardId);
    if (e.busy) return { allow: false, reason: "busy" };
    if (last && last.missionId === e.missionId) return { allow: false, reason: "same_trip" };
    if (e.type === "arrive" && e.at - this.lastVolunteered < this.config.minGapMs) return { allow: false, reason: "cooldown" };
    if (last && e.at - last.at < this.config.revisitAfterMs) return { allow: false, reason: "recent" };
    return { allow: true, trigger: last ? "revisit" : e.type };
  }

  /** Record facts that were actually delivered. Only call when facts were shared. */
  record(r: { cardId?: string; missionId?: string; at: number; facts: { id: string; kind: string; playerId: string }[]; volunteered: boolean }) {
    if (!r.facts.length) return;
    for (const f of r.facts) {
      this.saidIds.add(f.id);
      const kinds = this.kindsByPlayer.get(f.playerId) ?? [];
      this.kindsByPlayer.set(f.playerId, [f.kind, ...kinds].slice(0, 3));
    }
    if (r.cardId && r.missionId) this.lastByCard.set(r.cardId, { at: r.at, missionId: r.missionId });
    if (r.volunteered) this.lastVolunteered = r.at;
  }

  said(): string[] {
    return [...this.saidIds];
  }

  recentKinds(playerId: string | undefined): string[] {
    return playerId ? (this.kindsByPlayer.get(playerId) ?? []) : [];
  }

  reset() {
    this.lastByCard.clear();
    this.saidIds.clear();
    this.kindsByPlayer.clear();
    this.lastVolunteered = -Infinity;
  }
}
