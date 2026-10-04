import { getLive } from "@/lib/live/server";
import { SpeechError, speechConfig, speechFor } from "@/lib/voice/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → one of Marty's chat lines read aloud (MP3), via ElevenLabs. Only Marty's own lines; the key stays on the server. */
export async function GET(req: Request, ctx: { params: Promise<{ lineId: string }> }) {
  if (!speechConfig().configured) return Response.json({ error: "Speech is off: ELEVENLABS_API_KEY is not set on the server." }, { status: 503 });
  const { lineId } = await ctx.params;
  const text = getLive().martyLine(lineId);
  if (!text) return Response.json({ error: "No such line from Marty." }, { status: 404 });
  const units = new URL(req.url).searchParams.get("units") === "metric" ? "metric" : "imperial";
  try {
    const audio = await speechFor(lineId, text, units);
    return new Response(audio.bytes.slice(0), { headers: { "Content-Type": audio.contentType, "Cache-Control": "private, max-age=3600" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Speech failed.";
    console.warn(`Speech for ${lineId} failed:`, message);
    return Response.json({ error: message }, { status: err instanceof SpeechError ? err.status : 502 });
  }
}
