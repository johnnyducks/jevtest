import type { StatusBody } from "@/lib/decision/contracts";
import { jevConfig } from "@/lib/jev/client";
import { voiceConfig } from "@/lib/voice/openai";
import { knowledgeStatus } from "@/lib/baseball/server";
import { operatorKeyRequired } from "@/lib/live/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports which models are configured. Never returns key material. */
export function GET() {
  const jev = jevConfig();
  const voice = voiceConfig();
  const body: StatusBody = {
    jev: { configured: jev.configured, model: jev.model },
    voice: { configured: voice.configured, model: voice.model },
    knowledge: knowledgeStatus(),
    operator: { keyRequired: operatorKeyRequired() },
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
