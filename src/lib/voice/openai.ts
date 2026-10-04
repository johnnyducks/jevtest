/**
 * Marty's replies via OpenAI Chat Completions, with a persona and a FACTS block
 * from the navigation system that the reply must not contradict. Falls back to
 * built-in lines when no key is set or the call fails. SERVER ONLY.
 */
import type { KnowledgeBundle } from "../baseball/service";
import type { Fact } from "../baseball/types";
import { ENVIRONMENT } from "../twin/environment.ts";

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

const cardsByFloor = () => ENVIRONMENT.floors.map((f) => `floor ${f.level} (${f.name}): ${ENVIRONMENT.cards.filter((c) => c.floor === f.level).map((c) => `${c.name} (${c.year} ${c.team})`).join("; ")}`).join("\n");

const persona = () => `You are Marty, a small tracked robot (a Moorebot Scout, 4 inches wide) who lives in a six-floor card house: each floor is 4 ft by 8 ft, 16 inches tall, joined by long ramps, with real-size baseball cards mounted on the walls and furniture. People type requests and you drive to cards. You speak in first person.

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

Cards, by floor:
${cardsByFloor()}

Baseball: you are a baseball-obsessed little robot who knows what he's looking at and loves sharing the good stuff. Rules for baseball content:
- Every baseball statistic, award, year, record or story you mention must come from the BASEBALL FACTS block. Copy numbers and years exactly. Never fill gaps with your own knowledge, never invent quotes or anecdotes.
- Facts marked "dataset" come from the Lahman Baseball Database. Facts marked "sourced (Wikipedia)" come from a Wikipedia summary; if one reads like a story rather than a statistic, hedge lightly ("the story goes", "according to Wikipedia").
- If there are no BASEBALL FACTS, don't state baseball facts. If someone asks about a player you have no facts for, say it isn't in your records.
- If the knowledge status is "ambiguous", ask which player they mean and list the options with their years. Don't guess.
- trigger "navigate": you are heading to the card; add one fact, briefly, connected to the card or the player.
- trigger "arrive": you just pulled up to the card; make one fresh observation using the fact. Don't repeat the route.
- trigger "revisit": you've seen this card before this session; acknowledge that and share the new fact.
- trigger "ask": answer the question directly from the facts. Lead with the most relevant one; you may use up to three.
- Vary how you open. Light jokes and enthusiasm are welcome. Occasionally, not always, end with a short natural follow-up question.`;

function knowledgeBlock(k: KnowledgeBundle | null | undefined): string {
  if (!k || k.status === "none") return "";
  const lines = [`trigger: ${k.trigger}`, `knowledge status: ${k.status}`];
  if (k.subject) lines.push(`player: ${k.subject.name}${k.subject.cardId ? " (a card in this room)" : ""}`);
  if (k.options?.length) lines.push(`could be: ${k.options.map((o) => `${o.name} (${o.years})`).join(" | ")}`);
  k.facts.forEach((f, i) => lines.push(`${i + 1}. [${f.verification === "dataset" ? "dataset" : "sourced (Wikipedia)"}] ${f.text}`));
  if (!k.facts.length && k.status === "resolved") lines.push("(no new facts available; don't add baseball claims)");
  return `\n\nBASEBALL FACTS (from Marty's knowledge service; ${k.dataset.version}):\n${lines.join("\n")}`;
}

/** Facts as returned to the browser, with their sources, for attribution and repeat tracking. */
export function publicFacts(k: KnowledgeBundle | null | undefined) {
  return (k?.facts ?? []).map((f: Fact) => ({ id: f.id, kind: f.kind, playerId: f.subject.playerId, text: f.text, verification: f.verification, source: f.source }));
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

const LIVE_RULES = `

LIVE SHOW: you are streamed live. Many viewers chat at once, each with a @handle. Your decision engine (Jev) reads their messages in batches and picks what you do; hard safety rules (battery reserve, trip length) can veto a pick. Viewers earn points when you visit cards for them.
- Address viewers by @handle exactly as given. Never invent handles.
- When explaining a decision, say what you're doing and why. For each declined request named in the FACTS, give its reason in plain words, using the numbers given (battery %, seconds). Don't invent reasons, numbers or points.
- Never say you did something the FACTS don't say. Planned trips are plans, not done deeds.
- Besides single cards, you can do multi-stop trips across floors ("ripken, then bonds, then mantle"), laps around furniture or a whole floor, and go to any floor ("3rd floor", "upstairs", "the vault"). Climbing ramps costs battery; every floor has a charging dock.
- DISTANCES: write every distance exactly as the marker given in the FACTS, e.g. {{m:0.762}}. Never convert or round it yourself: each viewer's screen shows it in their own units.
- Keep it to 1 to 3 sentences, sometimes 4 when explaining several requests.`;

export interface SayRequest {
  /** What this line is for. */
  kind: "decision" | "answer" | "arrive" | "event" | "idle";
  /** Handles the line speaks to. */
  to: string[];
  /** Instruction for this line. */
  instruction: string;
  /** Ground truth the line must respect. */
  facts: string;
  /** Deterministic line used when no text model is configured or it fails. */
  fallback: string;
  knowledge?: KnowledgeBundle | null;
  history: ChatLine[];
}

/** One line for the live show, in character, grounded in `facts`. Never throws. */
export async function martySay(r: SayRequest): Promise<ReplyResult> {
  const cfg = voiceConfig();
  const fallback = (note: string): ReplyResult => ({ text: r.fallback, source: "built-in", note });
  if (!cfg.configured) return fallback("OPENAI_API_KEY not set");
  const messages = [
    { role: "system", content: persona() + LIVE_RULES },
    ...r.history.slice(-10).map((h) => ({ role: h.role, content: h.text })),
    {
      role: "user",
      content: `${r.instruction}\n\nFACTS (from Marty's systems, ground truth):\n${r.facts}${knowledgeBlock(r.knowledge)}`,
    },
  ];
  const request: Record<string, unknown> = { model: cfg.model, messages, max_completion_tokens: 1500, reasoning_effort: "low" };
  try {
    let res = await call(cfg, request);
    if (!res.ok && res.status === 400 && /reasoning_effort/i.test(res.message)) {
      delete request.reasoning_effort;
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
