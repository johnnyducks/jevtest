/** Browser-side helpers for calling this app's own API routes. */
import type { ApiErrorBody } from "./decision/contracts";

export interface ClientError {
  code: string;
  message: string;
  retryable: boolean;
  detail?: unknown;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw { code: "network", message: "Could not reach the server.", retryable: true } satisfies ClientError;
  }
  const json = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok || !json) {
    throw (json?.error ?? { code: `http_${res.status}`, message: `Request failed (HTTP ${res.status}).`, retryable: res.status >= 500 }) satisfies ClientError;
  }
  return json;
}

export function toClientError(err: unknown): ClientError {
  if (err && typeof err === "object" && "message" in err && "code" in err) return err as ClientError;
  return { code: "unknown", message: "Something went wrong.", retryable: true };
}
