import { getBaseballKnowledge } from "@/lib/baseball/server";
import type { KnowledgeBundle, KnowledgeRequest, KnowledgeTrigger } from "@/lib/baseball/service";
import { readJson } from "@/lib/http";
import type { Outcome, OutcomeStatus } from "@/lib/voice/lines";
import { type ChatLine, martyReply, publicFacts } from "@/lib/voice/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: OutcomeStatus[] = ["moving", "arrived", "needs_clarification", "no_route", "rejected", "answered", "stopped", "error"];
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);

const TRIGGERS: KnowledgeTrigger[] = ["navigate", "arrive", "revisit", "ask"];

function parseKnowledge(v: unknown): KnowledgeRequest | null {
  if (!v || typeof v !== "object") return null;
  const k = v as Partial<KnowledgeRequest>;
  if (!TRIGGERS.includes(k.trigger as KnowledgeTrigger)) return null;
  const ids = (x: unknown) => (Array.isArray(x) ? x.slice(0, 200).map((s) => String(s).slice(0, 120)) : []);
  return {
    trigger: k.trigger as KnowledgeTrigger,
    cardId: typeof k.cardId === "string" ? k.cardId.slice(0, 60) : undefined,
    text: typeof k.text === "string" ? k.text.slice(0, 300) : undefined,
    exclude: ids(k.exclude),
    recentKinds: ids(k.recentKinds).slice(0, 10),
  };
}

/** Knowledge lookups are best-effort: any failure means "no facts", never a failed reply. */
async function lookup(req: KnowledgeRequest | null): Promise<KnowledgeBundle | null> {
  if (!req) return null;
  try {
    return (await getBaseballKnowledge()?.bundle(req)) ?? null;
  } catch (err) {
    console.warn("Baseball knowledge lookup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * POST { outcome, history, knowledge? } → Marty's reply in character, plus the
 * sourced facts it was given. Always answers (built-in lines as fallback).
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  const o = (body?.outcome ?? {}) as Partial<Outcome>;
  if (!STATUSES.includes(o.status as OutcomeStatus) || typeof o.request !== "string") {
    return Response.json({ error: { code: "bad_request", message: "Missing outcome.", retryable: false } }, { status: 400 });
  }
  const outcome: Outcome = {
    status: o.status as OutcomeStatus,
    request: o.request.slice(0, 300),
    seq: Number(o.seq) || 0,
    target: str(o.target, 80),
    routeMeters: typeof o.routeMeters === "number" ? Math.round(o.routeMeters * 100) / 100 : undefined,
    detour: o.detour === true,
    options: Array.isArray(o.options) ? o.options.slice(0, 6).map((x) => String(x).slice(0, 60)) : undefined,
    matched: str(o.matched, 40),
    facts: str(o.facts, 800) ?? "",
  };
  const history: ChatLine[] = Array.isArray(body?.history)
    ? (body.history as ChatLine[])
        .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.text === "string")
        .slice(-10)
        .map((h) => ({ role: h.role, text: h.text.slice(0, 500) }))
    : [];
  const knowledge = await lookup(parseKnowledge(body?.knowledge));
  const reply = await martyReply(outcome, history, knowledge);
  return Response.json(
    { ...reply, facts: publicFacts(knowledge), knowledge: knowledge ? { status: knowledge.status, trigger: knowledge.trigger, subject: knowledge.subject ?? null } : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
