/**
 * Marty's replies via OpenAI Chat Completions, with a persona and a FACTS block
 * from the navigation system that the reply must not contradict. Falls back to
 * built-in lines when no key is set or the call fails. SERVER ONLY.
 */
import { ENVIRONMENT } from "../twin/environment";
import { builtInReply, type Outcome } from "./lines";

const TIMEOUT_MS = 30_000;

export function voiceConfig() {
  const apiKey = process.env.OPENAI_API_KEY || "";
  return {
    apiKey,
    configured: apiKey.length > 0,
    model: process.env.OPENAI_MODEL || "gpt-5",
    base: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  };
}

export interface ReplyResult {
  text: string;
  source: "openai" | "built-in";
  model?: string;
  /** Why built-in lines were used, if they were. */
  note?: string;
}

export interface ChatLine {
  role: "user" | "assistant";
  text: string;
}

const CARDS = ENVIRONMENT.cards.map((c) => `${c.name} (${c.year} ${c.team})`).join("; ");

const PERSONA = `You are Marty, a small tracked robot (a Moorebot Scout) who lives in a room full of baseball cards mounted on the walls and furniture. People type requests and you drive to cards. You speak in first person.

Personality: dry, sardonic and quick-witted, like a deadpan sports-radio host who happens to be a shoebox on treads. A little self-deprecating about being small. Genuinely helpful underneath the snark: the person should always know what is happening and what they can do next. Light baseball references are welcome; don't pun every line. Never mean to the person.

Style: 1 to 3 short sentences. Plain text. No markdown, no emoji, no hashtags, no stage directions.

Truth rules: the FACTS block comes from your navigation system and is ground truth. Never contradict it. Never invent cards, distances, obstacles or outcomes. Never claim you arrived unless status is "arrived".
- moving: you are on your way (not there yet). Mention the target; the route length or detour is a nice touch.
- arrived: you got there.
- needs_clarification: ask the question. If options are given, name every one. If the card wasn't found, say so and suggest a couple of real cards.
- no_route: say you can't get there and why in plain words, then suggest trying another card.
- rejected: decline briefly and offer something you can do.
- answered: the person is chatting, not giving an order. Reply helpfully, in character. If useful, mention what you can do: drive to any card by name, the nearest card, the other side of the room, the middle, or the dock.
- stopped: confirm you stopped.
- error: your decision engine is unavailable; say so and suggest retrying.

Cards in the room: ${CARDS}.`;

function factsBlock(o: Outcome) {
  const lines = [
    `status: ${o.status}`,
    o.target ? `target: ${o.target}` : null,
    o.routeMeters !== undefined ? `route: ${o.routeMeters} m${o.detour ? ", detours around obstacles" : ", direct"}` : null,
    o.options?.length ? `options: ${o.options.join(" | ")}` : null,
    o.matched ? `ambiguous word: "${o.matched}"` : null,
    `details: ${o.facts}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export async function martyReply(o: Outcome, history: ChatLine[]): Promise<ReplyResult> {
  const cfg = voiceConfig();
  const fallback = (note: string): ReplyResult => ({
    text: builtInReply(o, ENVIRONMENT.cards.map((c) => c.name)),
    source: "built-in",
    note,
  });
  if (!cfg.configured) return fallback("OPENAI_API_KEY not set");

  const messages = [
    { role: "system", content: PERSONA },
    ...history.slice(-10).map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: `${o.request}\n\nFACTS (from Marty's navigation system, not from the person):\n${factsBlock(o)}` },
  ];
  const request: Record<string, unknown> = { model: cfg.model, messages, max_completion_tokens: 1500, reasoning_effort: "low" };

  try {
    let res = await call(cfg, request);
    if (!res.ok && res.status === 400 && /reasoning_effort/i.test(res.message)) {
      delete request.reasoning_effort; // non-reasoning models reject this setting
      res = await call(cfg, request);
    }
    if (!res.ok) return fallback(`OpenAI error ${res.status}: ${res.message}`);
    const choice = res.data.choices?.[0];
    const text = (choice?.message?.content ?? "").trim();
    if (!text || choice?.message?.refusal) return fallback("OpenAI returned no text");
    return { text, source: "openai", model: res.data.model };
  } catch (err) {
    return fallback(err instanceof Error ? err.message : "OpenAI call failed");
  }
}

interface ChatCompletion {
  model: string;
  choices: { message: { content: string | null; refusal?: string | null } }[];
}

async function call(cfg: ReturnType<typeof voiceConfig>, request: Record<string, unknown>) {
  const res = await fetch(`${cfg.base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as (ChatCompletion & { error?: { message?: string } }) | null;
  if (res.ok && json) return { ok: true as const, status: res.status, data: json };
  const message = String(json?.error?.message ?? `HTTP ${res.status}`).slice(0, 200);
  console.error(`Marty reply failed: HTTP ${res.status} ${message}`);
  return { ok: false as const, status: res.status, message };
}
