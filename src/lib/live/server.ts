/**
 * The one live session for this server process. SERVER ONLY.
 *
 * Kept on globalThis so dev-mode reloads and every API route share the same
 * Marty. Ticks ten times a second. Jev, the text model and the baseball
 * knowledge service are the real ones; keys never leave the server.
 */
import { getBaseballKnowledge } from "../baseball/server";
import { evaluate, jevConfig } from "../jev/client";
import { batteryWithCapacity, DEFAULT_CAPACITY } from "../twin/battery";
import { ensureCatalog, onCatalogChange } from "../catalog/server";
import { BUILDING } from "../twin/environment";
import { martySay } from "../voice/openai";
import { LiveSession } from "./session";

const TICK_MS = 100;

const g = globalThis as unknown as { __martyLive?: { session: LiveSession; timer: ReturnType<typeof setInterval> } };

export function getLive(): LiveSession {
  if (g.__martyLive) return g.__martyLive.session;
  ensureCatalog();
  const jev = jevConfig();
  const session = new LiveSession({
    building: BUILDING,
    battery: batteryWithCapacity(batteryCapacity()),
    evaluate: jev.configured ? (body) => evaluate(body) : null,
    jevModel: jev.model,
    say: martySay,
    knowledge: async (req) => (await getBaseballKnowledge()?.bundle(req)) ?? null,
    now: () => Date.now(),
    seed: Date.now() % 100_000,
  });
  const timer = setInterval(() => {
    try {
      session.tick(Date.now());
    } catch (err) {
      console.error("Live tick failed:", err);
    }
  }, TICK_MS);
  timer.unref?.();
  onCatalogChange(() => session.catalogChanged());
  g.__martyLive = { session, timer };
  return session;
}

/** Operator controls are open unless OPERATOR_KEY is set; then the key must match. */
export function operatorAllowed(key: unknown): boolean {
  const want = process.env.OPERATOR_KEY || "";
  if (!want) return true;
  if (typeof key !== "string" || key.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= key.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

export const operatorKeyRequired = () => !!process.env.OPERATOR_KEY;

/** BATTERY_CAPACITY in .env.local: how many times bigger than the baseline battery (default 100). */
export function batteryCapacity(): number {
  const n = Number(process.env.BATTERY_CAPACITY);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAPACITY;
}
