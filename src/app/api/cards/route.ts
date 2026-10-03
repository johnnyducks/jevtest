import { allCardArt } from "@/lib/cardsight/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → artwork for every card in the room (CardSight link, front/back image URLs). Never returns the API key. */
export async function GET() {
  return Response.json(await allCardArt(), { headers: { "Cache-Control": "no-store" } });
}
