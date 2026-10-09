"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { STATUS_NAME, statusTone, type Status } from "@/lib/permits/status";

export function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener">{children}</a>;
}

export function StatusPill({ status }: { status: Status }) {
  return <span className={`pill ${statusTone(status)}`}>{STATUS_NAME[status] ?? status}</span>;
}

export const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export const Spinner = () => <span className="spinner" aria-label="Working" />;

/* ---------- Toast ---------- */

const ToastCtx = createContext<(text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((t: string) => {
    setText(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setText(null), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {text && <div className="toast" role="status">{text}</div>}
    </ToastCtx.Provider>
  );
}

/* ---------- JSON fetch ---------- */

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json === undefined ? rest.headers : { "content-type": "application/json", ...rest.headers },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error || "Something went wrong. Try again.", res.status);
  return data as T;
}

/* ---------- Server status ---------- */

export interface ServerStatus {
  ai: boolean;
  staff: { mode: "key" | "open" | "closed"; signedIn: boolean };
}
