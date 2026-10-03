/**
 * Baseball knowledge service: the one entry point other parts of Marty use.
 * Model-agnostic. It returns structured, sourced facts; the voice layer
 * decides how to say them.
 */
import type { Card } from "../twin/environment.ts";
import { buildFacts, selectFacts } from "./facts.ts";
import type { KnowledgeStore } from "./store.ts";
import type { Fact } from "./types.ts";
import { type WikipediaClient, wikiFacts } from "./wikipedia.ts";

export type KnowledgeTrigger = "navigate" | "arrive" | "revisit" | "ask";

export interface KnowledgeRequest {
  trigger: KnowledgeTrigger;
  /** Card Marty is heading to / looking at. */
  cardId?: string;
  /** What the person said, for questions. */
  text?: string;
  /** Fact ids already shared this session. */
  exclude?: string[];
  /** Fact kinds recently used, to keep variety. */
  recentKinds?: string[];
}

export interface KnowledgeBundle {
  trigger: KnowledgeTrigger;
  status: "resolved" | "ambiguous" | "not_found" | "none";
  subject?: { playerId: string; name: string; cardId?: string };
  /** For ambiguous names: who it could be. */
  options?: { name: string; years: string }[];
  facts: Fact[];
  dataset: { version: string; seasonsThrough: number };
}

const YEAR = /\b(18[7-9]\d|19\d\d|20[0-4]\d)\b/;

export class BaseballKnowledge {
  readonly store: KnowledgeStore;
  private cards: Card[];
  private wiki: WikipediaClient | null;

  constructor(store: KnowledgeStore, cards: Card[], wiki: WikipediaClient | null) {
    this.store = store;
    this.cards = cards;
    this.wiki = wiki;
  }

  private dataset() {
    return { version: this.store.meta.version, seasonsThrough: this.store.meta.seasonsThrough };
  }

  /** Wikipedia title for an identified player: the card mapping, else the index name if it is unique. */
  private wikiTitle(playerId: string, via: "card" | "index"): string | null {
    const card = this.cards.find((c) => c.player.lahmanId === playerId);
    if (card) return card.player.wikipediaTitle;
    if (via !== "index") return null;
    const name = this.store.displayName(playerId);
    const same = this.store.data.index.filter((r) => `${r[1]} ${r[2]}` === name);
    return same.length === 1 ? name : null;
  }

  /** Wikipedia facts: cached only, plus a background refresh, unless `wait` allows a bounded fetch. */
  private async wikiFor(playerId: string, title: string | null, wait: boolean): Promise<Fact[]> {
    if (!this.wiki || !title) return [];
    const subject = { playerId, name: this.store.displayName(playerId) };
    const cached = this.wiki.cached(title);
    if (cached !== undefined) return wikiFacts(cached, subject);
    const pending = this.wiki.fetchSummary(title); // never rejects
    if (!wait) return [];
    return wikiFacts(await pending, subject);
  }

  /** Ranked facts for a card's player, excluding anything already said. */
  async getInterestingFacts(cardId: string, opts: { exclude?: string[]; recentKinds?: string[]; limit?: number; waitForWiki?: boolean } = {}) {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card) return { card: null, facts: [] as Fact[] };
    const id = card.player.lahmanId;
    const all = [...buildFacts(this.store, id, { card }), ...(await this.wikiFor(id, card.player.wikipediaTitle, !!opts.waitForWiki))];
    return { card, facts: selectFacts(all, { exclude: opts.exclude, recentKinds: opts.recentKinds, limit: opts.limit ?? 1 }) };
  }

  /** Everything the voice needs for one moment: a small, sourced fact bundle. */
  async bundle(req: KnowledgeRequest): Promise<KnowledgeBundle> {
    const base = { trigger: req.trigger, facts: [] as Fact[], dataset: this.dataset() };
    if (req.cardId && req.trigger !== "ask") {
      const { card, facts } = await this.getInterestingFacts(req.cardId, { exclude: req.exclude, recentKinds: req.recentKinds, limit: 1 });
      if (!card) return { ...base, status: "none" };
      return { ...base, status: "resolved", subject: { playerId: card.player.lahmanId, name: card.name, cardId: card.id }, facts };
    }
    if (!req.text) return { ...base, status: "none" };

    const who = this.store.resolvePlayer(req.text);
    if (who.status === "not_found") return { ...base, status: "none" };
    if (who.status === "ambiguous") {
      return { ...base, status: "ambiguous", options: who.options.map((o) => ({ name: o.name, years: o.years })) };
    }
    const year = Number(YEAR.exec(req.text)?.[1]) || undefined;
    const card = this.cards.find((c) => c.player.lahmanId === who.playerId);
    const facts = [...buildFacts(this.store, who.playerId, { card, year }), ...(await this.wikiFor(who.playerId, this.wikiTitle(who.playerId, who.via), true))];
    if (!facts.length) return { ...base, status: "not_found", subject: { playerId: who.playerId, name: who.name } };
    return {
      ...base,
      status: "resolved",
      subject: { playerId: who.playerId, name: who.name, ...(card ? { cardId: card.id } : {}) },
      facts: selectFacts(facts, { exclude: req.exclude, recentKinds: req.recentKinds, limit: 3 }),
    };
  }
}
