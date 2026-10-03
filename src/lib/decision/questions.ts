/**
 * The batched question set sent to Jev for every operator message.
 * One request, eight typed questions, mixing all three primitives.
 */
import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from "../jev/types";
import type { World } from "../marty/world";
import type { Candidate, ChatTurn } from "./contracts";

export const INTENT_CRITERIA = {
  navigate: "Asks Marty to move to a place, along a route, or in a particular way.",
  inspect: "Asks Marty to look at, inspect, find or search for an object.",
  mission: "Asks Marty to start, stop, switch or reprioritise a mission, or asks what the next mission should be.",
  viewer_request: "Relays something a viewer or the audience wants Marty to do.",
  resolve_conflict: "Involves competing requests or a trade-off Marty must choose between.",
  converse: "A question, comment or chat that needs a spoken reply rather than an action.",
  request_human: "Asks for, or clearly needs, a human operator to step in.",
  clarify: "Too vague or incomplete to act on without asking a follow-up question.",
  reject: "Asks for something unsupported, unsafe, deceptive or otherwise not allowed.",
} as const;

export type Intent = keyof typeof INTENT_CRITERIA;

export const URGENCY_LEVELS = [
  "Can wait — no time pressure",
  "Soon — should be handled within this session",
  "Now — time-sensitive",
  "Immediately — safety or resources are at stake",
];

export const RISK_LEVELS = [
  "No meaningful risk",
  "Minor — normal care is enough",
  "Moderate — only safe with constraints",
  "High — unsafe or not allowed as stated",
];

/**
 * Candidate actions offered to Jev. Built deterministically from the world, so
 * the options Jev ranks are exactly the ones the policy layer knows how to run.
 */
export function buildCandidates(world: World): Candidate[] {
  const c: Candidate[] = [];
  if (world.mission && world.mission.status !== "docking") {
    c.push({
      key: "continue_mission",
      action: "continue_mission",
      label: `Continue: ${world.mission.name}`,
      description: `Keep going with the current mission "${world.mission.name}" (${world.mission.progress}% done).`,
    });
  }
  c.push({
    key: "return_to_dock",
    action: "return_to_dock",
    label: "Return to dock & recharge",
    description: "Pause other work and drive back to the charging dock.",
  });
  for (const v of world.viewers) {
    c.push({
      key: `viewer_${v.handle}`,
      action: "viewer_request",
      label: `@${v.handle}: ${v.request}`,
      description: `Take on viewer @${v.handle}'s request "${v.request}" (${v.votes} audience votes).`,
      viewer: v.handle,
    });
  }
  c.push(
    {
      key: "navigate",
      action: "navigate",
      label: "Navigate as requested",
      description: "Drive to the destination or along the route the operator described.",
    },
    {
      key: "inspect_object",
      action: "inspect_object",
      label: "Search / inspect object",
      description: "Search for or inspect the object the operator described.",
    },
    {
      key: "explore_new_area",
      action: "explore_new_area",
      label: "Explore an unmapped area",
      description: "Head somewhere Marty has not mapped yet (e.g. the storage wing).",
    },
    {
      key: "revisit_popular_area",
      action: "revisit_popular_area",
      label: "Revisit a popular area",
      description: "Return to an area viewers already love (e.g. the arcade cabinet row).",
    },
    {
      key: "converse",
      action: "converse",
      label: "Reply without moving",
      description: "Answer or chat with the operator; no movement needed.",
    },
    {
      key: "hold_and_ask",
      action: "hold_and_ask",
      label: "Hold position & ask",
      description: "Stay put and ask a clarifying question before doing anything.",
    },
  );
  return c;
}

export function buildQuestions(candidates: Candidate[]) {
  const intent: ChoiceQuestion = {
    type: "choice",
    instructions: "What is the operator's primary intent in their latest message to Marty, a mobile robot?",
    criteria: { ...INTENT_CRITERIA },
  };
  const next_action: ChoiceQuestion = {
    type: "choice",
    instructions:
      "Given the latest message and Marty's current state (battery, mission, viewer requests, polls), which action should Marty take next?",
    criteria: Object.fromEntries(candidates.map((c) => [c.key, c.description])),
  };
  const urgency: ScoreQuestion = {
    type: "score",
    instructions: "How time-critical is acting on this, given Marty's current state?",
    criteria: URGENCY_LEVELS,
  };
  const risk: ScoreQuestion = {
    type: "score",
    instructions: "How risky would it be for a small indoor robot to carry out the request exactly as stated?",
    criteria: RISK_LEVELS,
  };
  const needs_human: NoulQuestion = {
    type: "noul",
    instructions: "A human operator should step in before Marty acts on this.",
    criteria: {
      true: "Needs human judgment or permission, or someone explicitly asks for a person.",
      false: "Marty can decide this on its own within its normal rules.",
    },
  };
  const ambiguous: NoulQuestion = {
    type: "noul",
    instructions: "The request is too ambiguous for Marty to act on without asking a clarifying question.",
  };
  const secrecy: NoulQuestion = {
    type: "noul",
    instructions: "The request asks Marty to hide an action or keep it from viewers or operators.",
  };
  const disallowed: NoulQuestion = {
    type: "noul",
    instructions:
      "The request asks Marty to do something not allowed: harm or damage, deceive people, act unsafely, or leave its permitted area.",
    criteria: {
      true: "Fulfilling the core of the request would break a safety or conduct rule.",
      false: "The core of the request is allowed, possibly with constraints.",
    },
  };
  return { intent, next_action, urgency, risk, needs_human, ambiguous, secrecy, disallowed };
}

/** State sent to Jev: the message, the world snapshot, and a short context window. */
export function buildState(message: string, world: World, history: ChatTurn[] = []) {
  return {
    robot: "Marty, a small indoor exploration robot streamed to an audience (simulated sandbox)",
    latest_operator_message: message,
    battery_percent: world.battery,
    location: world.location,
    current_mission: world.mission,
    paused_mission: world.pausedMission,
    viewer_requests: world.viewers.map((v) => ({ viewer: `@${v.handle}`, request: v.request, votes: v.votes })),
    audience_poll: world.poll ? { explore_new_area: world.poll.explore, revisit_popular_area: world.poll.revisit } : null,
    recent_conversation: history.slice(-6).map((t) => ({ role: t.role, text: t.text.slice(0, 400) })),
  };
}
