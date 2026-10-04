import type { Evaluate } from "../../decision/batch.ts";
import type { ChoiceAnswer, NoulAnswer, SystemOneRequest, SystemOneResponse } from "../../jev/types.ts";
import { BUILDING } from "../../twin/environment.ts";
import type { SayRequest } from "../../voice/openai.ts";
import { type LiveConfig, LiveSession } from "../session.ts";

export const building = BUILDING;

type Msg = { n: number; handle: string; text: string };

export interface FakeJevOptions {
  intent?: (m: Msg) => string;
  taxing?: (m: Msg) => number;
  /** Rank next_action options: higher = preferred. Default: earliest viewer request first, then stay. */
  rank?: (key: string, msgs: Msg[]) => number;
}

/** Test double for Jev: answers exactly the questions asked, from simple rules. Records every request. */
export function fakeJev(opts: FakeJevOptions = {}) {
  const calls: SystemOneRequest[] = [];
  const evaluate: Evaluate = async (req) => {
    calls.push(req);
    const msgs = ((req.state as { viewer_messages: Msg[] }).viewer_messages ?? []).map((m) => ({ ...m, handle: m.handle.replace(/^@/, "") }));
    const answers: SystemOneResponse["answers"] = {};
    for (const [name, q] of Object.entries(req.questions)) {
      const n = Number(name.split("_")[1]);
      const m = msgs.find((x) => x.n === n)!;
      if (name.startsWith("intent_")) {
        const choice = opts.intent?.(m) ?? (/\?$/.test(m.text) ? "question" : /^(hi|hello|lol|nice)\b/i.test(m.text) ? "chat" : "move");
        answers[name] = { type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } satisfies ChoiceAnswer;
      } else if (name.startsWith("taxing_")) {
        answers[name] = { type: "noul", noul: opts.taxing?.(m) ?? 0.1 } satisfies NoulAnswer;
      } else if (name === "next_action" && q.type === "choice") {
        const keys = Object.keys(q.criteria);
        const score = (k: string) => opts.rank?.(k, msgs) ?? (k.startsWith("p_") ? 10 - Number(k.slice(2)) : k === "continue" ? 11 : k === "stay" ? 1 : 0);
        const raw = keys.map((k) => Math.max(0.01, score(k)));
        const sum = raw.reduce((a, b) => a + b, 0);
        const probabilities = Object.fromEntries(keys.map((k, i) => [k, Math.round((raw[i] / sum) * 1000) / 1000]));
        const choice = keys.reduce((a, b) => (probabilities[b] > probabilities[a] ? b : a));
        answers[name] = { type: "choice", choice, confidence: probabilities[choice], probabilities };
      }
    }
    return { model: "jev-test-double", answers };
  };
  return { evaluate, calls };
}

/** Voice double: always the deterministic built-in line, so tests see exactly what fallbacks say. */
export const builtInVoice = async (r: SayRequest) => ({ text: r.fallback, source: "built-in" as const });

export function makeSession(o: { evaluate?: Evaluate | null; config?: Partial<LiveConfig>; voice?: typeof builtInVoice } = {}) {
  const clock = { t: 1_000_000 };
  const jev = fakeJev();
  const s = new LiveSession({
    building,
    evaluate: o.evaluate === undefined ? jev.evaluate : o.evaluate,
    jevModel: "jev-test",
    say: o.voice ?? builtInVoice,
    now: () => clock.t,
    seed: 3,
    // Bonuses far in the future unless a test asks for them, so point totals are predictable.
    config: { game: { spawnEverySec: [100_000, 100_000] }, ...o.config },
  });
  const run = async (seconds: number, stepMs = 100) => {
    for (let i = 0; i < (seconds * 1000) / stepMs; i++) {
      clock.t += stepMs;
      s.tick(clock.t);
      await s.settle();
    }
  };
  return { s, clock, run, jev };
}

export const martyLines = (s: LiveSession) =>
  s
    .snapshot()
    .chat.filter((c) => c.kind === "marty" && c.state === "done")
    .map((c) => (c as { text: string }).text);

export const systemLines = (s: LiveSession) =>
  s
    .snapshot()
    .chat.filter((c) => c.kind === "system")
    .map((c) => (c as { text: string }).text);
