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
import { LOOKUP, pickMatch } from "./match";
import type { CardArt, CardArtBody } from "./types";

interface StoredMatch {
  status: "matched" | "not_found";
  confidence?: "exact" | "likely";
  cardsight?: CardArt["cardsight"];
  reasons?: string[];
  matchedAt: string;
}

const MATCHES = () => path.join(process.cwd(), "data", "cardsight", "matches.json");
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

async function resolve(cardId: string): Promise<StoredMatch> {
  const hint = LOOKUP[cardId];
  if (!hint) return { status: "not_found", matchedAt: new Date().toISOString(), reasons: ["no lookup hint for this card"] };
  if (hint.id) {
    const d = await getCard(hint.id);
    return {
      status: "matched",
      confidence: "exact",
      cardsight: { id: d.id, name: d.name, number: d.number, setName: d.setName, releaseName: d.releaseName, year: d.releaseYear, description: d.description },
      reasons: ["pinned in lib/cardsight/match.ts"],
      matchedAt: new Date().toISOString(),
    };
  }
  const hits = await searchCards(hint.query, hint.years);
  const m = pickMatch(hint, hits);
  if (!m) return { status: "not_found", matchedAt: new Date().toISOString(), reasons: [`no certain match among ${hits.length} search results`] };
  let description: string | undefined;
  try {
    description = (await getCard(m.hit.id)).description;
  } catch {
    /* details are optional */
  }
  return {
    status: "matched",
    confidence: m.confidence,
    cardsight: { id: m.hit.id, name: m.hit.name, number: m.hit.cardNumber, setName: m.hit.setName, releaseName: m.hit.releaseName, year: m.hit.year, description },
    reasons: m.reasons,
    matchedAt: new Date().toISOString(),
  };
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

async function artFor(cardId: string): Promise<CardArt> {
  const st = state();
  const stored = st.stored[cardId];
  const fresh = stored && (stored.status === "matched" || Date.now() - Date.parse(stored.matchedAt) < RETRY_NOT_FOUND_MS);
  if (fresh || !cardsightConfig().configured) return toArt(cardId, stored);
  const err = st.errors.get(cardId);
  if (err && Date.now() - err.at < RETRY_ERROR_MS) return toArt(cardId, stored, err.note);
  let p = st.inflight.get(cardId);
  if (!p) {
    p = resolve(cardId)
      .then((m) => {
        st.stored[cardId] = m;
        st.errors.delete(cardId);
        save();
        return toArt(cardId, m);
      })
      .catch((e: unknown) => {
        const note = e instanceof CardSightError ? (e.status === 401 || e.status === 403 ? "CardSight rejected the API key." : e.status === 429 ? "CardSight rate limit reached; will retry." : e.message) : "CardSight lookup failed.";
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
