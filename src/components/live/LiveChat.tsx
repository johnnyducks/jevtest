"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatItem, DecisionTrace, PublicFact } from "@/lib/live/types";
import { formatLength, renderUnits, type Units } from "@/lib/units";

const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);

const STATUS: Record<string, { label: string; tone: string }> = {
  chosen: { label: "chosen", tone: "ok" },
  queued: { label: "queued", tone: "live" },
  declined: { label: "declined", tone: "bad" },
  not_chosen: { label: "not chosen", tone: "muted" },
};

const VIEWER_STATE: Record<string, string> = { waiting: "waiting", deciding: "Jev is deciding…", failed: "not decided" };

/** Compact attribution for the facts behind a message. */
function Sources({ facts }: { facts?: PublicFact[] }) {
  if (!facts?.length) return null;
  const seen = new Map<string, PublicFact["source"]>();
  for (const f of facts) seen.set(f.source.name === "Wikipedia" ? f.source.url : f.source.name, f.source);
  return (
    <div className="msg-sources mono">
      {[...seen.values()].map((s) => (
        <a key={s.url} href={s.url} target="_blank" rel="noreferrer" title={`${s.version} · ${s.license}${s.retrievedAt ? ` · retrieved ${s.retrievedAt.slice(0, 10)}` : ""}`}>
          {s.name === "Wikipedia" ? "Wikipedia" : "Lahman Baseball Database"}
        </a>
      ))}
    </div>
  );
}

/** What Jev was asked, what it answered, and which rules changed the outcome. */
function Trace({ d, units }: { d: DecisionTrace; units: Units }) {
  return (
    <div className="live-trace">
      <div className="lt-head">
        <span className="tag live" title="Returned by Jev">
          model · jev
        </span>
        <span className="mono dim">
          {d.model} · {d.latencyMs} ms
        </span>
      </div>
      <div className="lt-sub">How Jev read each message</div>
      <ul className="lt-intents">
        {d.intents.map((i) => (
          <li key={i.messageId}>
            <b>@{i.handle}</b> <span className="dim">“{i.text.length > 60 ? `${i.text.slice(0, 60)}…` : i.text}”</span> → <b>{i.intent}</b>{" "}
            <span className="mono dim">{pct(i.confidence)}</span>
          </li>
        ))}
      </ul>
      <div className="lt-sub">Options Jev ranked (next action)</div>
      <ul className="lt-options">
        {d.considered.map((o) => (
          <li key={o.key} className={o.status}>
            <div className="lt-row">
              <span className="lt-label">{o.label}</span>
              <span className={`m-chip ${STATUS[o.status].tone}`}>{STATUS[o.status].label}</span>
            </div>
            <div className="lt-bar">
              <span style={{ width: `${Math.max(0, Math.min(1, o.p ?? 0)) * 100}%` }} />
              <em className="mono">{pct(o.p)}</em>
            </div>
            <div className="lt-reason">
              {o.reason}
              {o.estimate && (
                <span className="mono dim">
                  {" "}
                  · {formatLength(o.estimate.meters, units)} · {o.estimate.seconds} s · {Math.round(o.estimate.battery)}% (+{Math.round(o.estimate.homeBattery)}% home) · {o.estimate.points} pts
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {d.rules.length > 0 && (
        <>
          <div className="lt-sub">
            Safety rules{" "}
            <span className="tag rule" title="Deterministic application logic, not a model output">
              rule
            </span>
          </div>
          <ul className="reasons">
            {d.rules.map((r) => (
              <li key={r.id}>
                {r.id} {r.label}: {r.status} · {r.detail}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="card-sub" style={{ margin: "8px 0 0" }}>
        Probabilities exactly as returned by Jev. Battery and time estimates come from the route planner.
      </p>
    </div>
  );
}

export default function LiveChat({
  chat,
  me,
  units,
  speech,
}: {
  chat: ChatItem[];
  me: string;
  units: Units;
  /** Marty's voice, when ElevenLabs is set up: which line is playing, and replay one. */
  speech?: { speaking: string | null; say: (id: string) => void };
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const last = chat.at(-1);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [chat.length, last?.id, last && "state" in last ? last.state : null]);

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div
      className="chat-log"
      ref={scroller}
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className="msg marty intro">
        <div className="msg-head mono">MARTY</div>
        <div className="msg-text">
          I&apos;m Marty, live from a six-floor card house built to my size. Send me anywhere: one card, a tour across floors (&quot;Ripken,
          then Bonds, then Mantle&quot;), a lap of a floor, or straight up to the vault if you&apos;re feeling expensive. My brain, Jev, reads the
          room and picks. You score points when I visit cards for you.
        </div>
      </div>

      {chat.map((c) => {
        if (c.kind === "system") {
          return (
            <div key={c.id} className={`msg-system mono ${c.tone}`}>
              {renderUnits(c.text, units)}
            </div>
          );
        }
        if (c.kind === "viewer") {
          const mine = me && c.handle.toLowerCase() === me.toLowerCase();
          return (
            <div key={c.id} className={`msg viewer${mine ? " op" : ""}`}>
              <div className="msg-head mono">
                @{c.handle}
                {c.intent && <span className="intent-chip">{c.intent}</span>}
              </div>
              <div className="msg-text">{c.text}</div>
              {c.corrections?.length ? <div className="msg-note mono">read as: {c.corrections.join(", ")}</div> : null}
              {c.state !== "handled" && <div className={`msg-note mono ${c.state}`}>{VIEWER_STATE[c.state]}</div>}
            </div>
          );
        }
        return (
          <div key={c.id} className={`msg marty${c.idle ? " idle" : ""}${speech?.speaking === c.id ? " speaking" : ""}`}>
            <div className="msg-head mono">
              MARTY
              {speech && c.state === "done" && c.text && (
                <button className="say-btn" title="Hear this line" aria-label="Hear this line" onClick={() => speech.say(c.id)}>
                  {speech.speaking === c.id ? "🔊" : "🔈"}
                </button>
              )}
              {c.idle && <span className="intent-chip">thinking</span>}
              {c.source === "built-in" && (
                <span className="tag rule" title="Built-in line (no text model configured, or it failed)">
                  built-in
                </span>
              )}
            </div>
            {c.state === "pending" ? (
              <span className="typing" aria-label="Marty is typing">
                <i />
                <i />
                <i />
              </span>
            ) : (
              <div className="msg-text">{renderUnits(c.text ?? "", units)}</div>
            )}
            <Sources facts={c.facts} />
            {c.decision && (
              <>
                <button className="trace-toggle mono" onClick={() => toggle(c.id)} aria-expanded={open.has(c.id)}>
                  {open.has(c.id) ? "hide decision" : "how Jev decided"}
                </button>
                {open.has(c.id) && <Trace d={c.decision} units={units} />}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
