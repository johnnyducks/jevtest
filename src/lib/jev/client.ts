/**
 * Minimal server-side client for the Jev System One API.
 *
 * SERVER ONLY. Reads the API key from the environment; never import this from
 * a client component.
 */
import type { Answer, SystemOneRequest, SystemOneResponse } from "./types";

const DEFAULT_BASE = "https://api.typesafe.ai";
const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 2;

export type JevErrorCode =
  | "not_configured"
  | "unauthorized"
  | "validation"
  | "rate_limited"
  | "overloaded"
  | "upstream"
  | "timeout"
  | "network"
  | "bad_response";

export class JevError extends Error {
  constructor(
    public code: JevErrorCode,
    message: string,
    public status?: number,
    public retryable = false,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "JevError";
  }
}

export function jevConfig() {
  const apiKey = process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY || "";
  return {
    apiKey,
    configured: apiKey.length > 0,
    model: process.env.JEV_MODEL || "jev-latest",
    base: (process.env.JEV_API_BASE || DEFAULT_BASE).replace(/\/+$/, ""),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST /v1/systemone with one retry on 429 / 529 / 5xx / network failure. */
export async function evaluate(
  body: Omit<SystemOneRequest, "model"> & { model?: string },
): Promise<SystemOneResponse> {
  const cfg = jevConfig();
  if (!cfg.configured) {
    throw new JevError("not_configured", "JEV_API_KEY is not set on the server.");
  }
  const payload: SystemOneRequest = { ...body, model: body.model ?? cfg.model };

  let lastError: JevError | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptOnce(cfg.base, cfg.apiKey, payload);
    } catch (err) {
      lastError =
        err instanceof JevError ? err : new JevError("network", "Could not reach the Jev API.", undefined, true);
      if (!lastError.retryable || attempt === MAX_ATTEMPTS) break;
      const wait = typeof lastError.detail === "number" ? lastError.detail : 600 * attempt;
      await sleep(Math.min(wait, 3000));
    }
  }
  throw lastError!;
}

async function attemptOnce(base: string, apiKey: string, payload: SystemOneRequest) {
  let res: Response;
  try {
    res = await fetch(`${base}/v1/systemone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new JevError("timeout", `Jev did not respond within ${TIMEOUT_MS / 1000}s.`, undefined, true);
    }
    throw new JevError("network", "Could not reach the Jev API.", undefined, true);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail: unknown = text;
    try {
      detail = JSON.parse(text);
    } catch {}
    const retryAfter = Number(res.headers.get("retry-after"));
    const retryMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
    switch (res.status) {
      case 401:
      case 403:
        throw new JevError("unauthorized", "Jev rejected the API key.", res.status);
      case 422:
        throw new JevError("validation", "Jev rejected the request as invalid.", res.status, false, detail);
      case 429:
        throw new JevError("rate_limited", "Jev rate limit reached.", res.status, true, retryMs);
      case 529:
        throw new JevError("overloaded", "Jev is temporarily overloaded.", res.status, true, retryMs);
      default:
        throw new JevError("upstream", `Jev returned HTTP ${res.status}.`, res.status, res.status >= 500, retryMs);
    }
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new JevError("bad_response", "Jev returned a non-JSON response.", res.status);
  }
  return assertResponse(json, payload);
}

/** Validate shape strictly: we never fill in or invent missing values. */
function assertResponse(json: unknown, req: SystemOneRequest): SystemOneResponse {
  const r = json as Partial<SystemOneResponse> | null;
  if (!r || typeof r !== "object" || typeof r.model !== "string" || !r.answers || typeof r.answers !== "object") {
    throw new JevError("bad_response", "Jev response is missing `model` or `answers`.");
  }
  for (const [name, q] of Object.entries(req.questions)) {
    const a = (r.answers as Record<string, Answer>)[name];
    if (!a || a.type !== q.type) {
      throw new JevError("bad_response", `Jev response has no ${q.type} answer for "${name}".`);
    }
    const ok =
      a.type === "noul"
        ? typeof a.noul === "number"
        : typeof a.confidence === "number" &&
          !!a.probabilities &&
          typeof a.probabilities === "object" &&
          (a.type === "choice" ? typeof a.choice === "string" : typeof a.score === "number");
    if (!ok) throw new JevError("bad_response", `Jev answer for "${name}" is malformed.`);
  }
  // Returned verbatim (including any fields we don't use) so the UI can show exactly what Jev sent.
  return r as SystemOneResponse;
}
