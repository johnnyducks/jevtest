/**
 * Lahman Baseball Database importer.
 *
 * Reads the standard Lahman / Baseball Databank CSV files and writes a compact
 * JSON knowledge store used by src/lib/baseball. Run with:
 *
 *   npm run import:lahman -- --src <folder with the CSVs> [--version "Lahman 2025"] [--players catalog|all|id,id]
 *
 * The folder may contain the CSVs directly or in core/ and contrib/
 * sub-folders (Baseball Databank layout). Only the tables Marty uses are read:
 * People, Batting, Pitching, BattingPost, AllstarFull, AwardsPlayers,
 * HallOfFame and Teams.
 *
 * Output: data/baseball/knowledge.json (override with --out).
 *  - `players`: full detail (seasons with league ranks, postseason, team
 *    seasons) for the selected players, by default the card catalog's players.
 *  - `index` / `careers`: a compact record for every player (career totals,
 *    awards, All-Star years, Hall of Fame) so any player can be looked up.
 *  - `leaders`: all-time top-100 lists for headline career stats.
 */
import fs from "node:fs";
import path from "node:path";

// ── CSV ────────────────────────────────────────────────────────────────────

/** Minimal RFC 4180 parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift()?.map((h) => h.replace(/^﻿/, "").trim()) ?? [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

function findFile(src: string, name: string): string | null {
  for (const p of [path.join(src, name), path.join(src, "core", name), path.join(src, "contrib", name)]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readTable(src: string, name: string, required = true): Record<string, string>[] {
  const f = findFile(src, name);
  if (!f) {
    if (required) throw new Error(`Missing ${name} in ${src}`);
    return [];
  }
  return parseCsv(fs.readFileSync(f, "utf8"));
}

/** Numeric field; missing / blank values stay null rather than becoming 0. */
const num = (v: string | undefined): number | null => (v === undefined || v === "" || v === "NA" ? null : Number(v));
const n0 = (v: string | undefined) => num(v) ?? 0;

// ── Output types (shared with src/lib/baseball/store.ts) ─────────────────────

export const BAT_KEYS = ["G", "AB", "R", "H", "2B", "3B", "HR", "RBI", "SB", "CS", "BB", "SO", "HBP", "SF", "SH"] as const;
export const PIT_KEYS = ["W", "L", "G", "GS", "SV", "IPouts", "H", "ER", "BB", "SO", "SHO", "CG"] as const;
/** League-rank stats computed for every detailed season. */
export const RANK_BAT = ["HR", "H", "RBI", "SB", "R", "BB", "AVG"] as const;
export const RANK_PIT = ["W", "SO", "SV", "ERA"] as const;
/** All-time leader lists. */
export const LEADER_BAT = ["HR", "H", "SB", "R", "RBI", "BB", "G"] as const;
export const LEADER_PIT = ["W", "SO", "SV"] as const;

export interface ImportOptions {
  /** "catalog" (default list passed in), "all", or explicit player IDs. */
  players: string[] | "all";
  version: string;
  source: string;
  url: string;
}

type Stat = Record<string, number>;

function addInto(target: Stat, row: Record<string, string>, keys: readonly string[]) {
  for (const k of keys) target[k] = (target[k] ?? 0) + n0(row[k]);
}

