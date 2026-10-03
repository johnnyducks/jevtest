/**
 * Fact generation and selection.
 *
 * Every fact is a deterministic sentence built from the Lahman data (or a
 * cited Wikipedia summary), with its source attached. The voice narrates these;
 * it never supplies numbers of its own.
 */
import type { Card } from "../twin/environment.ts";
import type { KnowledgeStore } from "./store.ts";
import type { Fact, FactKind, FactSource } from "./types.ts";

const STAT_LABEL: Record<string, string> = {
  HR: "home runs",
  H: "hits",
  SB: "stolen bases",
  R: "runs scored",
  RBI: "RBIs",
  BB: "walks",
  G: "games played",
  AVG: "batting average",
  P_W: "pitching wins",
  P_SO: "strikeouts",
  P_SV: "saves",
  P_ERA: "ERA",
};

/** Awards worth mentioning, with phrasing and base interest scores. Lists like "TSN All-Star" are skipped. */
const AWARDS: Record<string, { one: (lg: string) => string; many: string; score: number }> = {
  "Triple Crown": { one: () => "the Triple Crown", many: "Triple Crowns", score: 95 },
  "Pitching Triple Crown": { one: () => "the pitching Triple Crown", many: "pitching Triple Crowns", score: 92 },
  "Most Valuable Player": { one: (lg) => `the ${lg}MVP award`, many: "MVP awards", score: 86 },
  "Cy Young Award": { one: (lg) => `the ${lg}Cy Young Award`, many: "Cy Young Awards", score: 86 },
  "World Series MVP": { one: () => "World Series MVP", many: "World Series MVP awards", score: 78 },
  "Rookie of the Year": { one: (lg) => `${lg}Rookie of the Year`, many: "Rookie of the Year awards", score: 66 },
  "All-Star Game MVP": { one: () => "All-Star Game MVP", many: "All-Star Game MVP awards", score: 62 },
  "Gold Glove": { one: () => "a Gold Glove", many: "Gold Gloves", score: 68 },
  "Silver Slugger": { one: () => "a Silver Slugger", many: "Silver Sluggers", score: 54 },
  "Comeback Player of the Year": { one: () => "Comeback Player of the Year", many: "Comeback Player of the Year awards", score: 58 },
  "Roberto Clemente Award": { one: () => "the Roberto Clemente Award", many: "Roberto Clemente Awards", score: 60 },
};

