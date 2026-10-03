import { errorResponse, readJson } from "@/lib/http";
import { getLive } from "@/lib/live/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { handle, text } → queued for Marty's next decision. Rate limited per handle and per client. */
export async function POST(req: Request) {
  const body = await readJson(req);
  const client = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  const r = getLive().post(String(body?.handle ?? ""), String(body?.text ?? ""), client);
  if (!r.ok) return errorResponse(r.code === "rate_limited" ? 429 : r.code === "busy" ? 503 : 400, r.code, r.message, r.code !== "bad_handle" && r.code !== "bad_text", r.retryAfterMs !== undefined ? { retryAfterMs: r.retryAfterMs } : undefined);
  return Response.json({ ok: true, id: r.id }, { headers: { "Cache-Control": "no-store" } });
}
