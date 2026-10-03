import { frontImage } from "@/lib/cardsight/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → the card's front image from CardSight, proxied so the API key stays on the server. */
export async function GET(_req: Request, ctx: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await ctx.params;
  try {
    const img = await frontImage(cardId);
    if (!img) return new Response("No image for this card.", { status: 404 });
    return new Response(img.bytes, { headers: { "Content-Type": img.contentType, "Cache-Control": "public, max-age=86400" } });
  } catch (err) {
    console.warn(`Card image for ${cardId} failed:`, err instanceof Error ? err.message : err);
    return new Response("Card image unavailable right now.", { status: 502 });
  }
}
