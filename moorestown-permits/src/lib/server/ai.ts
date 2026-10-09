/**
 * Claude calls: the homeowner Q&A (streamed text) and the staff intake review
 * (structured JSON). Server-only; the API key never reaches the browser.
 *
 * Requests opt into server-side refusal fallbacks ("default" routing), so a
 * request a safety classifier declines is retried on Anthropic's recommended
 * fallback model inside the same call.
 */
import Anthropic from "@anthropic-ai/sdk";
import { type AiReview, type Application } from "../permits/application.ts";
import { KB } from "../permits/kb.ts";
import { DISC, projectNames, QUESTIONS } from "../permits/projects.ts";
import { OFFICE_PHONE } from "../permits/links.ts";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export const aiConfigured = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

/* ---------- Homeowner Q&A ---------- */

const ASK_SYSTEM = `You answer homeowner questions for the Moorestown Township, NJ Construction Office permit portal. Use only the guide below. Be warm, plain and brief: 2 to 5 short sentences, no headings, no bullet lists unless listing forms. If the answer depends on specifics, say so and suggest calling the office. Never state a fee amount. Don't invent rules.

GUIDE:
${KB}`;

export const ASK_FALLBACK = `Couldn't get an answer just now. Call the office at ${OFFICE_PHONE}.`;

/** Streams the answer as plain text. */
export function askStream(question: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      let sent = false;
      try {
        const stream = getClient().beta.messages.stream(
          {
            model: MODEL,
            max_tokens: 2000,
            betas: [FALLBACK_BETA],
            fallbacks: "default",
            output_config: { effort: "low" },
            system: ASK_SYSTEM,
            messages: [{ role: "user", content: question }],
          },
          { signal },
        );
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(enc.encode(event.delta.text));
            sent = true;
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          controller.enqueue(enc.encode(sent ? `\n\n${ASK_FALLBACK}` : ASK_FALLBACK));
        }
      } catch (e) {
        if (!signal.aborted) {
          console.error("ask failed:", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
          controller.enqueue(enc.encode(sent ? `\n\n${ASK_FALLBACK}` : ASK_FALLBACK));
        }
      }
      controller.close();
    },
  });
}

/* ---------- Staff intake review ---------- */

const REVIEW_SYSTEM = `You assist a plans examiner at the Moorestown Township, New Jersey Construction Office with intake of residential permit applications under the NJ Uniform Construction Code (N.J.A.C. 5:23). Review the application for completeness and routing. Be practical and specific; do not invent facts about the property. The examiner makes all decisions.

Field guidance:
- completeness: 0 to 100.
- summary: one or two sentences on what this application is and its overall state.
- rehabCite: the N.J.A.C. citation for the category.
- priorApprovals: e.g. "Zoning", "Floodplain administrator"; empty if none.
- missing: each item a short name and a short reason.
- flags: short notes on code or licensing concerns worth a closer look (e.g. contractor doing trade work without license info, owner-prepared plans on a non-owner-occupied home, cost that looks low for the scope, scope answers marked "Not sure").
- nextStep: one sentence for the examiner.
- messageToApplicant: a short, friendly, plain-language message (under 90 words) the examiner could send, listing what's needed or what happens next. Sign it "Moorestown Construction Office".

Office reference:
${KB}`;

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["completeness", "summary", "rehabCategory", "rehabCite", "disciplines", "priorApprovals", "routeTo", "missing", "flags", "nextStep", "suggestedStatus", "messageToApplicant"],
  properties: {
    completeness: { type: "integer" },
    summary: { type: "string" },
    rehabCategory: { type: "string", enum: ["Ordinary maintenance", "Repair", "Renovation", "Alteration", "Reconstruction", "Addition / new construction"] },
    rehabCite: { type: "string" },
    disciplines: { type: "array", items: { type: "string", enum: ["Building", "Electrical", "Plumbing", "Mechanical", "Fire"] } },
    priorApprovals: { type: "array", items: { type: "string" } },
    routeTo: { type: "string", enum: ["Zoning", "Plan review", "Return to applicant"] },
    missing: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["item", "why"], properties: { item: { type: "string" }, why: { type: "string" } } },
    },
    flags: { type: "array", items: { type: "string" } },
    nextStep: { type: "string" },
    suggestedStatus: { type: "string", enum: ["screening", "zoning", "review", "info"] },
    messageToApplicant: { type: "string" },
  },
} as const;

/** What the model sees: the application without ids, history or prior reviews. */
export function reviewPayload(a: Application) {
  return {
    ref: a.ref,
    projects: projectNames(a.projects),
    description: a.description,
    estimatedCost: a.cost,
    address: a.address,
    ownerOccupiedSingleFamily: a.answers.ownerOcc,
    workBy: a.answers.doer,
    contractor: a.contractor || null,
    plansBy: a.answers.plansBy,
    scopeAnswers: Object.fromEntries(QUESTIONS.filter((q) => a.answers[q.k]).map((q) => [q.t, a.answers[q.k]])),
    portalAssessment: { ...a.plan, disc: a.plan.disc.map((k) => DISC[k][0]) },
    documents: a.plan.docs.map((d) => ({ item: d.n, markedReady: !!a.docs[d.id]?.ready, files: a.docs[d.id]?.files ?? [] })),
  };
}

export class ReviewError extends Error {}

export async function reviewApplication(a: Application): Promise<AiReview> {
  const res = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: REVIEW_SCHEMA } },
    system: REVIEW_SYSTEM,
    messages: [{ role: "user", content: `Application (JSON):\n${JSON.stringify(reviewPayload(a), null, 1)}` }],
  });
  if (res.stop_reason === "refusal") throw new ReviewError("The review was declined. Review this one by hand.");
  if (res.stop_reason === "max_tokens") throw new ReviewError("The review was cut off. Try again.");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let out: Omit<AiReview, "at" | "model">;
  try {
    out = JSON.parse(text);
  } catch {
    throw new ReviewError("The review didn't come back cleanly. Try again.");
  }
  return { ...out, completeness: Math.max(0, Math.min(100, Math.round(Number(out.completeness) || 0))), at: Date.now(), model: res.model };
}
