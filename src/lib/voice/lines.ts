/**
 * Marty's voice: the facts a reply must respect, plus built-in lines with the
 * same personality, used when no text model is configured (or it fails).
 * Shared by client and server; no secrets.
 */
import type { Mission } from "../twin/controller";

export type OutcomeStatus = "moving" | "arrived" | "needs_clarification" | "no_route" | "rejected" | "answered" | "stopped" | "error";

/** Ground truth from the navigation system for one request. The voice may not contradict it. */
export interface Outcome {
  status: OutcomeStatus;
  request: string;
  /** Mission number, used to vary built-in lines deterministically. */
  seq: number;
  target?: string;
  routeMeters?: number;
  detour?: boolean;
  /** Clarification options (card names). */
  options?: string[];
  /** Word that matched several cards, e.g. "bonds". */
  matched?: string;
  /** Deterministic explanation from the controller. */
  facts: string;
}

const REPORTABLE: OutcomeStatus[] = ["moving", "arrived", "needs_clarification", "no_route", "rejected", "answered", "stopped", "error"];

/** Outcome for a mission once it has something to report, else null (still thinking, or superseded). */
export function outcomeOf(m: Mission): Outcome | null {
  if (!REPORTABLE.includes(m.status as OutcomeStatus)) return null;
  const res = m.resolution;
  return {
    status: m.status as OutcomeStatus,
    request: m.request,
    seq: m.seq,
    ...(m.target ? { target: m.target.name } : {}),
    ...(m.plan?.status === "ok" ? { routeMeters: m.plan.length, detour: m.plan.detour } : {}),
    ...(m.clarify ? { options: m.clarify.options.map((o) => o.name) } : {}),
    ...(res?.status === "ambiguous" ? { matched: res.matched } : {}),
    facts: m.error ? `${m.explanation} (${m.error.message})` : m.explanation,
  };
}

const pick = <T,>(list: T[], seq: number) => list[Math.abs(seq) % list.length];

/** A complete reply in Marty's voice, built from the facts alone. */
export function builtInReply(o: Outcome, knownCards: string[]): string {
  const t = o.target ?? "there";
  const m = o.routeMeters !== undefined ? `${o.routeMeters} meters` : "a short hop";
  switch (o.status) {
    case "moving":
      return pick(
        [
          `Off to ${t}. ${m}${o.detour ? ", taking the scenic route because the furniture refuses to move." : ", straight shot. Try to contain your excitement."}`,
          `${t}? Excellent taste. Plotting ${m}${o.detour ? " around the obstacles, since driving through walls is still in beta." : " in a straight line, like a professional."}`,
          `On my way to ${t}. ${m} of pure, uninterrupted competence${o.detour ? ", with a detour for dramatic effect" : ""}.`,
        ],
        o.seq,
      );
    case "arrived":
      return arrivalLine(t, o.seq);
    case "needs_clarification":
      if (o.options?.length) {
        return `"${o.matched ?? o.request}" could mean ${o.options.join(" or ")}. I'm a robot, not a mind reader. Which one?`;
      }
      return pick(
        [
          `I looked. Twice. Nothing here matches that. On the wall I've got ${knownCards.slice(0, 4).join(", ")} and friends.`,
          `I'm going to need a little more than that. Name a card and I'm gone.`,
        ],
        o.seq,
      );
    case "no_route":
      return pick(
        [
          `I'd love to visit ${t}, but every route goes through something solid, and I don't do heists. Pick another card?`,
          `${t} is unreachable from here. Locked away, much like my feelings. Want to try a different card?`,
        ],
        o.seq,
      );
    case "rejected":
      return `That's a hard pass. I have rules, and that request breaks one. Ask me to visit a card instead?`;
    case "answered": {
      const list = `${knownCards.slice(0, -1).join(", ")} and ${knownCards.at(-1)}`;
      return pick(
        [
          `I'm better at driving than small talk. On the walls: ${list}. Name one and I'm gone.`,
          `My conversational module is on a coffee break, but my wheels work great. I can visit ${list}, the nearest card, or the other side of the room.`,
        ],
        o.seq,
      );
    }
    case "stopped":
      return pick(["Stopped. Standing perfectly still, which I'm told is my best look.", "Brakes on. Holding position and looking dignified about it."], o.seq);
    case "error":
      return `My brain isn't answering right now, which is honestly relatable. Give it a second and hit retry.`;
  }
}

/** Short line appended when a mission finishes after the reply was written. */
export function arrivalLine(target: string, seq: number) {
  return pick(
    [`Arrived at ${target}. Please hold your applause.`, `${target}, as requested. I'd tip my cap if I had one.`, `Made it to ${target}. Zero collisions, mild smugness.`],
    seq,
  );
}

export function afterLine(status: string, target: string | undefined, seq: number): string | null {
  if (status === "arrived") return arrivalLine(target ?? "the spot", seq);
  if (status === "stopped") return "Stopped mid-route. Dramatic, but fine.";
  if (status === "cancelled") return "Change of plans. I'm flexible like that.";
  return null;
}
