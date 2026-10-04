import { getBaseballKnowledge } from "@/lib/baseball/server";
import { catalogState, saveCatalog } from "@/lib/catalog/server";
import { errorResponse, readJson } from "@/lib/http";
import { operatorAllowed } from "@/lib/live/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → the card catalog (anyone can look). */
export function GET() {
  return Response.json(catalogState(), { headers: { "Cache-Control": "no-store" } });
}

/** PUT { key?, cards } → validate, save and apply the whole catalog. Operator only. */
export async function PUT(req: Request) {
  const body = await readJson(req);
  if (!operatorAllowed(body?.key)) return errorResponse(403, "forbidden", "Operator key required.");
  if (!Array.isArray(body?.cards) || body.cards.length > 500) return errorResponse(400, "bad_request", "Send the full list of cards (at most 500).");
  const r = saveCatalog(body.cards, (name) => {
    const who = getBaseballKnowledge()?.store.resolvePlayer(name);
    return who?.status === "resolved" ? who.playerId : null;
  });
  if (!r.ok) return Response.json({ error: { code: "invalid", message: r.issues.find((i) => i.level === "error")?.message ?? "Invalid catalog.", retryable: false }, issues: r.issues }, { status: 422 });
  return Response.json(r.state, { headers: { "Cache-Control": "no-store" } });
}
