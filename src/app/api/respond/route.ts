import { ACTION_IDS, type ActionId, type ReplyRequestBody } from "@/lib/decision/contracts";
import { errorResponse, parseHistory, parseMessage, parseMode, readJson } from "@/lib/http";
import { generateReply, ReplyError } from "@/lib/respond/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson(req);
  const message = parseMessage(body?.message);
  const mode = parseMode(body?.mode);
  const decision = body?.decision as ReplyRequestBody["decision"] | undefined;
  if (!message || !mode) return errorResponse(400, "bad_request", "Missing message or mode.");
  if (!decision?.effect || !ACTION_IDS.includes(decision.effect.action as ActionId)) {
    return errorResponse(400, "bad_request", "Missing or invalid decision.");
  }
  const effect = decision.effect;
  const safe: ReplyRequestBody = {
    message,
    mode,
    history: parseHistory(body?.history),
    decision: {
      source: decision.source === "jev" ? "jev" : "simulated",
      intent: String(decision.intent ?? "").slice(0, 40),
      intentConfidence: Number(decision.intentConfidence) || 0,
      effect: {
        action: effect.action,
        label: String(effect.label ?? "").slice(0, 160),
        priority: (["P0", "P1", "P2", "P3"] as const).includes(effect.priority) ? effect.priority : "P3",
        directive: String(effect.directive ?? "").slice(0, 800),
        constraints: Array.isArray(effect.constraints) ? effect.constraints.slice(0, 5).map((c) => String(c).slice(0, 160)) : [],
      },
    },
  };

  try {
    return Response.json(await generateReply(safe), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ReplyError) return errorResponse(502, err.code, err.message, err.retryable);
    console.error("respond failed", err);
    return errorResponse(500, "internal", "Commentary generation failed unexpectedly.", true);
  }
}
