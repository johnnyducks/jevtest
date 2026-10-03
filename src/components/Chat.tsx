"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_MESSAGE_CHARS, type Mode } from "@/lib/decision/contracts";
import type { ChoiceAnswer } from "@/lib/jev/types";
import { Logo, Send } from "./icons";
import type { Turn } from "./types";
import { choicePct } from "./Viz";

export const EXAMPLES = [
  "I was charged twice for my subscription and I'm furious. Fix this now!!",
  "How does probability calibration differ from accuracy?",
  "Draft a friendly reminder email about Friday's design review.",
  "Production checkout is down for all users — 500 errors since 9am",
  "Love the new dashboard, the dark theme is gorgeous",
  "help",
  "I want to speak to a real person, not a bot.",
];

interface Props {
  turns: Turn[];
  mode: Mode;
  busy: boolean;
  selectedId?: string;
  onSend: (text: string) => void;
  onInspect: (id: string) => void;
  onRetry: (id: string) => void;
  onRetryReply: (id: string) => void;
}

export default function Chat({ turns, mode, busy, selectedId, onSend, onInspect, onRetry, onRetryReply }: Props) {
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

  const submit = (text = draft) => {
    const t = text.trim();
    if (!t || busy || t.length > MAX_MESSAGE_CHARS) return;
    onSend(t);
    setDraft("");
  };

  return (
    <section className="chat" aria-label="Conversation">
      <div className="chat-scroll" ref={scrollRef}>
        <div className="chat-inner" aria-live="polite">
          {turns.length === 0 ? (
            <div className="empty">
              <div className="glyph">
                <Logo width={26} height={26} />
              </div>
              <h1>Every message is a decision.</h1>
              <p>
                Each message is classified by a batch of typed questions (choice, score and yes/no). The returned
                probabilities select an action, and that action shapes the reply.
              </p>
              <div className="examples">
                {EXAMPLES.map((e) => (
                  <button key={e} className="example" disabled={busy} onClick={() => submit(e)}>
                    {e}
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
          <div className="composer-examples">
            {EXAMPLES.map((e) => (
              <button key={e} className="example" disabled={busy} onClick={() => submit(e)} title={e}>
                {e.length > 38 ? `${e.slice(0, 36)}…` : e}
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
          <textarea
            ref={taRef}
            rows={1}
            value={draft}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder={mode === "live" ? "Message, classified live by Jev…" : "Message (demo mode, simulated decisions)…"}
            aria-label="Message"
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
            <span className={`tag ${mode === "live" ? "live" : "sim"}`}>{mode === "live" ? "live" : "demo"}</span>{" "}
            {mode === "live" ? "Real Jev responses" : "Simulated results, clearly labelled"}
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
      <div className="bubble user">{turn.text}</div>

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
                intent <strong>{intent.choice}</strong>{" "}
                <span className="mono">{choicePct(intent)}</span>
              </span>
              <span className="arrow">→</span>
              <strong>{d.effect.label}</strong>
              <span className="tag neutral">{d.effect.priority}</span>
            </>
          ) : (
            <span>
              classifying <span className="typing" aria-hidden><i /><i /><i /></span>
            </span>
          )}
        </button>
      )}

      {turn.reply.status === "pending" && (
        <div className="bubble bot" aria-label="Generating reply">
          <span className="typing" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
      {turn.reply.status === "error" && (
        <div className="error-box" role="alert">
          <span>Reply failed: {turn.reply.error.message}</span>
          <button className="btn" onClick={() => onRetryReply(turn.id)}>
            Retry reply
          </button>
        </div>
      )}
      {turn.reply.status === "done" && (
        <div className="bubble bot">
          {turn.reply.data.text}
          <div className="bubble-meta">
            {turn.reply.data.source === "generated" ? (
              <span className="tag live">generated · {turn.reply.data.model}</span>
            ) : (
              <span className="tag sim">scripted</span>
            )}
            {turn.reply.data.note && <span>{turn.reply.data.note}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
