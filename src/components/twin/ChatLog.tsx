"use client";

import { useEffect, useRef, useState } from "react";
import type { Mission } from "@/lib/twin/controller";
import type { ChatEntry, PublicFact } from "@/lib/voice/director";
import { MissionTrace, StatusChip } from "./TwinPanel";

interface Props {
  missions: Mission[];
  entries: Record<string, ChatEntry>;
  onClarify: (cardId: string) => void;
  onRetry: (text: string) => void;
}

/** Compact attribution for the facts behind a message. */
function Sources({ facts }: { facts?: PublicFact[] }) {
  if (!facts?.length) return null;
  const seen = new Map<string, PublicFact["source"]>();
  for (const f of facts) seen.set(f.source.name === "Wikipedia" ? f.source.url : f.source.name, f.source);
  return (
    <div className="msg-sources mono">
      {[...seen.values()].map((s) =>
        s.name === "Wikipedia" ? (
          <a key={s.url} href={s.url} target="_blank" rel="noreferrer" title={`${s.version} · ${s.license}${s.retrievedAt ? ` · retrieved ${s.retrievedAt.slice(0, 10)}` : ""}`}>
            Wikipedia
          </a>
        ) : (
          <a key={s.name} href={s.url} target="_blank" rel="noreferrer" title={`${s.version} · ${s.license}`}>
            Lahman Baseball Database
          </a>
        ),
      )}
    </div>
  );
}

/** The conversation: operator messages and Marty's replies, one exchange per mission. */
export default function ChatLog({ missions, entries, onClarify, onRetry }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const last = missions.at(-1);
  const lastEntry = last ? entries[last.id] : undefined;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [missions.length, last?.status, lastEntry?.reply?.state, lastEntry?.after?.state]);

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
          I&apos;m Marty. Tell me which card to visit and I&apos;ll drive there, mostly without hitting anything. Ask me about
          any player, too. I&apos;ve memorized more box scores than is strictly healthy.
        </div>
      </div>

      {missions.map((m) => {
        const r = entries[m.id]?.reply;
        const after = entries[m.id]?.after;
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
              <Sources facts={r?.facts} />
              {after?.state === "pending" && (
                <span className="typing after" aria-label="Marty is looking at the card">
                  <i />
                  <i />
                  <i />
                </span>
              )}
              {after?.state === "done" && after.text && <div className={`msg-text after${after.facts?.length ? " fact" : ""}`}>{after.text}</div>}
              <Sources facts={after?.facts} />

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
