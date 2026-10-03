/**
 * Minimal server-side client for the CardSight AI REST API
 * (https://api.cardsight.ai/documentation). SERVER ONLY: reads the API key
 * from the environment and sends it in the X-API-Key header.
 */
import type { SearchHit } from "./match.ts";

const DEFAULT_BASE = "https://api.cardsight.ai";
const TIMEOUT_MS = 15_000;

export function cardsightConfig() {
  // Trim stray spaces and quotes from copy-pasting the key into .env.local.
  const apiKey = (process.env.CARDSIGHT_API_KEY || process.env.CARDSIGHTAI_API_KEY || "").trim().replace(/^["']|["']$/g, "");
  return { apiKey, configured: apiKey.length > 0, base: (process.env.CARDSIGHT_API_BASE || DEFAULT_BASE).replace(/\/+$/, "") };
}

export class CardSightError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CardSightError";
    this.status = status;
    this.code = code;
  }
}

async function get(path: string, accept = "application/json"): Promise<Response> {
  const cfg = cardsightConfig();
  if (!cfg.configured) throw new CardSightError(0, "not_configured", "CARDSIGHT_API_KEY is not set on the server.");
  let res: Response;
  try {
    res = await fetch(`${cfg.base}${path}`, {
      headers: { "X-API-Key": cfg.apiKey, Accept: accept },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    throw new CardSightError(0, "network", err instanceof Error ? err.message : "CardSight request failed");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new CardSightError(res.status, body?.code ?? `http_${res.status}`, body?.error ?? `CardSight HTTP ${res.status}`);
  }
  return res;
}

/** GET /v1/catalog/search for cards. Year range and segment are optional filters. */
export async function searchCards(q: string, opts: { years?: [number, number]; segment?: string } = {}): Promise<SearchHit[]> {
  const params = new URLSearchParams({ q, type: "card", take: "100" });
  if (opts.segment) params.set("segment", opts.segment);
  if (opts.years) {
    if (opts.years[0] === opts.years[1]) params.set("year", String(opts.years[0]));
    else {
      params.set("min_year", String(opts.years[0]));
      params.set("max_year", String(opts.years[1]));
    }
  }
  const res = await get(`/v1/catalog/search?${params}`);
  const json = (await res.json()) as { results?: SearchHit[]; data?: SearchHit[] } | SearchHit[];
  // Accept the documented shape ({ results }) and, defensively, a bare array.
  const list = Array.isArray(json) ? json : (json.results ?? json.data ?? []);
  return Array.isArray(list) ? list : [];
}

export interface CardDetail {
  id: string;
  name: string;
  number?: string;
  description?: string;
  releaseName?: string;
  releaseYear?: string;
  setName: string;
}

/** GET /v1/catalog/cards/{id} */
export async function getCard(id: string): Promise<CardDetail> {
  const res = await get(`/v1/catalog/cards/${encodeURIComponent(id)}`);
  return (await res.json()) as CardDetail;
}

/** GET /v1/images/cards/{id} (raw image bytes). CardSight provides one image per card: the front. */
export async function getCardImage(id: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const res = await get(`/v1/images/cards/${encodeURIComponent(id)}?format=raw`, "image/*");
  return { bytes: await res.arrayBuffer(), contentType: res.headers.get("content-type") || "image/jpeg" };
}
