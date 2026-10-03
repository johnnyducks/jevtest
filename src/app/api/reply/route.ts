import { readJson } from "@/lib/http";
import type { Outcome, OutcomeStatus } from "@/lib/voice/lines";
import { type ChatLine, martyReply } from "@/lib/voice/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: OutcomeStatus[] = ["moving", "arrived", "needs_clarification", "no_route", "rejected", "answered", "stopped", "error"];
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);

/** POST { outcome, history } → Marty's reply in character. Always answers (built-in lines as fallback). */
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
  return Response.json(await martyReply(outcome, history), { headers: { "Cache-Control": "no-store" } });
}
