import path from "node:path";
import { fileURLToPath } from "node:url";
import { importLahman } from "../../../../scripts/import-lahman.ts";
import { ENVIRONMENT } from "../../twin/environment.ts";
import { BaseballKnowledge } from "../service.ts";
import { KnowledgeStore } from "../store.ts";
import type { KnowledgeData } from "../types.ts";
import { WikipediaClient, type WikiSummary } from "../wikipedia.ts";

export const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "lahman");
export const cards = ENVIRONMENT.cards;
export const griffeyCard = cards.find((c) => c.id === "griffey-89")!;

export function fixtureData(): KnowledgeData {
  return importLahman(FIXTURE, {
    players: ["griffke02", "suzukic01", "bondsba01", "bondsbo01"],
    version: "test fixture",
    source: "fixture",
    url: "https://sabr.org/lahman-database/",
  }) as unknown as KnowledgeData;
}

export function fixtureStore() {
  return new KnowledgeStore(fixtureData(), cards);
}

/** fetch stub for Wikipedia: either a canned summary or a network failure. */
export function wikiFetch(summary: Partial<WikiSummary> & { extract: string } | "down") {
  let calls = 0;
  const impl = (async () => {
    calls++;
    if (summary === "down") throw new TypeError("fetch failed");
    return new Response(
      JSON.stringify({ type: "standard", title: "Ken Griffey Jr.", revision: "123456", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Ken_Griffey_Jr." } }, ...summary }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { impl, calls: () => calls };
}

export function service(wiki: WikipediaClient | null = null) {
  return new BaseballKnowledge(fixtureStore(), cards, wiki);
}
