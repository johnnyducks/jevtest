/**
 * Server-side singleton for the baseball knowledge service. SERVER ONLY.
 * Loads data/baseball/knowledge.json once; if it is missing or unreadable,
 * Marty simply has no baseball facts (navigation and chat keep working).
 */
import fs from "node:fs";
import path from "node:path";
import { ENVIRONMENT } from "../twin/environment";
import { BaseballKnowledge } from "./service";
import { KnowledgeStore } from "./store";
import type { KnowledgeData } from "./types";
import { WikipediaClient } from "./wikipedia";

let instance: BaseballKnowledge | null | undefined;

/** Fixed location (statically scoped so the build only traces data/baseball). */
export function knowledgePath() {
  return path.join(process.cwd(), "data", "baseball", "knowledge.json");
}

export function getBaseballKnowledge(): BaseballKnowledge | null {
  if (instance !== undefined) return instance;
  try {
    const data = JSON.parse(fs.readFileSync(knowledgePath(), "utf8")) as KnowledgeData;
    const wiki = new WikipediaClient({
      enabled: process.env.WIKIPEDIA_ENABLED !== "false",
      userAgent: process.env.WIKIPEDIA_USER_AGENT || undefined,
    });
    instance = new BaseballKnowledge(new KnowledgeStore(data, ENVIRONMENT.cards), ENVIRONMENT.cards, wiki);
  } catch (err) {
    console.warn(`Baseball knowledge unavailable (${err instanceof Error ? err.message : err}). Run npm run import:lahman.`);
    instance = null;
  }
  return instance;
}

export function knowledgeStatus() {
  const k = getBaseballKnowledge();
  return k
    ? { available: true, version: k.store.meta.version, seasonsThrough: k.store.meta.seasonsThrough, wikipedia: process.env.WIKIPEDIA_ENABLED !== "false" }
    : { available: false, version: null, seasonsThrough: null, wikipedia: false };
}
