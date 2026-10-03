/**
 * Conversational reply generation (OpenAI), independent of the decision engine.
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

const SYSTEM = `You are the conversational layer of "Jev Decision Studio", a demo app.
A separate decision engine has already classified the user's latest message and chosen an action.
Follow the operator directive exactly. Keep replies short: 1-4 sentences, plain text, no markdown headings.
You are a demo assistant with no access to accounts, orders or tools; never claim to have taken real-world actions.
If the action is an escalation, say a human teammate would take over in a real deployment.`;

interface ChatCompletion {
  model: string;
  choices: { finish_reason: string; message: { content: string | null; refusal?: string | null } }[];
}

export async function generateReply(body: ReplyRequestBody): Promise<ReplyResult> {
  const cfg = replyConfig();
  if (body.mode !== "live") {
    return { text: scripted(body.decision.effect.action), source: "scripted", note: "Demo mode" };
  }
  if (!cfg.configured) {
    return { text: scripted(body.decision.effect.action), source: "scripted", note: "OPENAI_API_KEY not set" };
  }

  const { effect, intent, intentConfidence } = body.decision;
  const messages = [
    { role: "system", content: SYSTEM },
    ...(body.history ?? []).slice(-8).map((t) => ({ role: t.role, content: t.text })),
    {
      role: "user",
      content: `${body.message}\n\n<operator_directive>\nSelected action: ${effect.label} (${effect.priority}). Intent: ${intent} (${Math.round(
        intentConfidence * 100,
      )}% confidence).\n${effect.directive}\n</operator_directive>`,
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
  answer: "Here's where a direct answer would go. The decision engine routed this as a question, so the reply focuses on explaining clearly and concisely.",
  execute: "On it — this was routed as a task. In a full deployment, the assistant would now carry out the request or lay out the concrete steps.",
  troubleshoot: "Sorry that's not working. This was routed to troubleshooting: the next reply would walk through the likely causes and what to check first.",
  deescalate: "I'm sorry — that's genuinely frustrating, and I want to make it right. This was routed to de-escalation, so the reply leads with ownership and a concrete fix.",
  acknowledge: "Thank you — that's really useful. This was routed as feedback, so it's acknowledged and logged rather than acted on.",
  converse: "Hey! Good to hear from you. This was classified as small talk, so the reply stays light and invites you to keep going.",
  clarify: "Happy to help — could you tell me a bit more about what you need? The engine judged the message too vague to act on yet.",
  escalate: "I hear you. This has been flagged for a human teammate, who would take over from here in a real deployment.",
};

function scripted(action: ActionId) {
  return SCRIPTS[action];
}
