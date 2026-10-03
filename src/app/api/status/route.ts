import type { StatusBody } from "@/lib/decision/contracts";
import { jevConfig } from "@/lib/jev/client";
import { replyConfig } from "@/lib/respond/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports which integrations are configured. Never returns key material. */
export function GET() {
  const jev = jevConfig();
  const replies = replyConfig();
  const body: StatusBody = {
    jev: { configured: jev.configured, model: jev.model },
    replies: { configured: replies.configured, model: replies.model },
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
