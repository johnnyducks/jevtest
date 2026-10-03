import type { ApiErrorBody, ChatTurn, Mode } from "./decision/contracts";
import { MAX_MESSAGE_CHARS } from "./decision/contracts";

export function errorResponse(status: number, code: string, message: string, retryable = false, detail?: unknown) {
  const body: ApiErrorBody = { error: { code, message, retryable, ...(detail !== undefined ? { detail } : {}) } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseMessage(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= MAX_MESSAGE_CHARS ? t : null;
}

export function parseMode(v: unknown): Mode | null {
  return v === "live" || v === "demo" ? v : null;
}

export function parseHistory(v: unknown): ChatTurn[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (t): t is ChatTurn =>
        !!t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text.length > 0,
    )
    .slice(-12)
    .map((t) => ({ role: t.role, text: t.text.slice(0, MAX_MESSAGE_CHARS) }));
}
