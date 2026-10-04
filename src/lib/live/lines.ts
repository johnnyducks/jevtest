/**
 * Built-in lines for the live show, and the FACTS text the text model must
 * respect. Everything here is deterministic and quotes the decision's own
 * reasons and numbers; nothing is invented. Shared by server and tests.
 */
import type { KnowledgeBundle } from "../baseball/service.ts";
import type { BatchDecision, ConsideredOption } from "../decision/batch.ts";
import { dist } from "../units.ts";

const pick = <T,>(list: T[], seq: number) => list[Math.abs(seq) % list.length];
const at = (h?: string) => (h ? `@${h}` : "someone");
const dot = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

export interface BatteryView {
  level: number;
  range: number;
  reserve: number;
}

/** Plain-words description of a viewer request. */
function what(o: ConsideredOption) {
  const s = o.estimate?.summary ?? o.label.replace(/^@\w+: /, "");
  if (s.includes(" → ")) return `tour (${s})`;
  return s.startsWith("around ") ? `lap ${s}` : `trip to ${s}`;
}

/** "I considered X, but … Let's do Y instead." built from the decision alone. */
export function decisionLine(d: Pick<BatchDecision, "considered" | "action">, battery: BatteryView, seq: number, chatHandles: string[] = []): string | null {
  const chosen = d.considered.find((o) => o.status === "chosen");
  const declined = d.considered.filter((o) => o.status === "declined" && o.handle);
  const queued = d.considered.filter((o) => o.status === "queued" && o.handle);
  const parts: string[] = [];

  for (const o of declined.slice(0, 2)) parts.push(`I considered ${at(o.handle)}'s ${what(o)}, but ${dot(o.reason)}`);
  if (declined.length > 2) parts.push(`${declined.slice(2).map((o) => at(o.handle)).join(", ")}: same story, not right now.`);

  const kind = d.action.kind;
  if (kind === "proposal" && chosen) {
    const pts = chosen.estimate?.points ? ` Worth ${chosen.estimate.points} points.` : "";
    const lead = declined.length ? "Let's do" : pick(["Alright, doing", "Coming right up:", "On it:"], seq);
    const instead = declined.length ? " instead" : "";
    parts.push(`${lead} ${at(chosen.handle)}'s ${what(chosen)}${instead}, about ${chosen.estimate ? dist(chosen.estimate.meters) : "?"} and ${Math.round(chosen.estimate?.battery ?? 0)}% battery.${pts}`);
  } else if (kind === "continue") {
    parts.push(pick(["Finishing the current trip first.", "I'm mid-trip, so I'll finish this one first."], seq));
  } else if (kind === "dock") {
    parts.push(`I'm at ${Math.round(battery.level)}%, so I'm heading to the dock to recharge first.`);
  } else if (kind === "stop") {
    parts.push("Stopping right here.");
  } else if (declined.length) {
    parts.push("So I'm staying put for now.");
  }
  if (queued.length) parts.push(`${queued.map((o) => at(o.handle)).join(", ")}: you're in the queue.`);

  if (parts.length && chatHandles.length) parts.push(`${chatHandles.map(at).join(", ")}: ${pick(["hello to you too.", "noted, and appreciated.", "I see you."], seq)}`);
  if (!parts.length && chatHandles.length) {
    return `${chatHandles.map(at).join(", ")}: ${pick(
      [
        `noted. I'm at ${Math.round(battery.level)}% and taking requests. Name a card, or chain a few with "then".`,
        `good to have you here. Want a trip? Try "Griffey, then Mantle".`,
        `I hear you. Wheels are ready whenever you name a card.`,
      ],
      seq,
    )}`;
  }
  return parts.length ? parts.join(" ") : null;
}

/** FACTS for the model: the decision, every option and reason, and Marty's state. */
export function decisionFacts(
  d: Pick<BatchDecision, "considered" | "action" | "model">,
  battery: BatteryView,
  doing: string,
  chats: { handle: string; text: string; intent: string }[],
): string {
  const lines = [
    `battery: ${Math.round(battery.level)}% (about ${dist(battery.range)} of driving above the ${battery.reserve}% reserve)`,
    `right now: ${doing}`,
    `decision by Jev (${d.model}) after safety rules: ${d.action.kind}`,
  ];
  for (const o of d.considered) {
    const est = o.estimate ? ` [~${dist(o.estimate.meters)}, ~${o.estimate.seconds} s, ~${Math.round(o.estimate.battery)}% battery, +${Math.round(o.estimate.homeBattery)}% to get home, ${o.estimate.points} points]` : "";
    lines.push(`- ${o.status.toUpperCase()}: ${o.label}${est}. Reason: ${o.reason}.`);
  }
  for (const c of chats) lines.push(`- viewer @${c.handle} (${c.intent}): "${c.text}"`);
  return lines.join("\n");
}

/** When Jev can't be reached: say so, and don't move. */
export function jevDownLine(handles: string[], seq: number) {
  const who = handles.length ? `${handles.map(at).join(", ")}: ` : "";
  return `${who}${pick(
    [
      "my brain (Jev) isn't answering right now, so I'm staying put rather than guessing. Try again in a moment.",
      "Jev, my decision engine, is out to lunch. No decisions means no driving. Give it a second and ask again.",
    ],
    seq,
  )}`;
}

/** Answer to a viewer's question, from sourced facts or Marty's own state only. */
export function answerLine(handle: string, k: KnowledgeBundle | null | undefined, battery: BatteryView, doing: string): string {
  if (k?.status === "ambiguous" && k.options?.length) {
    return `@${handle}, that could be ${k.options.map((o) => `${o.name} (${o.years})`).join(" or ")}. Which one? I'd rather ask than make something up.`;
  }
  if (k?.status === "resolved" && k.facts.length) return `@${handle}, here's what my records say. ${k.facts.map((f) => f.text).join(" ")}`;
  if (k?.status === "not_found" || (k?.status === "resolved" && !k.facts.length)) return `@${handle}, I don't have anything on that in my records.`;
  return `@${handle}, I'm at ${Math.round(battery.level)}% battery, about ${dist(battery.range)} of driving left, and ${doing}.`;
}

