/**
 * Linking Marty's sample cards to real cards in the CardSight AI catalog.
 *
 * Each sample card gets a search hint (who, which year, which release, and the
 * printed card number where known). Matching is deterministic and strict:
 * the player name and year must agree, the release must agree when given,
 * and the card number decides between candidates. Anything less is reported
 * as "not found" rather than guessed. Pure: no network, no secrets.
 */

export interface LookupHint {
  /** Free-text query sent to CardSight's catalog search. */
  query: string;
  /** Words that must all appear in the card's name (lower-case). */
  nameWords: string[];
  /** Acceptable release years (inclusive). */
  years: [number, number];
  /** Words that must appear in the release name, e.g. ["topps", "traded"]. */
  release?: string[];
  /** Printed card number, when known. A matching number makes the link exact. */
  number?: string;
  /** Pin a CardSight card UUID once confirmed; skips the search. */
  id?: string;
}

/** Search hints for the sample cards. Card numbers are the well-known base-set numbers for these issues. */
export const LOOKUP: Record<string, LookupHint> = {
  "griffey-89": { query: "1989 Upper Deck Ken Griffey Jr.", nameWords: ["griffey"], years: [1989, 1989], release: ["upper", "deck"], number: "1" },
  "henderson-80": { query: "1980 Topps Rickey Henderson", nameWords: ["rickey", "henderson"], years: [1980, 1980], release: ["topps"], number: "482" },
  "bobby-bonds-69": { query: "1969 Topps Bobby Bonds", nameWords: ["bobby", "bonds"], years: [1969, 1969], release: ["topps"], number: "630" },
  "barry-bonds-87": { query: "1987 Topps Barry Bonds", nameWords: ["barry", "bonds"], years: [1987, 1987], release: ["topps"], number: "320" },
  "ripken-82": { query: "1982 Topps Traded Cal Ripken", nameWords: ["ripken"], years: [1982, 1982], release: ["topps", "traded"], number: "98T" },
  "aaron-54": { query: "1954 Topps Hank Aaron", nameWords: ["aaron"], years: [1954, 1954], release: ["topps"], number: "128" },
  "robinson-52": { query: "1952 Topps Jackie Robinson", nameWords: ["jackie", "robinson"], years: [1952, 1952], release: ["topps"], number: "312" },
  "ichiro-01": { query: "2001 Topps Ichiro", nameWords: ["ichiro"], years: [2001, 2001], release: ["topps"], number: "726" },
  "mantle-52": { query: "1952 Topps Mickey Mantle", nameWords: ["mickey", "mantle"], years: [1952, 1952], release: ["topps"], number: "311" },
  "rose-63": { query: "1963 Topps Pete Rose", nameWords: ["pete", "rose"], years: [1963, 1963], release: ["topps"], number: "537" },
  "wagner-t206": { query: "T206 Honus Wagner", nameWords: ["wagner"], years: [1909, 1911], release: ["t206"] },
};

/** One card result from CardSight's catalog search (the fields we use). */
export interface SearchHit {
  type?: string;
  id: string;
  name: string;
  year?: string;
  setName?: string;
  releaseName?: string;
  manufacturerName?: string;
  parallelName?: string;
  cardNumber?: string;
  relevance?: number;
}

export interface MatchResult {
  hit: SearchHit;
  /** exact: name, year, release and card number all agree. likely: everything but the number could be checked. */
  confidence: "exact" | "likely";
  reasons: string[];
}

