/**
 * Twin context sent with a decide request so the decision engine knows the
 * simulated robot state and what the room contains. Shared by client and server.
 */
import { ENVIRONMENT } from "./environment.ts";

export interface TwinContext {
  pose: { x: number; y: number; headingDeg: number };
  moving: boolean;
  /** Name of the current destination, if a mission is active. */
  destination: string | null;
}

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Sanitise an untrusted twin context from the browser. Returns null when absent. */
export function parseTwin(v: unknown): TwinContext | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Partial<TwinContext>;
  const p = (t.pose ?? {}) as Partial<TwinContext["pose"]>;
  return {
    pose: {
      x: Math.round(num(p.x, 0, ENVIRONMENT.width, 0) * 100) / 100,
      y: Math.round(num(p.y, 0, ENVIRONMENT.height, 0) * 100) / 100,
      headingDeg: Math.round(num(p.headingDeg, -360, 360, 0)),
    },
    moving: t.moving === true,
    destination: typeof t.destination === "string" ? t.destination.slice(0, 80) : null,
  };
}

/** Catalog summary included in Jev's `state` (names only; the catalog is fictional). */
export function catalogForModel() {
  return ENVIRONMENT.cards.map((c) => ({ id: c.id, name: c.name, year: c.year }));
}