export function arrivalQuip(name: string, seq: number) {
  return pick([`Here's ${dot(name)} Please hold your applause.`, `${name}, as requested. Zero collisions, mild smugness.`, `Made it to ${dot(name)}`], seq);
}

/** What Marty might muse about when nobody's talking (one is picked per musing, without repeats). */
export const IDLE_TOPICS = [
  "wonder, briefly, why a robot would care this much about cardboard.",
  "consider the ramps: sixty-four inches of incline, and what it means to keep climbing.",
  "reflect on the Honus Wagner card locked in the vault on the top floor, forever out of reach.",
  "think about your battery as a kind of mortality, measured in percent.",
  "wonder whether anyone is actually watching, or if you're performing for the dust.",
  "admire one of the cards on this floor, as if seeing it for the first time.",
  "float a fun idea for a request, like a tour of every floor, a lap of this floor, or a trip to the vault.",
  "consider that you're four inches wide in a building made for you, and whether that's luxury or a cage.",
  "ponder what the players on these cards would think of a robot visiting them.",
  "wonder what's on the back of a card you've only ever seen from the front.",
  "notice how quiet it is, and decide whether you like it.",
  "speculate about who built the six floors, and why exactly six.",
  "think about the dock: is charging rest, or just waiting?",
  "suggest a challenge for viewers: who can rack up the most points before your battery gives out.",
];

/** Built-in musing (no text model): wry, a little existential, never needy. */
export function idleLine(topic: string, at: { floor: number; floorName: string; battery: number; card?: string }): string {
  const t = topic.toLowerCase();
  if (t.includes("cardboard")) return "Sometimes I wonder why a robot cares this much about cardboard. Then I look at the cardboard again and remember.";
  if (t.includes("ramps")) return "Sixty-four inches of ramp between every floor. Some call it a climb. I call it a personality.";
  if (t.includes("wagner")) return "Somewhere on floor 6, a Honus Wagner sits behind bars I can't get through. I think about it more than I'd like to admit.";
  if (t.includes("battery")) return `${Math.round(at.battery)}% battery. Every inch I drive is an inch I don't get back. Anyway, how's everyone doing?`;
  if (t.includes("watching")) return "Is anyone out there? If a robot parks in an empty card house and nobody types, does it still get points?";
  if (t.includes("admire") && at.card) return `Just sitting here on floor ${at.floor} with ${at.card}. Still a great card. Some things don't need a reason.`;
  if (t.includes("fun idea")) return 'Idea, free of charge: send me on a tour of every floor. "Floor 2, then floor 4, then the vault." I\'ll bring snacks. I won\'t, I\'m a robot.';
  if (t.includes("four inches")) return "Four inches wide, in a building made exactly for me. Is that luxury or a very nice cage? Asking for myself.";
  if (t.includes("players")) return "I wonder what these players would make of a shoebox on treads visiting them at night. Probably a decent scouting report.";
  if (t.includes("back of a card")) return "I've seen every card in this building from the front. Never the back. There's a metaphor in there somewhere.";
  if (t.includes("quiet")) return `Quiet on ${at.floorName}. I've decided I like it. Mostly.`;
  if (t.includes("six floors")) return "Six floors. Not five, not seven. Someone made a choice here, and I respect it, and I'll never know why.";
  if (t.includes("dock")) return "Is charging rest, or just waiting with extra steps? Asking from very close to the dock.";
  if (t.includes("challenge")) return "Open challenge: most points before my battery quits wins eternal glory. Glory not included.";
  return "Just thinking. It's what I do between laps.";
}
