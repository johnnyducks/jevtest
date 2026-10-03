import type { StatusBody } from "@/lib/decision/contracts";
import { jevConfig } from "@/lib/jev/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports which models are configured. Never returns key material. */
export function GET() {
  const jev = jevConfig();
  const body: StatusBody = { jev: { configured: jev.configured, model: jev.model } };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
