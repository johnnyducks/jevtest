"use client";

import { useEffect, useRef, useState } from "react";
import type { Mission } from "@/lib/twin/controller";
import { afterLine } from "@/lib/voice/lines";
import { MissionTrace, StatusChip } from "./TwinPanel";

export interface Reply {
  state: "pending" | "done";
  text?: string;
  source?: "openai" | "built-in";
  model?: string;
  /** Mission status the reply was written for. */
  at: string;
}

interface Props {
  missions: Mission[];
  replies: Record<string, Reply>;
  onClarify: (cardId: string) => void;
  onRetry: (text: string) => void;
}

/** The conversation: operator messages and Marty's replies, one exchange per mission. */
export default function ChatLog({ missions, replies, onClarify, onRetry }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const last = missions.at(-1);
  const lastReply = last ? replies[last.id] : undefined;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [missions.length, last?.status, lastReply?.state]);

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="chat-log" ref={scroller} aria-live="polite">
      <div className="msg marty intro">
        <div className="msg-head mono">MARTY</div>
        <div className="msg-text">
          I&apos;m Marty. Tell me which card to visit and I&apos;ll drive there, mostly without hitting anything. I also take
          questions, within reason.
        </div>
      </div>

      {missions.map((m) => {
        const r = replies[m.id];
        const after = r?.state === "done" && r.at === "moving" ? afterLine(m.status, m.target?.name, m.seq) : null;
        const superseded = m.status === "cancelled" && !r;
        const thinking = !r && !superseded;
        return (
          <div className="exchange" key={m.id}>
            {m.via === "resume" || m.via === "button" ? (
              <div className="msg-system mono">{m.request}</div>
            ) : (
              <div className="msg op">{m.request}</div>
            )}

            <div className="msg marty">
              <div className="msg-head mono">
                MARTY
                <StatusChip status={m.status} />
              </div>
              {superseded ? (
                <div className="msg-text dim">Skipped. You'd already moved on, so I did too.</div>
              ) : thinking || r?.state === "pending" ? (
                <span className="typing" aria-label="Marty is thinking">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <div className="msg-text">{r?.text}</div>
              )}
              {after && <div className="msg-text after">{after}</div>}

              {m.status === "needs_clarification" && m.clarify && (
                <div className="clarify">
                  {m.clarify.options.map((o) => (
                    <button key={o.id} className="btn accent" onClick={() => onClarify(o.id)}>
                      {o.name}
                    </button>
                  ))}
                </div>
              )}
              {m.status === "error" && (
                <div className="clarify">
                  <button className="btn" onClick={() => onRetry(m.request)}>
                    Retry
                  </button>
                </div>
              )}

              {(m.decision || m.plan || m.resolution) && (
                <button className="trace-toggle mono" onClick={() => toggle(m.id)} aria-expanded={open.has(m.id)}>
                  {open.has(m.id) ? "hide trace" : "trace"}
                </button>
              )}
              {open.has(m.id) && <MissionTrace mission={m} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
