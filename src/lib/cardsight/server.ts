/**
 * Card artwork service. SERVER ONLY.
 *
 * Links each sample card to a CardSight catalog card once, remembers the link
 * in data/cardsight/matches.json (so the search runs once, not per viewer),
 * and caches downloaded images in .cache/cardsight/. Images you add yourself
 * in public/cards/ (e.g. mantle-52-back.jpg) take priority, and are the only
 * source of card backs: CardSight provides fronts only.
 */
import fs from "node:fs";
import path from "node:path";
import { ENVIRONMENT } from "../twin/environment";
import { CardSightError, cardsightConfig, getCard, getCardImage, searchCards } from "./client";
import { identityOf } from "../catalog/catalog";
import { ensureCatalog } from "../catalog/server";
import { dataFile } from "../datadir";
import { hintFor, type LookupHint, MATCHER_VERSION, pickMatch, rejectReason, type SearchHit, searchPlan } from "./match";
import type { CardArt, CardArtBody } from "./types";

interface StoredMatch {
  status: "matched" | "not_found";
  confidence?: "exact" | "likely";
  cardsight?: CardArt["cardsight"];
  reasons?: string[];
  matchedAt: string;
  /** Matching rules version that produced this entry. */
  version?: number;
  /** The card's identifying fields when it was matched; an edit in the catalog triggers a new lookup. */
  identity?: string;
}

/** What happened for one card, for the "Check card images" screen. */
export interface CardDiagnosis {
  cardId: string;
  name: string;
  outcome: string;
  searches: { q: string; filters: string; results: number; error?: string }[];
  /** Closest catalog results and why each was or wasn't accepted. */
  candidates: { name: string; year?: string; release?: string; set?: string; number?: string; verdict: string }[];
  image?: { ok: boolean; detail: string };
}

const MATCHES = () => dataFile("cardsight-matches.json");
const IMAGE_DIR = () => path.join(process.cwd(), ".cache", "cardsight");
const LOCAL_DIR = () => path.join(process.cwd(), "public", "cards");
const EXTS = ["jpg", "jpeg", "png", "webp"];
const RETRY_NOT_FOUND_MS = 24 * 3600_000;
const RETRY_ERROR_MS = 60_000;

const g = globalThis as unknown as {
  __cardArt?: { stored: Record<string, StoredMatch>; inflight: Map<string, Promise<CardArt>>; errors: Map<string, { at: number; note: string }> };
};

function state() {
  if (!g.__cardArt) {
    let stored: Record<string, StoredMatch> = {};
    try {
      stored = (JSON.parse(fs.readFileSync(MATCHES(), "utf8")) as { cards?: Record<string, StoredMatch> }).cards ?? {};
    } catch {
      /* first run */
    }
    g.__cardArt = { stored, inflight: new Map(), errors: new Map() };
  }
  return g.__cardArt;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(MATCHES()), { recursive: true });
    const body = { note: "Links between Marty's sample cards and the CardSight AI catalog. Written by the app; safe to edit or delete.", cards: state().stored };
    fs.writeFileSync(MATCHES(), `${JSON.stringify(body, null, 2)}\n`);
  } catch (err) {
    console.warn("Could not save CardSight matches:", err instanceof Error ? err.message : err);
  }
}

/** An image you added yourself: public/cards/<cardId>-front.jpg / -back.png etc. */
function localImage(cardId: string, side: "front" | "back"): string | null {
  for (const ext of EXTS) {
    const file = `${cardId}-${side}.${ext}`;
    if (fs.existsSync(path.join(LOCAL_DIR(), file))) return `/cards/${file}`;
  }
  return null;
}

interface Attempt {
  match: StoredMatch;
  searches: CardDiagnosis["searches"];
  hits: SearchHit[];
}