const fmt = (n: number) => n.toLocaleString("en-US");
const avg = (h: number, ab: number) => (ab > 0 ? (h / ab).toFixed(3).replace(/^0/, "") : "—");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function yearsList(ys: number[]): string {
  const sorted = [...new Set(ys)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return parts.join(", ");
}

export interface FactContext {
  card?: Card;
  /** Season the conversation is about, if any. */
  year?: number;
}

/** Build every fact we can support for a player, scored for interest and relevance. */
export function buildFacts(store: KnowledgeStore, playerId: string, ctx: FactContext = {}): Fact[] {
  const career = store.getCareer(playerId);
  if (!career) return [];
  const meta = store.meta;
  const src: FactSource = { name: "Lahman Baseball Database", url: meta.url, version: meta.version, license: meta.license };
  const name = career.name;
  const facts: Fact[] = [];
  const add = (kind: FactKind, key: string, text: string, score: number, extra: Partial<Fact> = {}) =>
    facts.push({ id: `${playerId}:${kind}:${key}`, kind, subject: { playerId, name }, text, score, verification: "dataset", source: src, ...extra });

  // All-time ranks.
  for (const stat of ["HR", "H", "SB", "R", "RBI", "BB", "G", "P_W", "P_SO", "P_SV"]) {
    const r = store.allTimeRank(playerId, stat);
    if (!r || r.rank > 50) continue;
    const score = r.rank === 1 ? 97 : r.rank <= 5 ? 90 - r.rank : r.rank <= 10 ? 80 - r.rank : 62 - r.rank / 5;
    // Only qualify the rank with the data cut-off when the career might still be going.
    const asOf = career.finalYear && career.finalYear >= meta.seasonsThrough - 1 ? ` (as of ${meta.seasonsThrough})` : "";
    add("all_time_rank", stat, `${name} ranks #${r.rank} all-time in career ${STAT_LABEL[stat]}, with ${fmt(r.value)}${asOf}.`, score);
  }

  // Hall of Fame.
  if (career.hof) {
    const h = career.hof;
    const pct = h.votes && h.ballots ? (100 * h.votes) / h.ballots : null;
    add(
      "hall_of_fame",
      String(h.year),
      pct !== null
        ? `${name} was elected to the Hall of Fame in ${h.year} by the ${h.votedBy}, named on ${fmt(h.votes!)} of ${fmt(h.ballots!)} ballots (${pct.toFixed(1)}%).`
        : `${name} was inducted into the Hall of Fame in ${h.year} (${h.votedBy}).`,
      pct !== null && pct >= 98 ? 91 : 78,
      { season: h.year },
    );
  }

  // Awards, grouped by award.
  const grouped = new Map<string, { year: number; lg: string }[]>();
  for (const a of career.awards) if (AWARDS[a.award]) grouped.set(a.award, [...(grouped.get(a.award) ?? []), a]);
  for (const [award, list] of grouped) {
    const info = AWARDS[award];
    const years = list.map((a) => a.year);
    const lg = [...new Set(list.map((a) => a.lg))].filter((l) => l === "AL" || l === "NL").join("/");
    const lgPrefix = lg ? `${lg} ` : "";
    const text = list.length === 1 ? `${name} won ${info.one(lgPrefix)} in ${years[0]}.` : `${name} won ${list.length} ${info.many} (${yearsList(years)}).`;
    add("award", award, text, info.score + Math.min(8, list.length - 1), { season: list.length === 1 ? years[0] : undefined });
  }

  // All-Star selections.
  if (career.allStar.length >= 2) {
    add("all_star", "count", `${name} was picked for ${career.allStar.length} All-Star seasons (${yearsList(career.allStar)}).`, 52 + Math.min(10, career.allStar.length));
  }

  // Career line.
  if (career.bat && career.bat.AB > 500) {
    const b = career.bat;
    const span = career.debutYear && career.finalYear ? ` over ${career.finalYear - career.debutYear + 1} seasons (${career.debutYear}–${career.finalYear})` : "";
    add("career", "batting", `${name}'s career: ${fmt(b.H)} hits, ${fmt(b.HR)} home runs, ${fmt(b.SB)} stolen bases and a ${avg(b.H, b.AB)} average${span}.`, 48);
  }
  if (career.pit && career.pit.IPouts > 300) {
    const p = career.pit;
    add("career", "pitching", `${name}'s pitching career: ${p.W}–${p.L}, ${fmt(p.SO)} strikeouts, ${((p.ER * 27) / p.IPouts).toFixed(2)} ERA over ${fmt(Math.round(p.IPouts / 3))} innings.`, 50);
  }

  // Detailed-season facts (catalog players).
  const prof = store.getPlayerProfile(playerId);
  if (prof) {
    for (const s of prof.seasons) {
      const lg = s.lg.length === 1 ? s.lg[0] : null;
      for (const [stat, rank] of Object.entries(s.ranks)) {
        if (rank !== 1 || !lg || stat === "P_ERA") continue;
        const value = stat === "AVG" ? avg(s.bat.H, s.bat.AB) : stat.startsWith("P_") ? s.pit?.[stat.slice(2)] : s.bat[stat];
        add("league_lead", `${s.year}-${stat}`, `${name} led the ${lg} in ${STAT_LABEL[stat]} in ${s.year}${value !== undefined ? ` (${stat === "AVG" ? value : fmt(Number(value))})` : ""}.`, 72 + (stat === "HR" ? 4 : stat === "SB" ? 3 : 0), {
          season: s.year,
        });
      }
    }
    const bestHr = [...prof.seasons].sort((a, b) => (b.bat.HR ?? 0) - (a.bat.HR ?? 0) || a.year - b.year)[0];
    if (bestHr && (bestHr.bat.HR ?? 0) >= 20) {
      const ties = prof.seasons.filter((s) => s.bat.HR === bestHr.bat.HR).map((s) => s.year);
      add("peak_season", "HR", `${name}'s single-season high was ${bestHr.bat.HR} home runs (${ties.join(" and ")}).`, 60, { season: bestHr.year });
    }
    const bestSb = [...prof.seasons].sort((a, b) => (b.bat.SB ?? 0) - (a.bat.SB ?? 0))[0];
    if (bestSb && (bestSb.bat.SB ?? 0) >= 50) add("peak_season", "SB", `${name} stole ${bestSb.bat.SB} bases in ${bestSb.year}, his single-season high.`, 70, { season: bestSb.year });

    const post = prof.postseason.reduce((a, p) => ({ G: a.G + p.G, H: a.H + p.H, HR: a.HR + p.HR, AB: a.AB + p.AB }), { G: 0, H: 0, HR: 0, AB: 0 });
    if (post.G >= 5) add("postseason", "totals", `${name} played ${post.G} postseason games, batting ${avg(post.H, post.AB)} with ${post.HR} home run${post.HR === 1 ? "" : "s"}.`, post.HR >= 5 ? 56 : 44);

    if (prof.bio.debut) {
      const [y, m, d] = prof.bio.debut.split("-").map(Number);
      const age = prof.bio.birth.year ? y - prof.bio.birth.year - ((prof.bio.birth.month ?? 1) > m || ((prof.bio.birth.month ?? 1) === m && (prof.bio.birth.day ?? 1) > d) ? 1 : 0) : null;
      add("debut", "debut", `${name} debuted in the majors on ${MONTHS[m - 1]} ${d}, ${y}${age !== null ? `, at age ${age}` : ""}.`, age !== null && age <= 20 ? 58 : 40, { season: y });
    }
    const b = prof.bio.birth;
    if (b.city) add("bio", "birthplace", `${name} was born in ${b.city}${b.state && b.country === "USA" ? `, ${b.state}` : b.country && b.country !== "USA" ? `, ${b.country}` : ""}${b.year ? `, in ${b.year}` : ""}.`, 30);

    for (const rel of store.getRelatedPlayers(playerId)) {
      const team = store.getTeamSeason(rel.teamId, rel.years[0]);
      add(
        "connection",
        `${rel.playerId}-${rel.teamId}`,
        `${name} and ${store.displayName(rel.playerId)} were teammates on the ${team?.name ?? rel.teamId} (${yearsList(rel.years)}); both have cards in this room.`,
        76,
        { season: rel.years[0] },
      );
    }

    // Card-specific: the season of the card's issue year, and that team's season.
    if (ctx.card && ctx.card.player.lahmanId === playerId) {
      const y = ctx.card.meta.issueYear;
      const s = store.getPlayerSeason(playerId, y);
      if (s) {
        const team = store.getTeamSeason(s.teams[0], y);
        const rookie = prof.bio.debut?.startsWith(String(y)) ? " It was his rookie season." : "";
        const line = s.bat.AB > 0 ? `hit ${avg(s.bat.H, s.bat.AB)} with ${s.bat.HR} home runs and ${s.bat.SB} steals in ${s.bat.G} games` : `appeared in ${s.bat.G ?? s.pit?.G ?? 0} games`;
        const age = seasonAge(prof.bio.birth, y);
        add(
          "card_season",
          String(y),
          `In ${y}, the year this card was issued, ${name} ${line}${team ? ` for the ${team.name}` : ""}${age !== null ? `, at age ${age}` : ""}.${rookie}`,
          88,
          { season: y },
        );
        if (team && team.W !== null && team.L !== null) {
          const finish = team.wsWin
            ? " and won the World Series"
            : team.lgWin
              ? ` and won the ${team.lg} pennant`
              : team.divWin
                ? " and won their division"
                : team.rank
                  ? `, finishing ${ordinal(team.rank)} in the ${team.lg}${team.div ? ` ${team.div === "W" ? "West" : team.div === "E" ? "East" : "Central"}` : ""}`
                  : "";
          add("card_team", `${team.teamID}-${y}`, `The ${y} ${team.name} went ${team.W}–${team.L}${finish}.`, team.wsWin ? 84 : team.lgWin ? 74 : 58, {
            season: y,
            subject: { playerId, name, teamId: team.teamID },
          });
        }
      }
    }
    // A season the conversation asked about.
    if (ctx.year) {
      const s = store.getPlayerSeason(playerId, ctx.year);
      if (s && s.bat.AB > 0) {
        // Asked about a specific season: that answer leads.
        add("season", String(ctx.year), `In ${ctx.year}, ${name} hit ${avg(s.bat.H, s.bat.AB)} with ${s.bat.HR} home runs, ${s.bat.RBI} RBIs and ${s.bat.SB} steals in ${s.bat.G} games.`, 99, {
          season: ctx.year,
        });
      }
    }
  }

  // Card-relevance bonus: facts about the card's year or team.
  if (ctx.card) {
    for (const f of facts) if (f.season === ctx.card.meta.issueYear && f.kind !== "card_season" && f.kind !== "card_team") f.score += 8;
  }
  return facts;
}

/** Baseball season age: age on June 30 of that season. */
function seasonAge(birth: { year: number | null; month: number | null }, year: number): number | null {
  if (!birth.year) return null;
  return year - birth.year - ((birth.month ?? 1) > 6 ? 1 : 0);
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export interface SelectOptions {
  /** Fact ids already shared this session. */
  exclude?: Iterable<string>;
  /** Kinds used recently for this player; penalised to keep variety. */
  recentKinds?: string[];
  limit?: number;
}

/**
 * Pick the most interesting facts not yet shared, favouring variety.
 * Deterministic: score, then a stable id tie-break.
 */
export function selectFacts(facts: Fact[], opts: SelectOptions = {}): Fact[] {
  const exclude = new Set(opts.exclude ?? []);
  const recent = new Set(opts.recentKinds ?? []);
  const pool = facts
    .filter((f) => !exclude.has(f.id))
    .map((f) => ({ f, s: f.score - (recent.has(f.kind) ? 25 : 0) }))
    .sort((a, b) => b.s - a.s || a.f.id.localeCompare(b.f.id));
  const out: Fact[] = [];
  const kinds = new Set<string>();
  for (const { f } of pool) {
    if (out.length >= (opts.limit ?? 1)) break;
    if (kinds.has(f.kind) && pool.length > (opts.limit ?? 1)) continue; // one per kind when we can afford it
    out.push(f);
    kinds.add(f.kind);
  }
  return out;
}
