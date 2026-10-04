/**
 * Marty's spoken voice via ElevenLabs text-to-speech. SERVER ONLY: the API key
 * stays here; browsers fetch audio for a chat line by its id, so nobody can
 * make the key read out arbitrary text.
 *
 * Each line is synthesized once per unit system and cached, so ten viewers
 * listening to the same line cost one request.
 */
import { speakUnits, type Units } from "../units.ts";

const DEFAULT_BASE = "https://api.elevenlabs.io";
/** "Brian", one of ElevenLabs' built-in voices: deep, dry, radio-ish. */
export const DEFAULT_VOICE = "nPczCjzI2devNBz1zQrb";
export const DEFAULT_MODEL = "eleven_flash_v2_5";
const TIMEOUT_MS = 20_000;
const MAX_CHARS = 600;
const CACHE_SIZE = 120;

const clean = (v: string | undefined) => (v || "").trim().replace(/^["']|["']$/g, "");

export function speechConfig() {
  const apiKey = clean(process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY);
  return {
    apiKey,
    configured: apiKey.length > 0,
    voice: clean(process.env.ELEVENLABS_VOICE_ID) || DEFAULT_VOICE,
    model: clean(process.env.ELEVENLABS_MODEL) || DEFAULT_MODEL,
    base: (clean(process.env.ELEVENLABS_API_BASE) || DEFAULT_BASE).replace(/\/+$/, ""),
  };
}

/** Chat text → what should be read aloud: units spoken out, no @-signs, trimmed to a sane length. */
export function speakable(text: string, units: Units): string {
  let s = speakUnits(text, units)
    .replace(/@([A-Za-z0-9_]+)/g, "$1")
    .replace(/[*_`#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > MAX_CHARS) {
    const cut = s.slice(0, MAX_CHARS);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    s = end > MAX_CHARS / 2 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
  }
  return s;
}

export class SpeechError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SpeechError";
    this.status = status;
  }
}

export interface Speech {
  bytes: ArrayBuffer;
  contentType: string;
}

/** Plain-language reason for a failed ElevenLabs call (shown to the viewer, logged on the server). */
function explain(status: number, body: string): string {
  let detail = "";
  let code = "";
  try {
    const j = JSON.parse(body) as { detail?: { status?: string; message?: string } | string };
    detail = typeof j.detail === "string" ? j.detail : (j.detail?.message ?? j.detail?.status ?? "");
    code = typeof j.detail === "object" ? (j.detail?.status ?? "") : "";
  } catch {
    detail = body.slice(0, 200);
  }
  // ElevenLabs reports an empty balance as 401 "quota_exceeded", so check that first.
  if (status === 402 || /quota|credits/i.test(`${code} ${detail}`)) return `ElevenLabs says the account is out of credits${detail ? ` (${detail})` : ""}.`;
  if (status === 401) return `ElevenLabs rejected the API key${detail ? ` (${detail})` : ""}. Check ELEVENLABS_API_KEY in .env.local.`;
  if (status === 404) return `ElevenLabs doesn't know that voice${detail ? ` (${detail})` : ""}. Check ELEVENLABS_VOICE_ID.`;
  if (status === 429) return "ElevenLabs is rate-limiting requests; try again in a moment.";
  return `ElevenLabs returned ${status}${detail ? `: ${detail}` : ""}.`;
}

export async function synthesize(text: string, fetchImpl: typeof fetch = fetch): Promise<Speech> {
  const cfg = speechConfig();
  if (!cfg.configured) throw new SpeechError(503, "ELEVENLABS_API_KEY is not set on the server.");
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.base}/v1/text-to-speech/${encodeURIComponent(cfg.voice)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": cfg.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: cfg.model }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    throw new SpeechError(502, `Couldn't reach ElevenLabs (${err instanceof Error ? err.message : "network error"}).`);
  }
  if (!res.ok) throw new SpeechError(502, explain(res.status, await res.text().catch(() => "")));
  return { bytes: await res.arrayBuffer(), contentType: res.headers.get("content-type") || "audio/mpeg" };
}

const g = globalThis as unknown as { __martySpeech?: Map<string, Promise<Speech>> };
const cache = () => (g.__martySpeech ??= new Map());

/** Audio for one chat line, synthesized at most once (concurrent requests share the call). */
export function speechFor(lineId: string, text: string, units: Units, fetchImpl?: typeof fetch): Promise<Speech> {
  const c = cache();
  const key = `${lineId}:${units}`;
  const hit = c.get(key);
  if (hit) {
    c.delete(key); // refresh its place in the LRU order
    c.set(key, hit);
    return hit;
  }
  const p = synthesize(speakable(text, units), fetchImpl);
  c.set(key, p);
  p.catch(() => c.delete(key)); // don't cache failures
  while (c.size > CACHE_SIZE) c.delete(c.keys().next().value!);
  return p;
}
