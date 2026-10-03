import { diagnoseAll } from "@/lib/cardsight/server";
import { errorResponse, readJson } from "@/lib/http";
import { operatorAllowed } from "@/lib/live/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { key? } → look every card up again and report what CardSight returned.
 * Operator only (it spends CardSight lookups). Never returns the API key.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!operatorAllowed(body?.key)) return errorResponse(403, "forbidden", "Operator key required.");
  return Response.json(await diagnoseAll(), { headers: { "Cache-Control": "no-store" } });
}