export function importLahman(src: string, opts: ImportOptions) {
  const people = readTable(src, "People.csv", false).length ? readTable(src, "People.csv") : readTable(src, "Master.csv");
  const batting = readTable(src, "Batting.csv");
  const pitching = readTable(src, "Pitching.csv", false);
  const battingPost = readTable(src, "BattingPost.csv", false);
  const allstar = readTable(src, "AllstarFull.csv", false);
  const awards = readTable(src, "AwardsPlayers.csv", false);
  const hof = readTable(src, "HallOfFame.csv", false);
  const teams = readTable(src, "Teams.csv", false);

  const byId = new Map(people.map((p) => [p.playerID, p]));
  const selected = opts.players === "all" ? [...byId.keys()] : opts.players;
  const missing = selected.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`Player IDs not found in People.csv: ${missing.join(", ")}`);
  const sel = new Set(selected);
  const seasonsThrough = batting.reduce((m, r) => Math.max(m, n0(r.yearID)), 0);

  // Per player-season-league aggregates (stints summed), for league ranks.
  const batPL = new Map<string, Stat & { year: number }>();
  for (const r of batting) {
    const key = `${r.playerID}|${r.yearID}|${r.lgID}`;
    const s = batPL.get(key) ?? ({ year: n0(r.yearID) } as Stat & { year: number });
    addInto(s, r, BAT_KEYS);
    batPL.set(key, s);
  }
  const pitPL = new Map<string, Stat & { year: number }>();
  for (const r of pitching) {
    const key = `${r.playerID}|${r.yearID}|${r.lgID}`;
    const s = pitPL.get(key) ?? ({ year: n0(r.yearID) } as Stat & { year: number });
    addInto(s, r, PIT_KEYS);
    pitPL.set(key, s);
  }
  // Team games per league-year, for batting-title / ERA-title qualification.
  const teamG = new Map<string, number>();
  for (const t of teams) teamG.set(`${t.yearID}|${t.lgID}`, Math.max(teamG.get(`${t.yearID}|${t.lgID}`) ?? 0, n0(t.G)));

  const leagueRank = (map: Map<string, Stat>, year: string, lg: string, stat: string, value: (s: Stat) => number | null, desc = true) => {
    const vals: { id: string; v: number }[] = [];
    for (const [k, s] of map) {
      const [id, y, l] = k.split("|");
      if (y !== year || l !== lg) continue;
      const v = value(s);
      if (v !== null) vals.push({ id, v });
    }
    vals.sort((a, b) => (desc ? b.v - a.v : a.v - b.v));
    const ranks = new Map<string, number>();
    vals.forEach((x, i) => ranks.set(x.id, i > 0 && vals[i - 1].v === x.v ? ranks.get(vals[i - 1].id)! : i + 1));
    return ranks;
  };

  const pa = (s: Stat) => s.AB + s.BB + s.HBP + s.SF + s.SH;
  const avgQualified = (year: string, lg: string) => (s: Stat) => {
    const g = teamG.get(`${year}|${lg}`) ?? 154;
    return pa(s) >= 3.1 * g && s.AB > 0 ? s.H / s.AB : null;
  };
  const eraQualified = (year: string, lg: string) => (s: Stat) => {
    const g = teamG.get(`${year}|${lg}`) ?? 154;
    return s.IPouts / 3 >= g && s.IPouts > 0 ? (s.ER * 27) / s.IPouts : null;
  };

  // Rank cache per league-year/stat so "all" imports stay fast enough.
  const rankCache = new Map<string, Map<string, number>>();
  const rankOf = (kind: "bat" | "pit", id: string, year: string, lg: string, stat: string) => {
    const key = `${kind}|${year}|${lg}|${stat}`;
    let ranks = rankCache.get(key);
    if (!ranks) {
      ranks =
        kind === "bat"
          ? leagueRank(batPL, year, lg, stat, stat === "AVG" ? avgQualified(year, lg) : (s) => s[stat])
          : leagueRank(pitPL, year, lg, stat, stat === "ERA" ? eraQualified(year, lg) : (s) => s[stat], stat !== "ERA");
      rankCache.set(key, ranks);
    }
    return ranks.get(id) ?? null;
  };

  // ── Detailed players ──
  const teamSeasons: Record<string, unknown> = {};
  const teamKey = (t: string, y: string | number) => `${t}-${y}`;
  const teamRow = new Map(teams.map((t) => [teamKey(t.teamID, t.yearID), t]));

  const players: Record<string, unknown> = {};
  for (const id of selected) {
    const p = byId.get(id)!;
    const birthYear = num(p.birthYear);
    const seasons = new Map<number, { year: number; teams: string[]; lg: string[]; bat: Stat; pit: Stat | null; ranks: Record<string, number> }>();
    for (const r of batting.filter((b) => b.playerID === id)) {
      const y = n0(r.yearID);
      const s = seasons.get(y) ?? { year: y, teams: [], lg: [], bat: {}, pit: null, ranks: {} };
      addInto(s.bat, r, BAT_KEYS);
      if (!s.teams.includes(r.teamID)) s.teams.push(r.teamID);
      if (!s.lg.includes(r.lgID)) s.lg.push(r.lgID);
      seasons.set(y, s);
    }
    for (const r of pitching.filter((b) => b.playerID === id)) {
      const y = n0(r.yearID);
      const s = seasons.get(y) ?? { year: y, teams: [r.teamID], lg: [r.lgID], bat: {}, pit: null, ranks: {} };
      s.pit = s.pit ?? {};
      addInto(s.pit, r, PIT_KEYS);
      seasons.set(y, s);
    }
    for (const s of seasons.values()) {
      if (s.lg.length === 1) {
        const lg = s.lg[0];
        for (const st of RANK_BAT) {
          if (st === "AVG" || (s.bat[st] ?? 0) > 0) {
            const rk = rankOf("bat", id, String(s.year), lg, st);
            if (rk !== null && rk <= 10) s.ranks[st] = rk;
          }
        }
        if (s.pit && s.pit.IPouts > 0) {
          for (const st of RANK_PIT) {
            const rk = rankOf("pit", id, String(s.year), lg, st);
            if (rk !== null && rk <= 10) s.ranks[`P_${st}`] = rk;
          }
        }
      }
      for (const t of s.teams) {
        const tr = teamRow.get(teamKey(t, s.year));
        if (tr && !teamSeasons[teamKey(t, s.year)]) {
          teamSeasons[teamKey(t, s.year)] = {
            teamID: t,
            year: s.year,
            name: tr.name,
            lg: tr.lgID,
            div: tr.divID || null,
            rank: num(tr.Rank),
            G: num(tr.G),
            W: num(tr.W),
            L: num(tr.L),
            divWin: tr.DivWin === "Y",
            wcWin: tr.WCWin === "Y",
            lgWin: tr.LgWin === "Y",
            wsWin: tr.WSWin === "Y",
            park: tr.park || null,
            attendance: num(tr.attendance),
          };
        }
      }
    }
    const post: Record<string, Stat & { year: number; round: string }> = {};
    for (const r of battingPost.filter((b) => b.playerID === id)) {
      const k = `${r.yearID}-${r.round}`;
      post[k] = post[k] ?? ({ year: n0(r.yearID), round: r.round } as Stat & { year: number; round: string });
      addInto(post[k], r, ["G", "AB", "H", "HR", "RBI", "SB", "R", "BB"]);
    }
    players[id] = {
      id,
      name: { first: p.nameFirst, last: p.nameLast, given: p.nameGiven },
      bio: {
        birth: { year: birthYear, month: num(p.birthMonth), day: num(p.birthDay), city: p.birthCity || null, state: p.birthState || null, country: p.birthCountry || null },
        death: p.deathYear ? { year: num(p.deathYear), month: num(p.deathMonth), day: num(p.deathDay) } : null,
        bats: p.bats || null,
        throws: p.throws || null,
        height: num(p.height),
        weight: num(p.weight),
        debut: p.debut || null,
        finalGame: p.finalGame || null,
      },
      bbrefID: p.bbrefID || null,
      seasons: [...seasons.values()]
        .sort((a, b) => a.year - b.year)
        .map((s) => ({ ...s, age: birthYear ? s.year - birthYear : null })),
      postseason: Object.values(post).sort((a, b) => a.year - b.year),
    };
  }

  // ── Compact career index for every player ──
  const careerBat = new Map<string, Stat>();
  for (const r of batting) addInto(careerBat.get(r.playerID) ?? careerBat.set(r.playerID, {}).get(r.playerID)!, r, BAT_KEYS);
  const careerPit = new Map<string, Stat>();
  for (const r of pitching) addInto(careerPit.get(r.playerID) ?? careerPit.set(r.playerID, {}).get(r.playerID)!, r, PIT_KEYS);

  const awardsBy: Record<string, [string, number, string, string][]> = {};
  for (const a of awards) (awardsBy[a.playerID] ??= []).push([a.awardID, n0(a.yearID), a.lgID, a.notes || ""]);
  const allstarBy: Record<string, number[]> = {};
  for (const a of allstar) {
    const ys = (allstarBy[a.playerID] ??= []);
    if (!ys.includes(n0(a.yearID))) ys.push(n0(a.yearID));
  }
  const hofBy: Record<string, { year: number; votedBy: string; votes: number | null; ballots: number | null; category: string }> = {};
  for (const h of hof) {
    if (h.inducted === "Y") hofBy[h.playerID] = { year: n0(h.yearID), votedBy: h.votedBy, votes: num(h.votes), ballots: num(h.ballots), category: h.category };
  }

  const index: [string, string, string, number | null, number | null, number | null][] = [];
  // Career totals are stored as arrays in BAT_KEYS / PIT_KEYS order to keep the file small.
  const careers: Record<string, { b?: number[]; p?: number[]; aw?: unknown; as?: number[]; hof?: unknown }> = {};
  for (const p of people) {
    const debutY = p.debut ? Number(p.debut.slice(0, 4)) : null;
    const finalY = p.finalGame ? Number(p.finalGame.slice(0, 4)) : null;
    index.push([p.playerID, p.nameFirst, p.nameLast, num(p.birthYear), debutY, finalY]);
    const c: (typeof careers)[string] = {};
    const b = careerBat.get(p.playerID);
    if (b && b.G > 0) c.b = BAT_KEYS.map((k) => b[k] ?? 0);
    const pt = careerPit.get(p.playerID);
    if (pt && pt.G > 0) c.p = PIT_KEYS.map((k) => pt[k] ?? 0);
    if (awardsBy[p.playerID]) c.aw = awardsBy[p.playerID];
    if (allstarBy[p.playerID]) c.as = allstarBy[p.playerID].sort((a, b) => a - b);
    if (hofBy[p.playerID]) c.hof = hofBy[p.playerID];
    if (Object.keys(c).length) careers[p.playerID] = c;
  }

  const top = (m: Map<string, Stat>, stat: string, n = 100) =>
    [...m.entries()]
      .map(([id, s]) => [id, s[stat] ?? 0] as [string, number])
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, n);
  const leaders: Record<string, [string, number][]> = {};
  for (const s of LEADER_BAT) leaders[s] = top(careerBat, s);
  for (const s of LEADER_PIT) leaders[`P_${s}`] = top(careerPit, s);

  return {
    meta: {
      dataset: "Lahman Baseball Database",
      version: opts.version,
      source: opts.source,
      url: opts.url,
      license: "CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/)",
      attribution:
        "Statistics from the Lahman Baseball Database (Sean Lahman / SABR), distributed via the Chadwick Baseball Bureau's Baseball Databank, licensed CC BY-SA 3.0. This derived file is shared under the same license.",
      seasonsThrough,
      importedAt: new Date().toISOString(),
      detailedPlayers: selected.length,
      indexedPlayers: index.length,
    },
    players,
    teams: teamSeasons,
    index,
    careers,
    leaders,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const src = arg("src");
  if (!src) {
    console.error("Usage: npm run import:lahman -- --src <csv folder> [--version <label>] [--players catalog|all|id,id] [--out <file>]");
    process.exit(1);
  }
  const playersArg = arg("players") ?? "catalog";
  let players: string[] | "all";
  if (playersArg === "all") players = "all";
  else if (playersArg === "catalog") {
    const { ENVIRONMENT } = await import("../src/lib/twin/environment.ts");
    players = [...new Set(ENVIRONMENT.cards.map((c) => c.player.lahmanId))];
  } else players = playersArg.split(",").map((s) => s.trim());

  const out = arg("out") ?? path.join(process.cwd(), "data/baseball/knowledge.json");
  const data = importLahman(src, {
    players,
    version: arg("version") ?? "unspecified",
    source: arg("source") ?? "Lahman Baseball Database CSV release",
    url: arg("url") ?? "https://sabr.org/lahman-database/",
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data));
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`Wrote ${out} (${kb} KB): ${data.meta.detailedPlayers} detailed players, ${data.meta.indexedPlayers} indexed, seasons through ${data.meta.seasonsThrough}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