async function resolve(cardId: string): Promise<Attempt> {
  const now = () => new Date().toISOString();
  const card = ENVIRONMENT.cards.find((c) => c.id === cardId);
  const hint = card ? hintFor(card) : undefined;
  if (!hint) return { match: { status: "not_found", matchedAt: now(), reasons: ["no lookup hint for this card"], version: MATCHER_VERSION }, searches: [], hits: [] };
  if (hint.id) {
    const d = await getCard(hint.id);
    return {
      match: {
        status: "matched",
        confidence: "exact",
        cardsight: { id: d.id, name: d.name, number: d.number, setName: d.setName, releaseName: d.releaseName, year: d.releaseYear, description: d.description },
        reasons: ["pinned in lib/cardsight/match.ts"],
        matchedAt: now(),
        version: MATCHER_VERSION,
      },
      searches: [],
      hits: [],
    };
  }
  const searches: CardDiagnosis["searches"] = [];
  const all: SearchHit[] = [];
  let lastError: unknown = null;
  for (const plan of searchPlan(hint)) {
    const filters = [plan.segment && `segment ${plan.segment}`, plan.years && `year ${plan.years[0] === plan.years[1] ? plan.years[0] : plan.years.join("–")}`].filter(Boolean).join(", ") || "none";
    let hits: SearchHit[];
    try {
      hits = await searchCards(plan.q, { years: plan.years, segment: plan.segment });
    } catch (e) {
      // A bad key or rate limit won't get better with another query.
      if (e instanceof CardSightError && (e.status === 401 || e.status === 403 || e.status === 429 || e.code === "not_configured")) throw e;
      lastError = e;
      searches.push({ q: plan.q, filters, results: 0, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    searches.push({ q: plan.q, filters, results: hits.length });
    for (const h of hits) if (!all.some((x) => x.id === h.id)) all.push(h);
    const m = pickMatch(hint, hits);
    if (!m) continue;
    let description: string | undefined;
    try {
      description = (await getCard(m.hit.id)).description;
    } catch {
      /* details are optional */
    }
    console.log(`CardSight: ${cardId} → ${m.hit.name} (${m.hit.releaseName ?? m.hit.year} #${m.hit.cardNumber ?? "?"}), ${m.confidence}, via "${plan.q}"`);
    return {
      match: {
        status: "matched",
        confidence: m.confidence,
        cardsight: { id: m.hit.id, name: m.hit.name, number: m.hit.cardNumber, setName: m.hit.setName, releaseName: m.hit.releaseName, year: m.hit.year, description },
        reasons: m.reasons,
        matchedAt: now(),
        version: MATCHER_VERSION,
      },
      searches,
      hits: all,
    };
  }
  if (lastError && !all.length) throw lastError;
  console.log(`CardSight: ${cardId} → no certain match (${all.length} results across ${searches.length} searches). Open "Check card images" in the bot menu for details.`);
  return { match: { status: "not_found", matchedAt: now(), reasons: [`no certain match among ${all.length} search results`], version: MATCHER_VERSION }, searches, hits: all };
}

function toArt(cardId: string, s: StoredMatch | undefined, note?: string): CardArt {
  const configured = cardsightConfig().configured;
  const localFront = localImage(cardId, "front");
  const localBack = localImage(cardId, "back");
  const matched = s?.status === "matched" && s.cardsight;
  const front = localFront ?? (matched ? `/api/cards/${cardId}/image` : null);
  return {
    cardId,
    status: matched ? "matched" : !configured ? "not_configured" : note ? "error" : "not_found",
    ...(matched ? { confidence: s.confidence, cardsight: s.cardsight } : {}),
    front,
    back: localBack,
    ...(front ? { frontSource: localFront ? "local" : "cardsight" } : {}),
    ...(localBack ? { backSource: "local" } : {}),
    note: note ?? (!configured && !matched ? "CARDSIGHT_API_KEY is not set." : s?.status === "not_found" ? "No certain match in the CardSight catalog." : undefined),
  };
}

const cardIdentity = (cardId: string) => {
  const c = ENVIRONMENT.cards.find((x) => x.id === cardId);
  return c ? identityOf({ name: c.name, year: c.year, set: c.meta.set, manufacturer: c.meta.manufacturer, number: c.meta.number, cardsightId: c.cardsightId }) : "";
};

async function artFor(cardId: string): Promise<CardArt> {
  const st = state();
  const stored = st.stored[cardId];
  // A saved result only counts if the card hasn't been edited since (same name, year, set, number…).
  const same = stored?.identity === cardIdentity(cardId);
  const fresh =
    stored && same && (stored.status === "matched" || (stored.version === MATCHER_VERSION && Date.now() - Date.parse(stored.matchedAt) < RETRY_NOT_FOUND_MS));
  if (fresh || !cardsightConfig().configured) return toArt(cardId, stored);
  const err = st.errors.get(cardId);
  if (err && Date.now() - err.at < RETRY_ERROR_MS) return toArt(cardId, stored, err.note);
  let p = st.inflight.get(cardId);
  if (!p) {
    p = resolve(cardId)
      .then(({ match: m }) => {
        st.stored[cardId] = { ...m, identity: cardIdentity(cardId) };
        st.errors.delete(cardId);
        save();
        return toArt(cardId, m);
      })
      .catch((e: unknown) => {
        const note = errorNote(e);
        console.warn(`CardSight lookup for ${cardId} failed: ${e instanceof Error ? e.message : e}`);
        st.errors.set(cardId, { at: Date.now(), note });
        return toArt(cardId, stored, note);
      })
      .finally(() => st.inflight.delete(cardId));
    st.inflight.set(cardId, p);
  }
  return p;
}

/** Artwork for every card in the room. Looks cards up a few at a time (gentle on the API). */
export async function allCardArt(): Promise<CardArtBody> {
  ensureCatalog();
  const cards: Record<string, CardArt> = {};
  const ids = ENVIRONMENT.cards.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 3) {
    const batch = await Promise.all(ids.slice(i, i + 3).map(artFor));
    for (const a of batch) cards[a.cardId] = a;
  }
  return { configured: cardsightConfig().configured, cards };
}

/** Front image bytes for one of the room's cards (by our card id, never an arbitrary catalog id). */
export async function frontImage(cardId: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  ensureCatalog();
  if (!ENVIRONMENT.cards.some((c) => c.id === cardId)) return null;
  const art = await artFor(cardId);
  const uuid = art.cardsight?.id;
  if (!uuid || !/^[0-9a-f-]{8,64}$/i.test(uuid)) return null;
  const file = path.join(IMAGE_DIR(), `${uuid}.img`);
  const typeFile = path.join(IMAGE_DIR(), `${uuid}.type`);
  try {
    const bytes = fs.readFileSync(file);
    return { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, contentType: fs.readFileSync(typeFile, "utf8") };
  } catch {
    /* not cached yet */
  }
  try {
    const img = await getCardImage(uuid);
    try {
      fs.mkdirSync(IMAGE_DIR(), { recursive: true });
      fs.writeFileSync(file, Buffer.from(img.bytes));
      fs.writeFileSync(typeFile, img.contentType);
    } catch {
      /* caching is optional */
    }
    return img;
  } catch (e) {
    if (e instanceof CardSightError && e.status === 404) return null;
    throw e;
  }
}

function errorNote(e: unknown): string {
  if (!(e instanceof CardSightError)) return "CardSight lookup failed.";
  if (e.status === 401 || e.status === 403) return `CardSight rejected the API key (HTTP ${e.status}: ${e.message}).`;
  if (e.status === 429) return "CardSight rate limit reached; will retry.";
  if (e.code === "network") return `Couldn't reach CardSight (${e.message}).`;
  return e.message;
}

const tierOf = (hint: LookupHint, h: SearchHit) => {
  const words = hint.nameWords.filter((w) => ` ${h.name.toLowerCase()} `.includes(w)).length;
  return words * 10 + (rejectReason(hint, h) === null ? 100 : 0);
};

/** Look one card up again (ignoring saved results) and explain what CardSight returned. */
async function diagnose(card: (typeof ENVIRONMENT.cards)[number]): Promise<CardDiagnosis> {
  const cfg = cardsightConfig();
  const st = state();
  const hint = hintFor(card);
  const d: CardDiagnosis = { cardId: card.id, name: card.name, outcome: "", searches: [], candidates: [] };
  if (!cfg.configured) {
    d.outcome = "CARDSIGHT_API_KEY is not set on the server.";
    return d;
  }
  try {
    const r = await resolve(card.id);
    d.searches = r.searches;
    const m = r.match;
    d.outcome = m.status === "matched" ? `Matched (${m.confidence}): ${m.cardsight?.name}, ${m.cardsight?.releaseName ?? m.cardsight?.year ?? ""} #${m.cardsight?.number ?? "?"}` : "No certain match.";
    d.candidates = [...r.hits]
      .sort((a, b) => tierOf(hint, b) - tierOf(hint, a))
      .slice(0, 8)
      .map((h) => ({
        name: h.name,
        year: h.year,
        release: h.releaseName,
        set: h.setName,
        number: h.cardNumber,
        verdict: h.id === m.cardsight?.id ? "chosen" : (rejectReason(hint, h) ?? (hint.number && h.cardNumber ? `card #${h.cardNumber}, wanted #${hint.number}` : "acceptable")),
      }));
    st.stored[card.id] = { ...m, identity: cardIdentity(card.id) };
    st.errors.delete(card.id);
    if (m.status === "matched") {
      try {
        const img = await frontImage(card.id);
        d.image = img ? { ok: true, detail: `${img.contentType}, ${Math.round(img.bytes.byteLength / 1024)} KB` } : { ok: false, detail: "CardSight has no image for this card" };
      } catch (e) {
        d.image = { ok: false, detail: errorNote(e) };
      }
    }
  } catch (e) {
    d.outcome = errorNote(e);
  }
  return d;
}

/**
 * Look every card up again (ignoring saved results) and report what CardSight
 * returned and why each candidate was accepted or rejected. Also checks that
 * each matched card's image downloads. Saves any new matches.
 */
export async function diagnoseAll(): Promise<{ configured: boolean; base: string; keyLength: number; cards: CardDiagnosis[] }> {
  ensureCatalog();
  const cfg = cardsightConfig();
  const out: CardDiagnosis[] = [];
  for (const card of ENVIRONMENT.cards) out.push(await diagnose(card));
  save();
  return { configured: cfg.configured, base: cfg.base, keyLength: cfg.apiKey.length, cards: out };
}

/** Look one card up again (for the catalog's per-row "check" button). */
export async function diagnoseOne(cardId: string): Promise<CardDiagnosis | null> {
  ensureCatalog();
  const card = ENVIRONMENT.cards.find((c) => c.id === cardId);
  if (!card) return null;
  const d = await diagnose(card);
  save();
  return d;
}
