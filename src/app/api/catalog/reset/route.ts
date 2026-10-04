import { resetCatalog } from "@/lib/catalog/server";
import { errorResponse, readJson } from "@/lib/http";
import { operatorAllowed } from "@/lib/live/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { key? } → back to the built-in cards. Operator only. */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!operatorAllowed(body?.key)) return errorResponse(403, "forbidden", "Operator key required.");
  return Response.json(resetCatalog(), { headers: { "Cache-Control": "no-store" } });
}
