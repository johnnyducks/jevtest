import { modelInfo } from "@/lib/decor/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → whether a succulent model has been uploaded (size and time), or null for the built-in stand-in. */
export function GET() {
  return Response.json({ model: modelInfo() }, { headers: { "Cache-Control": "no-store" } });
}
