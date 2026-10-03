/**
 * The batched question set sent to Jev for every chat message.
 * One request, five typed questions, mixing all three primitives.
 */
import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from "../jev/types";
import type { ChatTurn } from "./contracts";

export const INTENT_CRITERIA = {
  question: "Asking for information, an explanation, or how something works.",
  task: "Asking the assistant to create, write, change, plan, or do something.",
  problem: "Reporting a bug, an error, or something that is not working.",
  complaint: "Expressing dissatisfaction, frustration, or a grievance about a product or service.",
  feedback: "Sharing praise, an opinion, or a suggestion without asking for anything.",
  smalltalk: "A greeting, thanks, or casual social chat.",
} as const;

export type Intent = keyof typeof INTENT_CRITERIA;

export const URGENCY_LEVELS = [
  "Can wait — no time pressure",
  "Should be handled soon",
  "Needs attention today",
  "Critical — something is blocked or causing harm right now",
];

export const SENTIMENT_LEVELS = ["Very negative", "Negative", "Neutral", "Positive", "Very positive"];

export function buildQuestions() {
  const intent: ChoiceQuestion = {
    type: "choice",
    instructions: "What is the user's primary intent in their latest message?",
    criteria: { ...INTENT_CRITERIA },
  };
  const urgency: ScoreQuestion = {
    type: "score",
    instructions: "How urgent is the user's latest message?",
    criteria: URGENCY_LEVELS,
  };
  const sentiment: ScoreQuestion = {
    type: "score",
    instructions: "What is the emotional tone of the user's latest message?",
    criteria: SENTIMENT_LEVELS,
  };
  const escalate: NoulQuestion = {
    type: "noul",
    instructions: "This conversation should be handed to a human rather than an automated assistant.",
    criteria: {
      true: "Needs human judgment, authority, account access, or the user is very upset or explicitly asks for a person.",
      false: "An automated assistant can handle this well.",
    },
  };
  const clarify: NoulQuestion = {
    type: "noul",
    instructions: "The latest message is too vague to act on without asking a clarifying question.",
  };
  return { intent, urgency, sentiment, escalate, clarify };
}

export type QuestionSet = ReturnType<typeof buildQuestions>;

/** State is a JSON object: the latest message plus a short window of context. */
export function buildState(message: string, history: ChatTurn[] = []) {
  return {
    latest_user_message: message,
    recent_conversation: history.slice(-6).map((t) => ({ role: t.role, text: t.text.slice(0, 600) })),
  };
}
