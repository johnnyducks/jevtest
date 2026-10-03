import { JevError } from "@/lib/jev/client";
import { decide } from "@/lib/decision/engine";
import { errorResponse, parseHistory, parseMessage, readJson } from "@/lib/http";
import { parseWorld } from "@/lib/marty/world";
import { parseTwin } from "@/lib/twin/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  not_configured: 503,
  unauthorized: 502,
  validation: 502,
  rate_limited: 429,
  overloaded: 503,
  timeout: 504,
};

export async function POST(req: Request) {
  const body = await readJson(req);
  const message = parseMessage(body?.message);
  if (!message) return errorResponse(400, "bad_request", "Message must be 1–4000 characters.");

  try {
    const result = await decide(message, parseWorld(body?.world), parseHistory(body?.history), parseTwin(body?.twin));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof JevError) {
      // Validation detail from Jev describes our request, not secrets; safe to surface.
      return errorResponse(STATUS[err.code] ?? 502, err.code, err.message, err.retryable || err.code === "network", err.code === "validation" ? err.detail : undefined);
    }
    console.error("decide failed", err);
    return errorResponse(500, "internal", "Decision engine failed unexpectedly.", true);
  }
}
