"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postJson, toClientError } from "@/lib/api";
import type { ChatTurn, DecisionResult, Mode, ReplyRequestBody, ReplyResult, StatusBody } from "@/lib/decision/contracts";
import type { ChoiceAnswer } from "@/lib/jev/types";
import Chat from "./Chat";
import { Bolt, Flask, Logo } from "./icons";
import Inspector from "./Inspector";
import type { Turn } from "./types";

const STORAGE_KEY = "jev-decision-studio:v1";
/** Let the pipeline reveal finish before the reply lands (UI pacing only). */
const MIN_REPLY_DELAY_MS = 1400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadSession(): { turns: Turn[]; mode?: Mode } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { turns: Turn[]; mode?: Mode };
    // Requests in flight when the page unloaded cannot resume; mark them retryable.
    const turns = parsed.turns.map((t) => ({
      ...t,
      decision:
        t.decision.status === "pending"
          ? { status: "error" as const, error: { code: "interrupted", message: "Interrupted by page reload.", retryable: true } }
          : t.decision,
      reply:
        t.reply.status === "pending"
          ? { status: "error" as const, error: { code: "interrupted", message: "Interrupted by page reload.", retryable: true } }
          : t.reply,
    }));
    return { turns, mode: parsed.mode };
  } catch {
    return null;
  }
}

/** Conversation context sent with each request: prior turns only. */
function historyBefore(turns: Turn[], id: string): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    if (t.id === id) break;
    out.push({ role: "user", text: t.text });
    if (t.reply.status === "done") out.push({ role: "assistant", text: t.reply.data.text });
  }
  return out;
}

export default function Studio() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [mode, setMode] = useState<Mode>("demo");
  const [status, setStatus] = useState<StatusBody | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [view, setView] = useState<"chat" | "inspector">("chat");
  const [hydrated, setHydrated] = useState(false);
  const [restoredIds, setRestoredIds] = useState<Set<string>>(() => new Set());
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;

  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      setTurns(saved.turns);
      setRestoredIds(new Set(saved.turns.map((t) => t.id)));
      setSelectedId(saved.turns[saved.turns.length - 1]?.id);
    }
    fetch("/api/status")
      .then((r) => (r.ok ? (r.json() as Promise<StatusBody>) : null))
      .catch(() => null)
      .then((s) => {
        setStatus(s);
        const wanted = saved?.mode ?? (s?.jev.configured ? "live" : "demo");
        setMode(wanted === "live" && s?.jev.configured ? "live" : "demo");
        setHydrated(true);
      });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ turns, mode }));
    } catch {
      // Storage full or unavailable: the session simply won't survive a reload.
    }
  }, [turns, mode, hydrated]);

  const patch = useCallback((id: string, fn: (t: Turn) => Turn) => {
    setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  const runReply = useCallback(
    async (id: string, decision: DecisionResult, delay = 0) => {
      const turn = turnsRef.current.find((t) => t.id === id);
      if (!turn) return;
      patch(id, (t) => ({ ...t, reply: { status: "pending" } }));
      const intent = decision.response.answers.intent as ChoiceAnswer;
      const body: ReplyRequestBody = {
        message: turn.text,
        mode: turn.mode,
        history: historyBefore(turnsRef.current, id),
        decision: {
          source: decision.source,
          effect: decision.effect,
          intent: intent.choice,
          intentConfidence: intent.confidence,
        },
      };
      try {
        const [reply] = await Promise.all([postJson<ReplyResult>("/api/respond", body), sleep(delay)]);
        patch(id, (t) => ({ ...t, reply: { status: "done", data: reply } }));
      } catch (err) {
        patch(id, (t) => ({ ...t, reply: { status: "error", error: toClientError(err) } }));
      }
    },
    [patch],
  );

  const runDecision = useCallback(
    async (id: string) => {
      const turn = turnsRef.current.find((t) => t.id === id);
      if (!turn) return;
      patch(id, (t) => ({ ...t, decision: { status: "pending" }, reply: { status: "idle" } }));
      try {
        const data = await postJson<DecisionResult>("/api/decide", {
          message: turn.text,
          mode: turn.mode,
          history: historyBefore(turnsRef.current, id),
        });
        patch(id, (t) => ({ ...t, decision: { status: "done", data } }));
        await runReply(id, data, MIN_REPLY_DELAY_MS);
      } catch (err) {
        patch(id, (t) => ({ ...t, decision: { status: "error", error: toClientError(err) } }));
      }
    },
    [patch, runReply],
  );

  const send = (text: string) => {
    const turn: Turn = {
      id: crypto.randomUUID(),
      text,
      mode,
      createdAt: new Date().toISOString(),
      decision: { status: "pending" },
      reply: { status: "idle" },
    };
    turnsRef.current = [...turnsRef.current, turn];
    setTurns(turnsRef.current);
    setSelectedId(turn.id);
    void runDecision(turn.id);
  };

  const retryReply = (id: string) => {
    const t = turnsRef.current.find((x) => x.id === id);
    if (t?.decision.status === "done") void runReply(id, t.decision.data);
  };

  const inspect = (id: string) => {
    setSelectedId(id);
    setView("inspector");
  };

  const busy = turns.some((t) => t.decision.status === "pending" || t.reply.status === "pending");
  const selected = turns.find((t) => t.id === selectedId) ?? turns[turns.length - 1];
  const liveAvailable = !!status?.jev.configured;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Logo />
          </span>
          <div>
            <div className="brand-name">Jev Decision Studio</div>
            <div className="brand-sub">Structured decisions → conversational effects</div>
          </div>
        </div>
        <div className="topbar-spacer" />
        <div className="status-pills">
          <span className="pill" title="Jev decision API">
            <span className={`dot ${liveAvailable ? "on" : ""}`} />
            Jev {liveAvailable ? status?.jev.model : "not configured"}
          </span>
          <span className="pill" title="Reply generation in live mode">
            <span className={`dot ${status?.replies.configured ? "on" : ""}`} />
            Replies {status?.replies.configured ? status.replies.model : "scripted"}
          </span>
        </div>
        <div
          className="mode-switch"
          data-mode={mode}
          role="group"
          aria-label="Decision mode"
          title={liveAvailable ? "" : "Set JEV_API_KEY on the server to enable Live mode"}
        >
          <span className="mode-thumb" />
          <button aria-pressed={mode === "demo"} onClick={() => setMode("demo")}>
            <Flask width={12} height={12} style={{ verticalAlign: -1, marginRight: 5 }} />
            Demo
          </button>
          <button aria-pressed={mode === "live"} disabled={!liveAvailable} onClick={() => setMode("live")}>
            <Bolt width={12} height={12} style={{ verticalAlign: -1, marginRight: 5 }} />
            Live
          </button>
        </div>
      </header>

      <main className="main" data-view={view}>
        <div className="mobile-tabs" role="tablist">
          <button role="tab" aria-selected={view === "chat"} onClick={() => setView("chat")}>
            Chat
          </button>
          <button role="tab" aria-selected={view === "inspector"} onClick={() => setView("inspector")}>
            Inspector{turns.length ? ` · ${turns.length}` : ""}
          </button>
        </div>
        <Chat
          turns={turns}
          mode={mode}
          busy={busy || !hydrated}
          selectedId={selected?.id}
          onSend={send}
          onInspect={inspect}
          onRetry={(id) => void runDecision(id)}
          onRetryReply={retryReply}
        />
        <Inspector
          turns={turns}
          selected={selected}
          onSelect={setSelectedId}
          onRetry={(id) => void runDecision(id)}
          restoredIds={restoredIds}
          status={status}
        />
      </main>
    </div>
  );
}
