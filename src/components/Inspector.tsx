"use client";

import { useEffect, useRef, useState } from "react";
import type { StatusBody } from "@/lib/decision/contracts";
import { THRESHOLDS } from "@/lib/decision/policy";
import type { ChoiceAnswer, NoulAnswer, ScoreAnswer } from "@/lib/jev/types";
import { Check, Cross } from "./icons";
import Timeline from "./Timeline";
import type { Turn } from "./types";
import { ChoiceBars, describe, fmtPct, NoulGauge, ScoreBars } from "./Viz";

const STEP_MS = 420;

type StageState = "idle" | "active" | "done" | "error";

interface Props {
  turns: Turn[];
  selected: Turn | undefined;
  onSelect: (id: string) => void;
  onRetry: (id: string) => void;
  /** Turns restored from session storage: shown fully, without replaying the reveal. */
  restoredIds: Set<string>;
  status: StatusBody | null;
}

export default function Inspector({ turns, selected, onSelect, onRetry, restoredIds, status }: Props) {
  const revealed = useReveal(selected, restoredIds);
  const [tab, setTab] = useState<"decision" | "request" | "response">("decision");

  return (
    <aside className="inspector" aria-label="Decision inspector">
      <div className="inspector-scroll">
        <div className="section-title">
          <span>Decision inspector</span>
          {selected?.decision.status === "done" && (
            <div className="tabs" role="tablist">
              {(["decision", "request", "response"] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                  {t === "decision" ? "Visual" : t === "request" ? "Request" : "Response"}
                </button>
              ))}
            </div>
          )}
        </div>

        {!selected ? (
          <Idle status={status} />
        ) : tab !== "decision" && selected.decision.status === "done" ? (
          <RawView turn={selected} which={tab} />
        ) : (
          <DecisionView turn={selected} revealed={revealed} onRetry={onRetry} />
        )}

        {status && !status.jev.configured && selected && <EnableLive compact />}

        <div className="section-title" style={{ marginTop: 10 }}>
          <span>Session timeline</span>
          <span className="mono">{turns.length} decision{turns.length === 1 ? "" : "s"}</span>
        </div>
        <Timeline turns={turns} selectedId={selected?.id} onSelect={onSelect} />
      </div>
    </aside>
  );
}

/** Step through the four pipeline stages once per freshly completed decision. */
function useReveal(turn: Turn | undefined, restoredIds: Set<string>) {
  const seen = useRef<Set<string>>(new Set());
  const [revealed, setRevealed] = useState(4);
  const id = turn?.id;
  const status = turn?.decision.status;

  useEffect(() => {
    if (!id) return;
    if (status !== "done") {
      setRevealed(0);
      return;
    }
    if (seen.current.has(id) || restoredIds.has(id)) {
      setRevealed(4);
      return;
    }
    seen.current.add(id);
    setRevealed(1);
    const timers = [2, 3, 4].map((n, i) => setTimeout(() => setRevealed(n), STEP_MS * (i + 1)));
    return () => timers.forEach(clearTimeout);
  }, [id, status, restoredIds]);

  return revealed;
}

function Idle({ status }: { status: StatusBody | null }) {
  return (
    <>
      <div className="card inspector-idle">
        Send a message to watch it flow through the decision pipeline: request → classification → alternatives →
        selection → effect.
      </div>
      {status && !status.jev.configured && <EnableLive />}
    </>
  );
}

function EnableLive({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  return (
    <div className="card help">
      <div className="card-head" style={{ marginBottom: open ? 10 : 0 }}>
        <span className="card-title">Live mode is off</span>
        <button className="link-btn" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "How to enable"}
        </button>
      </div>
      {open && (
        <>
          No Jev API key is configured on the server, so only <b>Demo mode</b> (clearly labelled simulated results) is
          available.
          <ol>
            <li>
              Copy <code>.env.example</code> to <code>.env.local</code>
            </li>
            <li>
              Set <code>JEV_API_KEY</code> (and optionally <code>ANTHROPIC_API_KEY</code> for generated replies)
            </li>
            <li>Restart the dev server and switch to Live</li>
          </ol>
        </>
      )}
    </div>
  );
}

