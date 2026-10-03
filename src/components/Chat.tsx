"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_MESSAGE_CHARS, type Mode } from "@/lib/decision/contracts";
import type { ChoiceAnswer } from "@/lib/jev/types";
import { SCENARIOS } from "@/lib/marty/world";
import { Logo, Send } from "./icons";
import type { Turn } from "./types";
import { choicePct } from "./Viz";

interface Props {
  turns: Turn[];
  mode: Mode;
  busy: boolean;
  selectedId?: string;
  onSend: (text: string) => void;
  onScenario: (id: string) => void;
  onInspect: (id: string) => void;
  onRetry: (id: string) => void;
  onRetryReply: (id: string) => void;
}

export default function Chat({ turns, mode, busy, selectedId, onSend, onScenario, onInspect, onRetry, onRetryReply }: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const last = turns[turns.length - 1];
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [turns.length, last?.decision.status, last?.reply.status]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [draft]);

  const submit = () => {
    const t = draft.trim();
    if (!t || busy || t.length > MAX_MESSAGE_CHARS) return;
    onSend(t);
    setDraft("");
  };

  return (
    <section className="chat" aria-label="Operator comms">
      <div className="chat-scroll" ref={scrollRef}>
        <div className="chat-inner" aria-live="polite">
          {turns.length === 0 ? (
            <div className="empty">
              <div className="glyph">
                <Logo width={26} height={26} />
              </div>
              <div className="eyebrow">MARTY / THE BRAIN · decision sandbox</div>
              <h1>Every message changes the mission.</h1>
              <p>
                Send Marty an instruction or pick a scenario. Each request is scored by Jev, filtered through
                Marty&apos;s fixed safety rules, and turned into one next action. This is a simulation: no physical robot
                is connected.
              </p>
              <div className="scenarios">
                {SCENARIOS.map((s, i) => (
                  <button key={s.id} className="scenario" disabled={busy} onClick={() => onScenario(s.id)}>
                    <span className="scenario-head">
                      <span className="mono dim">SCN-0{i + 1}</span>
                      <span className="scenario-hint mono">{s.hint}</span>
                    </span>
                    <span className="scenario-title">{s.title}</span>
                    <span className="scenario-msg">“{s.message}”</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((t) => (
              <TurnView
                key={t.id}
                turn={t}
                selected={t.id === selectedId}
                onInspect={onInspect}
                onRetry={onRetry}
                onRetryReply={onRetryReply}
              />
            ))
          )}
        </div>
      </div>

      <div className="composer-wrap">
        {turns.length > 0 && (
          <div className="composer-examples" aria-label="Scenario starters">
            {SCENARIOS.map((s, i) => (
              <button key={s.id} className="example" disabled={busy} onClick={() => onScenario(s.id)} title={s.message}>
                <span className="mono dim">0{i + 1}</span> {s.title}
              </button>
            ))}
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <span className="composer-prompt mono" aria-hidden>
            OP&gt;
          </span>
          <textarea
            ref={taRef}
            rows={1}
            value={draft}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder={mode === "live" ? "Instruct Marty. Decisions come live from Jev…" : "Instruct Marty (demo mode: simulated decisions)…"}
            aria-label="Message to Marty"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button className="send" type="submit" disabled={busy || !draft.trim()} aria-label="Send">
            <Send />
          </button>
        </form>
        <div className="composer-foot">
          <span>
            <span className={`tag ${mode === "live" ? "live" : "sim"}`}>{mode === "live" ? "live · jev" : "demo · simulated"}</span>{" "}
            {mode === "live" ? "Real Jev outputs" : "Heuristic stand-in, clearly labelled"}
          </span>
          <span className="hint">Enter to send · Shift+Enter for newline</span>
        </div>
      </div>
    </section>
  );
}

function TurnView({
  turn,
  selected,
  onInspect,
  onRetry,
  onRetryReply,
}: {
  turn: Turn;
  selected: boolean;
  onInspect: (id: string) => void;
  onRetry: (id: string) => void;
  onRetryReply: (id: string) => void;
}) {
  const d = turn.decision.status === "done" ? turn.decision.data : null;
  const intent = d?.response.answers.intent as ChoiceAnswer | undefined;
  const sim = turn.mode === "demo";

  return (
    <div className="turn">
      <div className="bubble user">
        <div className="bubble-label mono">
          OPERATOR
          {turn.scenario && <span className="dim"> · {turn.scenario}</span>}
          {turn.whatIf && <span className="whatif-tag">what if: {turn.whatIf}</span>}
        </div>
        {turn.text}
      </div>

      {turn.decision.status === "error" ? (
        <div className="error-box" role="alert">
          <span>Decision failed: {turn.decision.error.message}</span>
          <button className="btn" onClick={() => onRetry(turn.id)}>
            Retry
          </button>
        </div>
      ) : (
        <button className="decision-chip" aria-current={selected} onClick={() => onInspect(turn.id)}>
          <span className={`tag ${sim ? "sim" : "live"}`}>{sim ? "sim" : "jev"}</span>
          {d && intent ? (
            <>
              <span>
                intent <strong>{intent.choice}</strong> <span className="mono">{choicePct(intent)}</span>
              </span>
              <span className="arrow">→</span>
              <span className="tag rule">rule</span>
              <strong>{d.effect.label}</strong>
              <span className="tag neutral">{d.effect.priority}</span>
            </>
          ) : (
            <span>
              thinking <span className="typing" aria-hidden><i /><i /><i /></span>
            </span>
          )}
        </button>
      )}

      {turn.reply.status === "pending" && (
        <div className="bubble bot" aria-label="Generating commentary">
          <span className="typing" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
      {turn.reply.status === "error" && (
        <div className="error-box" role="alert">
          <span>Commentary failed: {turn.reply.error.message}</span>
          <button className="btn" onClick={() => onRetryReply(turn.id)}>
            Retry commentary
          </button>
        </div>
      )}
      {turn.reply.status === "done" && (
        <div className="bubble bot">
          <div className="bubble-label mono">
            MARTY · COMMENTARY
            {turn.reply.data.source === "generated" ? (
              <span className="tag voice">generated · {turn.reply.data.model}</span>
            ) : (
              <span className="tag neutral">scripted</span>
            )}
          </div>
          {turn.reply.data.text}
          {turn.reply.data.note && <div className="bubble-meta">{turn.reply.data.note}</div>}
        </div>
      )}
    </div>
  );
}
