"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postJson, toClientError } from "@/lib/api";
import type { ChatTurn, DecisionResult, Mode, ReplyRequestBody, ReplyResult, StatusBody } from "@/lib/decision/contracts";
import type { ChoiceAnswer } from "@/lib/jev/types";
import { DEFAULT_WORLD, SCENARIOS, type World } from "@/lib/marty/world";
import Chat from "./Chat";
import { Bolt, Flask, Logo } from "./icons";
import Inspector from "./Inspector";
import TwinView from "./twin/TwinView";
import type { Turn } from "./types";

const STORAGE_KEY = "marty-the-brain:v1";
/** Let the pipeline reveal finish before the commentary lands (UI pacing only). */
const MIN_REPLY_DELAY_MS = 1600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const interrupted = { status: "error" as const, error: { code: "interrupted", message: "Interrupted by page reload.", retryable: true } };

function loadSession(): { turns: Turn[]; mode?: Mode; world?: World } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { turns: Turn[]; mode?: Mode; world?: World };
    // Requests in flight when the page unloaded cannot resume; mark them retryable.
    const turns = parsed.turns
      .filter((t) => t && t.world)
      .map((t) => ({
        ...t,
        decision: t.decision.status === "pending" ? interrupted : t.decision,
        reply: t.reply.status === "pending" ? interrupted : t.reply,
      }));
    return { turns, mode: parsed.mode, world: parsed.world };
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
  const [world, setWorld] = useState<World>(DEFAULT_WORLD);
  const [mode, setMode] = useState<Mode>("demo");
  const [status, setStatus] = useState<StatusBody | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [view, setView] = useState<"chat" | "inspector">("chat");
  /** Top-level workspace: the 2D digital twin (default) or the original Brain lab. */
  const [workspace, setWorkspace] = useState<"twin" | "lab">("twin");
  const [hydrated, setHydrated] = useState(false);
  const [restoredIds, setRestoredIds] = useState<Set<string>>(() => new Set());
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;

  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      setTurns(saved.turns);
      if (saved.world) setWorld(saved.world);
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
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ turns, mode, world }));
    } catch {
      // Storage full or unavailable: the session simply won't survive a reload.
    }
  }, [turns, mode, world, hydrated]);

  const patch = useCallback((id: string, fn: (t: Turn) => Turn) => {
    setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  const runReply = useCallback(
    async (id: string, decision: DecisionResult, delay = 0) => {
      const turn = turnsRef.current.find((t) => t.id === id);
      if (!turn) return;
      patch(id, (t) => ({ ...t, reply: { status: "pending" } }));
      const intent = decision.response.answers.intent as ChoiceAnswer;
      const { action, label, priority, directive, constraints } = decision.effect;
      const body: ReplyRequestBody = {
        message: turn.text,
        mode: turn.mode,
        history: historyBefore(turnsRef.current, id),
        decision: {
          source: decision.source,
          effect: { action, label, priority, directive, constraints },
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
          world: turn.world,
          history: historyBefore(turnsRef.current, id),
        });
        patch(id, (t) => ({ ...t, decision: { status: "done", data } }));
        // The newest decision drives the mission state going forward.
        if (turnsRef.current[turnsRef.current.length - 1]?.id === id) setWorld(data.worldAfter);
        await runReply(id, data, MIN_REPLY_DELAY_MS);
      } catch (err) {
        patch(id, (t) => ({ ...t, decision: { status: "error", error: toClientError(err) } }));
      }
    },
    [patch, runReply],
  );

  const send = (text: string, opts: { world?: World; whatIf?: string; scenario?: string } = {}) => {
    const turn: Turn = {
      id: crypto.randomUUID(),
      text,
      mode,
      createdAt: new Date().toISOString(),
      world: structuredClone(opts.world ?? world),
      ...(opts.whatIf ? { whatIf: opts.whatIf } : {}),
      ...(opts.scenario ? { scenario: opts.scenario } : {}),
      decision: { status: "pending" },
      reply: { status: "idle" },
    };
    turnsRef.current = [...turnsRef.current, turn];
    setTurns(turnsRef.current);
    setSelectedId(turn.id);
    void runDecision(turn.id);
  };

  const startScenario = (id: string) => {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) return;
    setWorld(structuredClone(s.world));
    send(s.message, { world: s.world, scenario: s.title });
  };

  /** Re-run a message against a changed scenario variable. */
  const whatIf = (turnId: string, changed: World, label: string) => {
    const t = turnsRef.current.find((x) => x.id === turnId);
    if (!t) return;
    send(t.text, { world: changed, whatIf: label, scenario: t.scenario });
  };

  const reset = () => {
    setTurns([]);
    turnsRef.current = [];
    setWorld(structuredClone(DEFAULT_WORLD));
    setSelectedId(undefined);
    setView("chat");
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
            <div className="brand-name">
              MARTY <span className="brand-slash">/</span> THE BRAIN
            </div>
            <div className="brand-sub">Every message changes the mission.</div>
          </div>
        </div>
        <div className="workspace-switch" role="tablist" aria-label="Workspace">
          <button role="tab" aria-selected={workspace === "twin"} onClick={() => setWorkspace("twin")}>
            Twin
          </button>
          <button role="tab" aria-selected={workspace === "lab"} onClick={() => setWorkspace("lab")}>
            Brain lab
          </button>
        </div>
        <div className="topbar-spacer" />
        <div className="status-pills">
          <span className="pill" title="Jev decision API (server-side)">
            <span className={`dot ${liveAvailable ? "on" : ""}`} />
            JEV {liveAvailable ? status?.jev.model : "offline"}
          </span>
          <span className="pill" title="Commentary generation in live mode">
            <span className={`dot ${status?.replies.configured ? "on" : ""}`} />
            VOICE {status?.replies.configured ? status.replies.model : "scripted"}
          </span>
          <span className="pill" title="This is a sandbox. No physical robot is connected.">
            <span className="dot sim" />
            NO ROBOT LINKED
          </span>
        </div>
        {workspace === "lab" && turns.length > 0 && (
          <button className="btn ghost" onClick={reset} disabled={busy} title="Clear the session and restore the default mission">
            Reset
          </button>
        )}
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

      {/* Both workspaces stay mounted so switching never loses mission or chat state. */}
      <main className="main-twin" hidden={workspace !== "twin"}>
        <TwinView mode={mode} />
      </main>
      <main className="main" data-view={view} hidden={workspace !== "lab"}>
        <div className="mobile-tabs" role="tablist">
          <button role="tab" aria-selected={view === "chat"} onClick={() => setView("chat")}>
            Comms
          </button>
          <button role="tab" aria-selected={view === "inspector"} onClick={() => setView("inspector")}>
            Brain{turns.length ? ` · ${turns.length}` : ""}
          </button>
        </div>
        <Chat
          turns={turns}
          mode={mode}
          busy={busy || !hydrated}
          selectedId={selected?.id}
          onSend={(text) => send(text)}
          onScenario={startScenario}
          onInspect={inspect}
          onRetry={(id) => void runDecision(id)}
          onRetryReply={retryReply}
        />
        <Inspector
          turns={turns}
          selected={selected}
          world={world}
          busy={busy}
          onSelect={setSelectedId}
          onRetry={(id) => void runDecision(id)}
          onWhatIf={whatIf}
          restoredIds={restoredIds}
          status={status}
        />
      </main>
    </div>
  );
}