function stageState(n: number, turn: Turn, revealed: number): StageState {
  const d = turn.decision.status;
  if (n === 0) return "done";
  if (d === "pending") return n === 1 ? "active" : "idle";
  if (d === "error") return n === 1 ? "error" : "idle";
  if (n === 4) {
    if (revealed < 4) return revealed === 3 ? "active" : "idle";
    const r = turn.reply.status;
    return r === "done" ? "done" : r === "error" ? "error" : "active";
  }
  if (revealed >= n) return "done";
  return revealed === n - 1 ? "active" : "idle";
}

function DecisionView({ turn, revealed, onRetry }: { turn: Turn; revealed: number; onRetry: (id: string) => void }) {
  const d = turn.decision.status === "done" ? turn.decision.data : null;
  const sim = d?.source === "simulated" || (!d && turn.mode === "demo");
  const answers = d?.response.answers;
  const intent = answers?.intent as ChoiceAnswer | undefined;
  const urgency = answers?.urgency as ScoreAnswer | undefined;
  const sentiment = answers?.sentiment as ScoreAnswer | undefined;
  const escalate = answers?.escalate as NoulAnswer | undefined;
  const clarify = answers?.clarify as NoulAnswer | undefined;
  const qCount = d ? Object.keys(d.request.questions).length : 5;

  const stages: { label: string; detail: React.ReactNode }[] = [
    {
      label: "Request received",
      detail: `${turn.mode === "live" ? "POST /v1/systemone" : "simulator (no network)"} · ${qCount} questions batched`,
    },
    {
      label: "Intent classified",
      detail:
        turn.decision.status === "error"
          ? turn.decision.error.message
          : intent
            ? `intent → ${intent.choice} · confidence ${fmtPct(intent.confidence)}`
            : turn.mode === "live"
              ? "awaiting Jev…"
              : "simulating…",
    },
    {
      label: "Alternatives evaluated",
      detail: answers
        ? `${Object.keys(intent?.probabilities ?? {}).length} intents · 2 rubrics · 2 propositions`
        : "—",
    },
    { label: "Result selected", detail: d ? `${d.effect.label} · ${d.effect.priority}` : "—" },
    {
      label: "Downstream effect",
      detail:
        turn.reply.status === "done"
          ? turn.reply.data.source === "claude"
            ? `reply generated · ${turn.reply.data.model}`
            : `scripted reply · ${turn.reply.data.note ?? "demo"}`
          : turn.reply.status === "error"
            ? turn.reply.error.message
            : d
              ? "generating reply…"
              : "—",
    },
  ];

  return (
    <div className={`${sim ? "sim-tone" : ""}`} style={{ display: "grid", gap: 14 }}>
      {sim ? (
        <div className="sim-banner">
          <span className="tag sim">Simulated</span>
          <span>
            Demo mode: these numbers come from a local keyword heuristic, <b>not from Jev</b>. Switch to Live for real
            model output.
          </span>
        </div>
      ) : (
        <div className="sim-banner live-banner">
          <span className="tag live">Live</span>
          <span>
            {d ? (
              <>
                Values below are exactly as returned by <span className="mono">{d.model}</span>.
              </>
            ) : (
              "Calling the Jev API…"
            )}
          </span>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <span className="card-title">Pipeline</span>
          {d && (
            <span className="metric">
              <b>{d.latencyMs}</b> ms
              {d.response.usage && (
                <>
                  {" · "}
                  <b>{d.response.usage.input_tokens}</b> in / <b>{d.response.usage.output_tokens}</b> out tok
                </>
              )}
            </span>
          )}
        </div>
        <ol className="pipeline">
          {stages.map((s, i) => {
            const st = stageState(i, turn, revealed);
            return (
              <li key={s.label} className="stage" data-state={st}>
                <span className="node">{st === "done" ? <Check /> : st === "error" ? <Cross /> : null}</span>
                <div>
                  <div className="stage-label">{s.label}</div>
                  <div className="stage-detail">{s.detail}</div>
                </div>
              </li>
            );
          })}
        </ol>
        {turn.decision.status === "error" && (
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => onRetry(turn.id)}>
              Retry decision
            </button>
          </div>
        )}
      </div>

      {intent && revealed >= 1 && (
        <div className="card reveal">
          <div className="card-head">
            <span className="card-title">
              intent <span className="kind">choice</span>
            </span>
            <span className="metric">
              confidence <b>{fmtPct(intent.confidence)}</b>
            </span>
          </div>
          <p className="card-sub">{describe(d?.request.questions.intent.instructions)}</p>
          <ChoiceBars answer={intent} />
        </div>
      )}

      {urgency && sentiment && revealed >= 2 && (
        <>
          <div className="card reveal">
            <div className="card-head">
              <span className="card-title">
                urgency <span className="kind">score</span>
              </span>
              <span className="metric">
                score <b>{urgency.score.toFixed(2)}</b> · conf <b>{fmtPct(urgency.confidence)}</b>
              </span>
            </div>
            <ScoreBars answer={urgency} />
          </div>
          <div className="card reveal">
            <div className="card-head">
              <span className="card-title">
                sentiment <span className="kind">score</span>
              </span>
              <span className="metric">
                score <b>{sentiment.score.toFixed(2)}</b> · conf <b>{fmtPct(sentiment.confidence)}</b>
              </span>
            </div>
            <ScoreBars answer={sentiment} />
          </div>
        </>
      )}

      {escalate && clarify && revealed >= 2 && (
        <div className="card reveal">
          <div className="card-head">
            <span className="card-title">
              propositions <span className="kind">noul</span>
            </span>
            <span className="metric dim">│ = policy threshold</span>
          </div>
          <div className="grid-2">
            <NoulGauge answer={escalate} threshold={THRESHOLDS.escalate} question="escalate — hand off to a human?" />
            <NoulGauge answer={clarify} threshold={THRESHOLDS.clarify} question="clarify — too vague to act on?" />
          </div>
        </div>
      )}

      {d && revealed >= 3 && (
        <div className={`card effect reveal${sim ? " sim-tone" : ""}`}>
          <div className="card-head">
            <span className="card-title">Selected decision → effect</span>
            <span className={`tag ${sim ? "sim" : "live"}`}>{sim ? "simulated" : "live"}</span>
          </div>
          <div className="effect-action">
            {d.effect.label}
            <span className="tag neutral">{d.effect.priority}</span>
          </div>
          <ul className="reasons">
            {d.effect.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {d.effect.flags.length > 0 && (
            <div className="flags">
              {d.effect.flags.map((f) => (
                <span key={f} className="tag neutral">
                  {f}
                </span>
              ))}
            </div>
          )}
          <div className="directive">
            <b>Directive to reply generator:</b> {d.effect.directive}
          </div>
        </div>
      )}
    </div>
  );
}

function RawView({ turn, which }: { turn: Turn; which: "request" | "response" }) {
  if (turn.decision.status !== "done") return null;
  const d = turn.decision.data;
  const sim = d.source === "simulated";
  const body = which === "request" ? d.request : d.response;
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">
          {which === "request" ? (sim ? "Request (would be sent)" : "Request sent to Jev") : sim ? "Simulated answers" : "Response from Jev (verbatim)"}
        </span>
        <span className={`tag ${sim ? "sim" : "live"}`}>{sim ? "simulated" : "live"}</span>
      </div>
      {which === "request" && !sim && (
        <p className="card-sub">
          The API key is attached server-side and never reaches the browser.
        </p>
      )}
      <pre className="code">{JSON.stringify(body, null, 2)}</pre>
    </div>
  );
}
