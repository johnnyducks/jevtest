/**
 * Deterministic lookups over the imported Lahman knowledge file.
 * Pure: construct with the parsed JSON (server) or a fixture (tests).
 */
import type { Card } from "../twin/environment.ts";
import type { DetailedPlayer, DetailedSeason, KnowledgeData, PlayerResolution, TeamSeason } from "./types.ts";

/** Column order of the compact career arrays (must match scripts/import-lahman.ts). */
export const BAT_KEYS = ["G", "AB", "R", "H", "2B", "3B", "HR", "RBI", "SB", "CS", "BB", "SO", "HBP", "SF", "SH"] as const;
export const PIT_KEYS = ["W", "L", "G", "GS", "SV", "IPouts", "H", "ER", "BB", "SO", "SHO", "CG"] as const;

const zip = (keys: readonly string[], vals?: number[]) => (vals ? Object.fromEntries(keys.map((k, i) => [k, vals[i] ?? 0])) : null);

export function normalizeName(s: string): string {
  return ` ${s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']s\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

export interface CareerRecord {
  playerId: string;
  name: string;
  birthYear: number | null;
  debutYear: number | null;
  finalYear: number | null;
  bat: Record<string, number> | null;
  pit: Record<string, number> | null;
  awards: { award: string; year: number; lg: string; notes: string }[];
  allStar: number[];
  hof: KnowledgeData["careers"][string]["hof"] | null;
}

export class KnowledgeStore {
  readonly data: KnowledgeData;
  private byId = new Map<string, KnowledgeData["index"][number]>();
  private byFullName = new Map<string, string[]>();

  private cards: Card[];

  constructor(data: KnowledgeData, cards: Card[] = []) {
    this.data = data;
    this.cards = cards;
    for (const row of data.index) {
      this.byId.set(row[0], row);
      const key = normalizeName(`${row[1]} ${row[2]}`);
      const list = this.byFullName.get(key) ?? [];
      list.push(row[0]);
      this.byFullName.set(key, list);
    }
  }

  get meta() {
    return this.data.meta;
  }

  displayName(id: string): string {
    const card = this.cards.find((c) => c.player.lahmanId === id);
    if (card) return card.name;
    const r = this.byId.get(id);
    return r ? `${r[1]} ${r[2]}` : id;
  }

  getPlayerProfile(id: string): DetailedPlayer | null {
    return this.data.players[id] ?? null;
  }

  getPlayerSeason(id: string, year: number): DetailedSeason | null {
    return this.data.players[id]?.seasons.find((s) => s.year === year) ?? null;
  }

  getTeamSeason(teamId: string, year: number): TeamSeason | null {
    return this.data.teams[`${teamId}-${year}`] ?? null;
  }

  getCareer(id: string): CareerRecord | null {
    const row = this.byId.get(id);
    if (!row) return null;
    const c = this.data.careers[id] ?? {};
    return {
      playerId: id,
      name: this.displayName(id),
      birthYear: row[3],
      debutYear: row[4],
      finalYear: row[5],
      bat: zip(BAT_KEYS, c.b),
      pit: zip(PIT_KEYS, c.p),
      awards: (c.aw ?? []).map(([award, year, lg, notes]) => ({ award, year, lg, notes })),
      allStar: c.as ?? [],
      hof: c.hof ?? null,
    };
  }

  /** All-time rank among the top-100 list for a career stat, or null. */
  allTimeRank(id: string, stat: string): { rank: number; value: number } | null {
    const list = this.data.leaders[stat];
    if (!list) return null;
    const i = list.findIndex(([pid]) => pid === id);
    if (i < 0) return null;
    // Ties share the better rank.
    let rank = i + 1;
    while (rank > 1 && list[rank - 2][1] === list[i][1]) rank--;
    return { rank, value: list[i][1] };
  }

  /** Other detailed players who shared a team-season with this player. */
  getRelatedPlayers(id: string): { playerId: string; teamId: string; years: number[] }[] {
    const me = this.data.players[id];
    if (!me) return [];
    const mine = new Set(me.seasons.flatMap((s) => s.teams.map((t) => `${t}-${s.year}`)));
    const out: { playerId: string; teamId: string; years: number[] }[] = [];
    for (const other of Object.values(this.data.players)) {
      if (other.id === id) continue;
      const shared = other.seasons.flatMap((s) => s.teams.filter((t) => mine.has(`${t}-${s.year}`)).map((t) => ({ t, y: s.year })));
      const byTeam = new Map<string, number[]>();
      for (const { t, y } of shared) byTeam.set(t, [...(byTeam.get(t) ?? []), y]);
      for (const [teamId, years] of byTeam) out.push({ playerId: other.id, teamId, years: years.sort((a, b) => a - b) });
    }
    return out;
  }

  /** Has an MLB debut on record (managers/executives without one are set aside). Independent of which stats were imported. */
  private playedCareer(id: string) {
    return !!this.byId.get(id)?.[4];
  }

  private yearsOf(id: string) {
    const r = this.byId.get(id);
    return r?.[4] ? `${r[4]}–${r[5] ?? ""}` : "no playing record";
  }

  /**
   * Resolve a player mentioned in free text. Card aliases (e.g. "griffey") and
   * full names from the whole Lahman index are both considered; the longest
   * match wins. Several different people at the longest match → ambiguous.
   * "Jr."/"Sr." pick the later/earlier debut among same-name players.
   */
  resolvePlayer(text: string): PlayerResolution {
    const t = normalizeName(text);
    let bestLen = 0;
    let ids = new Set<string>();
    let matched = "";
    const consider = (phrase: string, candidates: string[]) => {
      if (!t.includes(phrase)) return;
      if (phrase.length > bestLen) {
        bestLen = phrase.length;
        ids = new Set(candidates);
        matched = phrase.trim();
      } else if (phrase.length === bestLen) {
        for (const c of candidates) ids.add(c);
      }
    };
    for (const card of this.cards) for (const a of card.aliases) consider(normalizeName(a), [card.player.lahmanId]);
    for (const [name, list] of this.byFullName) if (name.trim().includes(" ")) consider(name, list);
    if (!ids.size) return { status: "not_found" };

    let list = [...ids];
    // Prefer people who actually played over same-name managers/executives (e.g. Cal Ripken Sr.).
    const players = list.filter((id) => this.playedCareer(id));
    if (players.length) list = players;
    if (list.length > 1) {
      const sorted = [...list].sort((a, b) => (this.byId.get(a)?.[4] ?? 0) - (this.byId.get(b)?.[4] ?? 0));
      if (/ (jr|junior) /.test(t) && sorted.length === 2) list = [sorted[1]];
      else if (/ (sr|senior) /.test(t) && sorted.length === 2) list = [sorted[0]];
    }
    if (list.length === 1) {
      const id = list[0];
      const via = this.cards.some((c) => c.player.lahmanId === id && c.aliases.some((a) => normalizeName(a).trim() === matched)) ? "card" : "index";
      return { status: "resolved", playerId: id, name: this.displayName(id), matched, via };
    }
    return {
      status: "ambiguous",
      matched,
      options: list.map((id) => ({ playerId: id, name: this.displayName(id), years: this.yearsOf(id) })),
    };
  }
}
