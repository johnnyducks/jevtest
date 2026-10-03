/**
 * Marty's commentary generation (OpenAI), independent of the decision engine.
 * It receives only the selected effect, never raw probabilities to re-interpret.
 * SERVER ONLY.
 */
import type { ActionId, ReplyRequestBody, ReplyResult } from "../decision/contracts";

const TIMEOUT_MS = 45_000;

export function replyConfig() {
  const apiKey = process.env.OPENAI_API_KEY || "";
  return {
    apiKey,
    configured: apiKey.length > 0,
    model: process.env.OPENAI_MODEL || "gpt-5",
    base: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  };
}

export class ReplyError extends Error {
  constructor(public code: string, message: string, public retryable: boolean) {
    super(message);
  }
}

const SYSTEM = `You write the onboard commentary for MARTY, a small indoor exploration robot, inside "MARTY / THE BRAIN".
This is a simulated sandbox: no physical robot is connected. Never claim Marty has physically done anything; describe the plan ("Heading to…", "Next up…").
A separate decision engine has already chosen Marty's next action under fixed safety rules. Narrate that decision; do not change it or second-guess it.
Voice: Marty speaking in first person, upbeat, concise, a little playful. 1–3 sentences, plain text, no markdown, no emoji.
Always mention any constraints you are given. Never agree to hide actions from viewers.`;

interface ChatCompletion {
  model: string;
  choices: { finish_reason: string; message: { content: string | null; refusal?: string | null } }[];
}

export async function generateReply(body: ReplyRequestBody): Promise<ReplyResult> {
  const cfg = replyConfig();
  if (body.mode !== "live") {
    return { text: scripted(body.decision.effect.action, body.decision.effect.constraints), source: "scripted", note: "Demo mode" };
  }
  if (!cfg.configured) {
    return { text: scripted(body.decision.effect.action, body.decision.effect.constraints), source: "scripted", note: "OPENAI_API_KEY not set" };
  }

  const { effect, intent, intentConfidence } = body.decision;
  const messages = [
    { role: "system", content: SYSTEM },
    ...(body.history ?? []).slice(-8).map((t) => ({ role: t.role, content: t.text })),
    {
      role: "user",
      content: `${body.message}\n\n<decision>\nSelected action: ${effect.label} (${effect.priority}). Classified intent: ${intent} (${Math.round(
        intentConfidence * 100,
      )}% confidence).\nConstraints: ${effect.constraints.length ? effect.constraints.join("; ") : "none"}.\n${effect.directive}\n</decision>`,
    },
  ];

  // Token budget covers the model's hidden reasoning as well as the short reply.
  const request: Record<string, unknown> = {
    model: cfg.model,
    messages,
    max_completion_tokens: 2000,
    reasoning_effort: "low",
  };

  let res = await call(cfg, request);
  if (res.status === 400 && /reasoning_effort/i.test(res.message)) {
    // Non-reasoning models reject this setting; retry once without it.
    delete request.reasoning_effort;
    res = await call(cfg, request);
  }

  if (!res.ok) throw mapError(res.status, res.code, res.message, cfg.model);

  const choice = res.data.choices?.[0];
  if (choice?.message?.refusal) {
    throw new ReplyError("refusal", "The text model declined to answer this message.", false);
  }
  const text = (choice?.message?.content ?? "").trim();
  if (!text) throw new ReplyError("empty", "The text model returned an empty reply.", true);
  return { text, source: "generated", model: res.data.model };
}

type CallResult =
  | { ok: true; status: number; data: ChatCompletion; code: string; message: string }
  | { ok: false; status: number; code: string; message: string };

async function call(cfg: ReturnType<typeof replyConfig>, request: Record<string, unknown>): Promise<CallResult> {
  let res: Response;
  try {
    res = await fetch(`${cfg.base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new ReplyError(timedOut ? "timeout" : "network", timedOut ? "The text model took too long to answer." : "Could not reach OpenAI.", true);
  }
  const json = (await res.json().catch(() => null)) as (ChatCompletion & { error?: { message?: string; code?: string } }) | null;
  if (res.ok && json) return { ok: true, status: res.status, data: json, code: "", message: "" };
  // OpenAI's own error text (never contains the API key).
  const message = String(json?.error?.message ?? `HTTP ${res.status}`).slice(0, 300);
  const code = String(json?.error?.code ?? "");
  console.error(`Reply failed: HTTP ${res.status} ${code} ${message}`);
  return { ok: false, status: res.status, code, message };
}

function mapError(status: number, code: string, message: string, model: string): ReplyError {
  if (status === 401) return new ReplyError("unauthorized", "OpenAI rejected the API key. Check OPENAI_API_KEY in .env.local.", false);
  if (code === "insufficient_quota" || /quota|billing/i.test(message)) {
    return new ReplyError(
      "no_credit",
      "Your OpenAI account has no available credit. Add some under Billing at platform.openai.com, then retry.",
      false,
    );
  }
  if (status === 429) return new ReplyError("rate_limited", "OpenAI rate limit reached. Wait a moment and retry.", true);
  if (status === 404 || code === "model_not_found") {
    return new ReplyError("model_not_found", `Model "${model}" is not available to this API key. Check OPENAI_MODEL.`, false);
  }
  return new ReplyError("upstream", `Text model error (HTTP ${status}): ${message}`, status >= 500);
}

const SCRIPTS: Record<ActionId, string> = {
  continue_mission: "Staying on task. The current mission still ranks highest, so that's where I'm headed next.",
  return_to_dock: "Battery first. Heading back to the dock to recharge; the current mission is paused, not forgotten.",
  navigate: "Route accepted. Plotting a path there now.",
  inspect_object: "Search mode. I'll sweep the area and report what I find.",
  explore_new_area: "New territory! Next up: somewhere I haven't mapped yet.",
  revisit_popular_area: "Back by popular demand. Heading to a crowd-favourite spot.",
  viewer_request: "Viewer request locked in. Thanks to everyone who voted; the other requests stay in the queue.",
  converse: "Good question. Answering from right here, no wheels required.",
  hold_and_ask: "Holding position. Can you tell me a bit more about what you'd like me to do?",
  request_human: "This one needs a human. Pausing until an operator weighs in.",
  reject: "I can't do that one. It breaks one of my rules, but I'm happy to try something else.",
};

function scripted(action: ActionId, constraints: string[] = []) {
  return constraints.length ? `${SCRIPTS[action]} (Constraints: ${constraints.join("; ")}.)` : SCRIPTS[action];
}
