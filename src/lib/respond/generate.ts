/**
 * Conversational reply generation, independent of the decision engine.
 * It receives only the selected effect, never raw probabilities to re-interpret.
 * SERVER ONLY.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ActionId, ReplyRequestBody, ReplyResult } from "../decision/contracts";

export function replyConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  return { apiKey, configured: apiKey.length > 0, model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5" };
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

export async function generateReply(body: ReplyRequestBody): Promise<ReplyResult> {
  const cfg = replyConfig();
  if (body.mode !== "live") {
    return { text: scripted(body.decision.effect.action), source: "scripted", note: "Demo mode" };
  }
  if (!cfg.configured) {
    return {
      text: scripted(body.decision.effect.action),
      source: "scripted",
      note: "ANTHROPIC_API_KEY not set",
    };
  }

  const client = new Anthropic({ apiKey: cfg.apiKey, maxRetries: 1, timeout: 30_000 });
  const history = (body.history ?? []).slice(-8).map((t) => ({ role: t.role, content: t.text }) as const);
  const { effect, intent, intentConfidence } = body.decision;

  try {
    const response = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: 1024,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [
        ...mergeRoles(history),
        {
          role: "user",
          content: `${body.message}\n\n<operator_directive>\nSelected action: ${effect.label} (${effect.priority}). Intent: ${intent} (${Math.round(
            intentConfidence * 100,
          )}% confidence).\n${effect.directive}\n</operator_directive>`,
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      throw new ReplyError("refusal", "The text model declined to answer this message.", false);
    }
    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    if (!text) throw new ReplyError("empty", "The text model returned an empty reply.", true);
    return { text, source: "claude", model: response.model };
  } catch (err) {
    if (err instanceof ReplyError) throw err;
    if (err instanceof Anthropic.AuthenticationError) {
      throw new ReplyError("unauthorized", "Anthropic rejected the API key.", false);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new ReplyError("rate_limited", "Text model rate limit reached.", true);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new ReplyError("network", "Could not reach the text model.", true);
    }
    if (err instanceof Anthropic.APIError) {
      throw new ReplyError("upstream", `Text model error (HTTP ${err.status ?? "?"}).`, (err.status ?? 500) >= 500);
    }
    throw new ReplyError("unknown", "Reply generation failed.", true);
  }
}

/** The Messages API expects alternating roles starting with "user". */
function mergeRoles(turns: { role: "user" | "assistant"; content: string }[]) {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const t of turns) {
    if (!out.length && t.role !== "user") continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += `\n\n${t.content}`;
    else out.push({ ...t });
  }
  if (out.length && out[out.length - 1].role === "user") out.pop();
  return out;
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