const norm = (s: string | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normNumber = (s: string | undefined) => norm(s).replace(/\s+/g, "").replace(/^#/, "");

/** Year of a hit: its year field, else the first year in its release name ("1989 Upper Deck"). */
export function hitYear(h: SearchHit): number | null {
  const y = Number.parseInt(h.year ?? "", 10);
  if (Number.isFinite(y)) return y;
  const m = /\b(18[6-9]\d|19\d\d|20\d\d)\b/.exec(`${h.releaseName ?? ""} ${h.setName ?? ""}`);
  return m ? Number(m[1]) : null;
}

/** Why a search hit is not this card, or null when it passes every check (number aside). */
export function rejectReason(hint: LookupHint, h: SearchHit): string | null {
  if (h.type && h.type !== "card") return `is a ${h.type}, not a card`;
  const name = ` ${norm(h.name)} `;
  const missing = hint.nameWords.filter((w) => !name.includes(` ${w} `));
  if (missing.length) return `name "${h.name}" lacks "${missing.join(" ")}"`;
  const year = hitYear(h);
  if (year === null) return "no year";
  if (year < hint.years[0] || year > hint.years[1]) return `year ${year}, wanted ${hint.years[0] === hint.years[1] ? hint.years[0] : hint.years.join("–")}`;
  if (hint.release) {
    const rel = ` ${norm(`${h.releaseName ?? ""} ${h.manufacturerName ?? ""} ${h.setName ?? ""}`)} `;
    const lacking = hint.release.filter((w) => !(rel.includes(` ${w} `) || rel.replace(/ /g, "").includes(w)));
    if (lacking.length) return `release "${[h.releaseName, h.setName].filter(Boolean).join(" / ")}" lacks "${lacking.join(" ")}"`;
  }
  if (h.parallelName) return `parallel (${h.parallelName}), not the base card`;
  return null;
}

/** Pick the catalog card that matches the hint, or null when nothing is certain enough. */
export function pickMatch(hint: LookupHint, hits: SearchHit[]): MatchResult | null {
  const ok = hits.filter((h) => rejectReason(hint, h) === null);
  if (!ok.length) return null;

  const byNumber = hint.number ? ok.filter((h) => normNumber(h.cardNumber) === normNumber(hint.number)) : [];
  if (byNumber.length) {
    const best = [...byNumber].sort(rank)[0];
    return { hit: best, confidence: "exact", reasons: [`name, year, release and card #${hint.number} match`] };
  }
  // Same digits, different prefix/suffix ("98" vs "98T"): close, but say so.
  const digits = (x: string | undefined) => (x ?? "").replace(/\D/g, "");
  const loose = hint.number ? ok.filter((h) => digits(h.cardNumber) && digits(h.cardNumber) === digits(hint.number)) : [];
  if (loose.length) {
    return { hit: [...loose].sort(rank)[0], confidence: "likely", reasons: [`name, year and release match; card number ${loose[0].cardNumber} is close to #${hint.number}`] };
  }
  // A known number that doesn't match anything means we may have the wrong card: don't guess.
  if (hint.number && ok.some((h) => h.cardNumber)) return null;
  const best = [...ok].sort(rank)[0];
  return { hit: best, confidence: "likely", reasons: ["name, year and release match; card number not available to confirm"] };
}

/** Searches to try, most specific first. The first that yields a match wins. */
export function searchPlan(hint: LookupHint): { q: string; years?: [number, number]; segment?: string }[] {
  const who = hint.query.replace(/\b(18|19|20)\d\d\b/g, "").replace(/\s+/g, " ").trim();
  const plans = [
    { q: hint.query, years: hint.years, segment: "Baseball" },
    { q: hint.query },
    { q: `${hint.years[0]} ${hint.nameWords.join(" ")}` },
    { q: who },
  ];
  const seen = new Set<string>();
  return plans.filter((p) => {
    const k = JSON.stringify(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Base set first, then CardSight's own relevance. */
function rank(a: SearchHit, b: SearchHit) {
  const base = (h: SearchHit) => (/^base\b/i.test(h.setName ?? "") ? 0 : 1);
  return base(a) - base(b) || (b.relevance ?? 0) - (a.relevance ?? 0);
}

/** Bump when matching rules change, so earlier "no match" results are looked up again. */
export const MATCHER_VERSION = 2;
