/**
 * Baseball knowledge types. Every fact carries its source so the UI can
 * attribute it and the voice can never present an unsourced claim as verified.
 */

export interface FactSource {
  name: "Lahman Baseball Database" | "Wikipedia";
  url: string;
  /** Dataset release label, or Wikipedia revision id. */
  version: string;
  license: string;
  retrievedAt?: string;
}

export type FactKind =
  | "all_time_rank"
  | "hall_of_fame"
  | "award"
  | "all_star"
  | "league_lead"
  | "peak_season"
  | "card_season"
  | "card_team"
  | "postseason"
  | "connection"
  | "debut"
  | "bio"
  | "career"
  | "season"
  | "wiki";

export interface Fact {
  /** Stable id, used to avoid repeating the same fact. */
  id: string;
  kind: FactKind;
  subject: { playerId: string; name: string; teamId?: string };
  /** Self-contained, deterministic sentence. Numbers come straight from the data. */
  text: string;
  season?: number;
  /** Relevance/interest score used for selection (higher is better). */
  score: number;
  /** "dataset": computed from Lahman. "sourced": quoted/summarized from a cited article, not independently verified. */
  verification: "dataset" | "sourced";
  source: FactSource;
}

/** Raw shape of data/baseball/knowledge.json (written by scripts/import-lahman.ts). */
export interface KnowledgeData {
  meta: {
    dataset: string;
    version: string;
    source: string;
    url: string;
    license: string;
    attribution: string;
    seasonsThrough: number;
    importedAt: string;
  };
  players: Record<string, DetailedPlayer>;
  teams: Record<string, TeamSeason>;
  /** [playerID, first, last, birthYear, debutYear, finalYear] */
  index: [string, string, string, number | null, number | null, number | null][];
  /** b: BAT_KEYS order, p: PIT_KEYS order, aw: [award, year, lg, notes], as: all-star years */
  careers: Record<string, { b?: number[]; p?: number[]; aw?: [string, number, string, string][]; as?: number[]; hof?: HallOfFame }>;
  leaders: Record<string, [string, number][]>;
}

export interface HallOfFame {
  year: number;
  votedBy: string;
  votes: number | null;
  ballots: number | null;
  category: string;
}

export interface DetailedSeason {
  year: number;
  age: number | null;
  teams: string[];
  lg: string[];
  bat: Record<string, number>;
  pit: Record<string, number> | null;
  /** League rank (top 10 only) for HR, H, RBI, SB, R, BB, AVG; P_W, P_SO, P_SV, P_ERA for pitching. */
  ranks: Record<string, number>;
}

export interface DetailedPlayer {
  id: string;
  name: { first: string; last: string; given: string };
  bio: {
    birth: { year: number | null; month: number | null; day: number | null; city: string | null; state: string | null; country: string | null };
    death: { year: number | null; month: number | null; day: number | null } | null;
    bats: string | null;
    throws: string | null;
    height: number | null;
    weight: number | null;
    debut: string | null;
    finalGame: string | null;
  };
  bbrefID: string | null;
  seasons: DetailedSeason[];
  postseason: { year: number; round: string; G: number; AB: number; H: number; HR: number; RBI: number; SB: number; R: number; BB: number }[];
}

export interface TeamSeason {
  teamID: string;
  year: number;
  name: string;
  lg: string;
  div: string | null;
  rank: number | null;
  G: number | null;
  W: number | null;
  L: number | null;
  divWin: boolean;
  wcWin: boolean;
  lgWin: boolean;
  wsWin: boolean;
  park: string | null;
  attendance: number | null;
}

export type PlayerResolution =
  | { status: "resolved"; playerId: string; name: string; matched: string; via: "card" | "index" }
  | { status: "ambiguous"; options: { playerId: string; name: string; years: string }[]; matched: string }
  | { status: "not_found" };
