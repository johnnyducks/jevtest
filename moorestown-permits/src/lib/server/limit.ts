/**
 * A small in-memory rate limiter (fixed window per key). Enough to keep one
 * browser from running up the AI bill on a single-server demo.
 */
const windows = new Map<string, { start: number; count: number }>();

export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    }
    return true;
  }
  if (w.count >= max) return false;
  w.count++;
  return true;
}

/** Best-effort client address for rate limiting. */
export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
