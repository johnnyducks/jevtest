/**
 * Supplemental facts from Wikipedia (MediaWiki REST "page summary" endpoint).
 *
 * - Only fetched for an already-identified player with an explicit article title.
 * - Extracts a few concise sentences from the lead summary, never whole articles.
 * - Cached in memory and on disk (TTL), with a short negative cache on failure.
 * - Never required: callers get [] when Wikipedia is disabled, slow or down.
 *
 * Content is CC BY-SA 4.0; each fact keeps the article URL, revision id and
 * retrieval time for attribution. Marked "sourced", not independently verified.
 */
import fs from "node:fs";
import path from "node:path";
import type { Fact } from "./types.ts";

export interface WikiSummary {
  title: string;
  type: string;
  extract: string;
  revision: string;
  url: string;
  retrievedAt: string;
}

export interface WikipediaOptions {
  fetchImpl?: typeof fetch;
  cacheDir?: string | null;
  timeoutMs?: number;
  ttlMs?: number;
  userAgent?: string;
  enabled?: boolean;
  now?: () => number;
}

const DEFAULT_TTL = 7 * 24 * 3600 * 1000;
const NEGATIVE_TTL = 10 * 60 * 1000;

export class WikipediaClient {
  private memory = new Map<string, { at: number; summary: WikiSummary | null }>();
  private inflight = new Map<string, Promise<WikiSummary | null>>();
  private opts: Required<Omit<WikipediaOptions, "cacheDir">> & { cacheDir: string | null };

  constructor(opts: WikipediaOptions = {}) {
    this.opts = {
      fetchImpl: opts.fetchImpl ?? fetch,
      cacheDir: opts.cacheDir === undefined ? path.join(process.cwd(), ".cache", "wikipedia") : opts.cacheDir,
      timeoutMs: opts.timeoutMs ?? 2500,
      ttlMs: opts.ttlMs ?? DEFAULT_TTL,
      userAgent: opts.userAgent ?? "MartyLive/0.1 (baseball card robot demo; https://marty.live)",
      enabled: opts.enabled ?? true,
      now: opts.now ?? (() => Date.now()),
    };
  }

  private file(title: string) {
    return this.opts.cacheDir ? path.join(this.opts.cacheDir, `${encodeURIComponent(title)}.json`) : null;
  }

  /** Cached summary only (memory, then disk). Never touches the network. */
  cached(title: string): WikiSummary | null | undefined {
    const now = this.opts.now();
    const m = this.memory.get(title);
    if (m && now - m.at < (m.summary ? this.opts.ttlMs : NEGATIVE_TTL)) return m.summary;
    const f = this.file(title);
    if (f && fs.existsSync(f)) {
      try {
        const disk = JSON.parse(fs.readFileSync(f, "utf8")) as WikiSummary;
        if (now - Date.parse(disk.retrievedAt) < this.opts.ttlMs) {
          this.memory.set(title, { at: Date.parse(disk.retrievedAt), summary: disk });
          return disk;
        }
      } catch {
        // corrupt cache entry: ignore
      }
    }
    return undefined;
  }

  /** Fetch (deduplicated, with timeout); resolves null on any failure. */
  fetchSummary(title: string): Promise<WikiSummary | null> {
    if (!this.opts.enabled) return Promise.resolve(null);
    const hit = this.cached(title);
    if (hit !== undefined) return Promise.resolve(hit);
    const existing = this.inflight.get(title);
    if (existing) return existing;
    const p = this.doFetch(title).finally(() => this.inflight.delete(title));
    this.inflight.set(title, p);
    return p;
  }

  private async doFetch(title: string): Promise<WikiSummary | null> {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}?redirect=true`;
    try {
      const res = await this.opts.fetchImpl(url, {
        headers: { "User-Agent": this.opts.userAgent, "Api-User-Agent": this.opts.userAgent, Accept: "application/json" },
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { type?: string; title?: string; extract?: string; revision?: string; content_urls?: { desktop?: { page?: string } } };
      const summary: WikiSummary = {
        title: j.title ?? title,
        type: j.type ?? "standard",
        extract: j.extract ?? "",
        revision: String(j.revision ?? ""),
        url: j.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        retrievedAt: new Date(this.opts.now()).toISOString(),
      };
      this.memory.set(title, { at: this.opts.now(), summary });
      const f = this.file(title);
      if (f) {
        try {
          fs.mkdirSync(path.dirname(f), { recursive: true });
          fs.writeFileSync(f, JSON.stringify(summary));
        } catch {
          // read-only filesystem: memory cache only
        }
      }
      return summary;
    } catch {
      this.memory.set(title, { at: this.opts.now(), summary: null });
      return null;
    }
  }
}

const INTERESTING = /\b(record|first|only|nicknamed|known as|youngest|oldest|unanimous|career|all-time|award|champion|hall of fame|led|won|most|famous|rare|valuable)\b/i;

/**
 * Turn a summary into a few short, attributable facts. Rejects disambiguation
 * pages and articles that don't look like a baseball biography.
 */
export function wikiFacts(summary: WikiSummary | null | undefined, subject: { playerId: string; name: string }): Fact[] {
  if (!summary || summary.type === "disambiguation" || !/baseball/i.test(summary.extract)) return [];
  const sentences = summary.extract
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z"“])/)
    .map((x) => x.trim())
    .filter((x) => x.length > 30 && x.length < 260 && INTERESTING.test(x));
  return sentences.slice(0, 3).map((text, i) => ({
    id: `${subject.playerId}:wiki:${summary.revision || summary.title}:${i}`,
    kind: "wiki" as const,
    subject,
    text,
    score: 57 - i,
    verification: "sourced" as const,
    source: {
      name: "Wikipedia" as const,
      url: summary.url,
      version: summary.revision ? `revision ${summary.revision}` : "latest",
      license: "CC BY-SA 4.0",
      retrievedAt: summary.retrievedAt,
    },
  }));
}
