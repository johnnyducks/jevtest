/**
 * Game layer: destinations are worth points, bonuses spawn and expire to keep
 * the room feeling alive, and points accumulate per viewer.
 *
 * Deterministic given a seed and a clock, so it can be tested and replayed.
 */
import type { Card } from "../twin/environment.ts";

export interface Bonus {
  id: string;
  cardId: string;
  cardName: string;
  points: number;
  label: string;
  spawnedAt: number;
  expiresAt: number;
}

export interface GameConfig {
  /** Seconds between spawns (random within range). */
  spawnEverySec: [number, number];
  /** Bonus lifetime, seconds. */
  lifetimeSec: [number, number];
  /** Bonus value range. */
  points: [number, number];
  maxActive: number;
  /** A card's base points can be earned again after this long, seconds. */
  cardCooldownSec: number;
}

/** Bonuses are a treat, not a feed: one every couple of minutes, lasting long enough to drive to (even a few floors away). */
export const GAME: GameConfig = { spawnEverySec: [90, 180], lifetimeSec: [150, 240], points: [20, 80], maxActive: 2, cardCooldownSec: 120 };

const LABELS = ["Hot streak", "Rookie bonus", "Fan favorite", "Golden glove", "Rally cap", "Walk-off"];

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Award {
  handle: string;
  cardId: string;
  cardName: string;
  base: number;
  bonus: number;
  bonusLabel?: string;
  total: number;
}

export interface GameSnapshot {
  bonuses: Bonus[];
  scores: { handle: string; points: number }[];
  total: number;
  cardPoints: Record<string, number>;
}

export class Game {
  private cards: Card[];
  private reachable: Card[];
  private canReach: (c: Card) => boolean;
  private config: GameConfig;
  private random: () => number;
  private bonuses: Bonus[] = [];
  private scores = new Map<string, number>();
  private lastEarned = new Map<string, number>();
  private nextSpawnAt: number;
  private seq = 0;

  /** `canReach` says whether Marty can get to a card at all (bonuses only go on reachable cards). */
  constructor(cards: Card[], canReach: (c: Card) => boolean, opts: { seed?: number; now: number; config?: Partial<GameConfig> }) {
    this.cards = cards;
    this.config = { ...GAME, ...opts.config };
    this.random = rng(opts.seed ?? 7);
    this.canReach = canReach;
    this.reachable = cards.filter(canReach);
    this.nextSpawnAt = opts.now + this.between(this.config.spawnEverySec) * 1000 * 0.5;
  }

  private between([lo, hi]: [number, number]) {
    return lo + this.random() * (hi - lo);
  }

  /** The card list changed (catalog edit): recompute which cards can hold bonuses, drop bonuses on removed cards. */
  refresh() {
    this.reachable = this.cards.filter(this.canReach);
    const ids = new Set(this.cards.map((c) => c.id));
    this.bonuses = this.bonuses.filter((b) => ids.has(b.cardId));
  }

  /** Advance time: expire old bonuses, spawn new ones. Returns what changed. */
  tick(now: number): { spawned: Bonus[]; expired: Bonus[] } {
    const expired = this.bonuses.filter((b) => b.expiresAt <= now);
    this.bonuses = this.bonuses.filter((b) => b.expiresAt > now);
    const spawned: Bonus[] = [];
    if (now >= this.nextSpawnAt) {
      if (this.bonuses.length < this.config.maxActive) {
        const free = this.reachable.filter((c) => !this.bonuses.some((b) => b.cardId === c.id));
        if (free.length) {
          const card = free[Math.floor(this.random() * free.length)];
          const pts = Math.round(this.between(this.config.points) / 5) * 5;
          const b: Bonus = {
            id: `b${++this.seq}`,
            cardId: card.id,
            cardName: card.name,
            points: pts,
            label: LABELS[Math.floor(this.random() * LABELS.length)],
            spawnedAt: now,
            expiresAt: now + Math.round(this.between(this.config.lifetimeSec)) * 1000,
          };
          this.bonuses.push(b);
          spawned.push(b);
        }
      }
      this.nextSpawnAt = now + this.between(this.config.spawnEverySec) * 1000;
    }
    return { spawned, expired };
  }

  /** Points available at a card right now (base, unless on cooldown, plus any bonus). */
  valueAt(cardId: string, now: number): { base: number; bonus: Bonus | null } {
    const card = this.cards.find((c) => c.id === cardId);
    const last = this.lastEarned.get(cardId);
    const base = card && (last === undefined || now - last >= this.config.cardCooldownSec * 1000) ? card.points : 0;
    return { base, bonus: this.bonuses.find((b) => b.cardId === cardId) ?? null };
  }

  /** Marty reached a card on `handle`'s request: award its points. */
  arrive(cardId: string, handle: string, now: number): Award | null {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card) return null;
    const { base, bonus } = this.valueAt(cardId, now);
    const total = base + (bonus?.points ?? 0);
    if (!total) return null;
    if (base) this.lastEarned.set(cardId, now);
    if (bonus) this.bonuses = this.bonuses.filter((b) => b.id !== bonus.id);
    this.scores.set(handle, (this.scores.get(handle) ?? 0) + total);
    return { handle, cardId, cardName: card.name, base, bonus: bonus?.points ?? 0, bonusLabel: bonus?.label, total };
  }

  snapshot(now: number): GameSnapshot {
    const scores = [...this.scores.entries()].map(([handle, points]) => ({ handle, points })).sort((a, b) => b.points - a.points || a.handle.localeCompare(b.handle));
    return {
      bonuses: [...this.bonuses],
      scores,
      total: scores.reduce((a, s) => a + s.points, 0),
      cardPoints: Object.fromEntries(this.cards.map((c) => [c.id, this.valueAt(c.id, now).base])),
    };
  }

  reset(now: number) {
    this.bonuses = [];
    this.scores.clear();
    this.lastEarned.clear();
    this.nextSpawnAt = now + this.between(this.config.spawnEverySec) * 1000 * 0.5;
  }
}
