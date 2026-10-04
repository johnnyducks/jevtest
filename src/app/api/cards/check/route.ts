import { diagnoseOne } from "@/lib/cardsight/server";
import { errorResponse, readJson } from "@/lib/http";
import { operatorAllowed } from "@/lib/live/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { key?, cardId } → look one card up in CardSight again and explain the result. Operator only. */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!operatorAllowed(body?.key)) return errorResponse(403, "forbidden", "Operator key required.");
  const d = await diagnoseOne(String(body?.cardId ?? ""));
  if (!d) return errorResponse(404, "not_found", "No such card.");
  return Response.json(d, { headers: { "Cache-Control": "no-store" } });
}
