"use client";

import { useEffect, useRef, useState } from "react";
import type { RuleStatus, StatusBody } from "@/lib/decision/contracts";
import { THRESHOLDS } from "@/lib/decision/policy";
import type { ChoiceAnswer, NoulAnswer, ScoreAnswer } from "@/lib/jev/types";
import type { World } from "@/lib/marty/world";
import { Check, Cross } from "./icons";
import { MissionPanel, WhatIf } from "./Mission";
import Timeline from "./Timeline";
import type { Turn } from "./types";
import { ChoiceBars, describe, fmtPct, NoulGauge, ScoreBars } from "./Viz";

const STEP_MS = 380;
const LAST = 5;

type StageState = "idle" | "active" | "done" | "error";

interface Props {
  turns: Turn[];
  selected: Turn | undefined;
  /** Current mission state (after the newest decision). */
  world: World;
  busy: boolean;
  onSelect: (id: string) => void;
  onRetry: (id: string) => void;
  onWhatIf: (turnId: string, world: World, label: string) => void;
  /** Turns restored from session storage: shown fully, without replaying the reveal. */
  restoredIds: Set<string>;
  status: StatusBody | null;
}

export default function Inspector({ turns, selected, world, busy, onSelect, onRetry, onWhatIf, restoredIds, status }: Props) {
  const revealed = useReveal(selected, restoredIds);
  const [tab, setTab] = useState<"decision" | "request" | "response">("decision");

  return (
    <aside className="inspector" aria-label="Marty's brain">
      <div className="inspector-scroll">
        <MissionPanel world={world} title="Mission state · now" />

        <div className="section-title">
          <span>Decision{selected ? ` #${turns.indexOf(selected) + 1}` : ""}</span>
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

        {selected?.decision.status === "done" && revealed >= LAST - 1 && (
          <WhatIf world={selected.world} disabled={busy} onRun={(w, label) => onWhatIf(selected.id, w, label)} />
        )}

        {status && !status.jev.configured && selected && <EnableLive compact />}

        <div className="section-title" style={{ marginTop: 10 }}>
          <span>Decision log</span>
          <span className="mono">{turns.length} entr{turns.length === 1 ? "y" : "ies"}</span>
        </div>
        <Timeline turns={turns} selectedId={selected?.id} onSelect={onSelect} />
      </div>
    </aside>
  );
}

/** Step through the pipeline stages once per freshly completed decision. */
function useReveal(turn: Turn | undefined, restoredIds: Set<string>) {
  const seen = useRef<Set<string>>(new Set());
  const [revealed, setRevealed] = useState(LAST);
  const id = turn?.id;
  const status = turn?.decision.status;

  useEffect(() => {
    if (!id) return;
    if (status !== "done") {
      setRevealed(0);
      return;
    }
    if (seen.current.has(id) || restoredIds.has(id)) {
      setRevealed(LAST);
      return;
    }
    seen.current.add(id);
    setRevealed(1);
    const timers = [2, 3, 4, 5].map((n, i) => setTimeout(() => setRevealed(n), STEP_MS * (i + 1)));
    return () => timers.forEach(clearTimeout);
  }, [id, status, restoredIds]);

  return revealed;
}

function Idle({ status }: { status: StatusBody | null }) {
  return (
    <>
      <div className="card inspector-idle">
        Pick a scenario or send an instruction to watch Marty decide: request → intent → candidate actions → safety
        rules → selected action → commentary.
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
              Set <code>JEV_API_KEY</code> (and optionally <code>OPENAI_API_KEY</code> for generated commentary)
            </li>
            <li>Restart the dev server and switch to Live</li>
          </ol>
        </>
      )}
    </div>
  );
}

/** Provenance tag: where a piece of the decision came from. */
function Source({ kind, sim }: { kind: "model" | "rule" | "voice"; sim?: boolean }) {
  if (kind === "rule") return <span className="tag rule" title="Deterministic code. Not a model output.">rule</span>;
  if (kind === "voice") return <span className="tag voice" title="Generated or scripted narration.">commentary</span>;
  return (
    <span className={`tag ${sim ? "sim" : "live"}`} title={sim ? "Demo heuristic, not Jev" : "Returned by Jev"}>
      {sim ? "model · simulated" : "model · jev"}
    </span>
  );
}

function stageState(n: number, turn: Turn, revealed: number): StageState {
  const d = turn.decision.status;
  if (n === 0) return "done";
  if (d === "pending") return n === 1 ? "active" : "idle";
  if (d === "error") return n === 1 ? "error" : "idle";
  if (n === LAST) {
    if (revealed < LAST) return revealed === LAST - 1 ? "active" : "idle";
    const r = turn.reply.status;
    return r === "done" ? "done" : r === "error" ? "error" : "active";
  }
  if (revealed >= n) return "done";
  return revealed === n - 1 ? "active" : "idle";
}

const RULE_ICON: Record<RuleStatus, string> = { pass: "✓", blocked: "⛔", modified: "~", triggered: "!" };

function DecisionView({ turn, revealed, onRetry }: { turn: Turn; revealed: number; onRetry: (id: string) => void }) {
  const d = turn.decision.status === "done" ? turn.decision.data : null;
  const sim = d?.source === "simulated" || (!d && turn.mode === "demo");
  const a = d?.response.answers;
  const intent = a?.intent as ChoiceAnswer | undefined;
  const next = a?.next_action as ChoiceAnswer | undefined;
  const urgency = a?.urgency as ScoreAnswer | undefined;
  const risk = a?.risk as ScoreAnswer | undefined;
  const nouls = (["needs_human", "ambiguous", "secrecy", "disallowed"] as const).map((k) => [k, a?.[k] as NoulAnswer | undefined] as const);
  const labels = d ? Object.fromEntries(d.candidates.map((c) => [c.key, c.label])) : undefined;
  const qCount = d ? Object.keys(d.request.questions).length : 8;
  const modified = d?.effect.rules.filter((r) => r.status === "modified").length ?? 0;

  const stages: { label: string; detail: React.ReactNode }[] = [
    {
      label: "Request received",
      detail: `${turn.mode === "live" ? "POST /v1/systemone" : "simulator (no network)"} · ${qCount} questions batched · BAT ${turn.world.battery}%`,
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
      label: "Candidate actions scored",
      detail: d && d.effect.modelTop ? `${d.candidates.length} options · top: ${d.effect.modelTop.label} ${fmtPct(d.effect.modelTop.p)}` : "—",
    },
    { label: "Safety rules applied", detail: d ? `${d.effect.blocked.length} blocked · ${modified} modified · deterministic` : "—" },
    { label: "Action selected", detail: d ? `${d.effect.label} · ${d.effect.priority}` : "—" },
    {
      label: "Commentary",
      detail:
        turn.reply.status === "done"
          ? turn.reply.data.source === "generated"
            ? `generated · ${turn.reply.data.model}`
            : `scripted · ${turn.reply.data.note ?? "demo"}`
          : turn.reply.status === "error"
            ? turn.reply.error.message
            : d
              ? "writing…"
              : "—",
    },
  ];

  return (
    <div className={`decision-stack${sim ? " sim-tone" : ""}`}>
      {sim ? (
        <div className="sim-banner">
          <span className="tag sim">Simulated</span>
          <span>
            Demo mode: model outputs below come from a local heuristic, <b>not from Jev</b>. Rules and mission logic are
            the real deterministic code.
          </span>
        </div>
      ) : (
        <div className="sim-banner live-banner">
          <span className="tag live">Live</span>
          <span>
            {d ? (
              <>
                Model outputs are exactly as returned by <span className="mono">{d.model}</span>.
              </>
            ) : (
              "Calling the Jev API…"
            )}
          </span>
        </div>
      )}

      <div className="card request-card">
        <div className="card-head">
          <span className="card-title telemetry">Request</span>
          {turn.whatIf && <span className="whatif-tag">what if: {turn.whatIf}</span>}
        </div>
        <div className="request-text">“{turn.text}”</div>
        <div className="request-ctx mono">
          BAT {turn.world.battery}% · {turn.world.mission ? `MSN ${turn.world.mission.name} (${turn.world.mission.progress}%)` : "no mission"}
          {turn.world.viewers.length ? ` · ${turn.world.viewers.length} viewer requests` : ""}
          {turn.world.poll ? ` · poll ${turn.world.poll.explore}/${turn.world.poll.revisit}` : ""}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title telemetry">Pipeline</span>
          {d && (
            <span className="metric">
              <b>{d.latencyMs}</b> ms
              {d.response.usage && (
                <>
                  {" · "}
                  <b>{d.response.usage.input_tokens}</b> in / <b>{d.response.usage.output_tokens}</b> out
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
            <Source kind="model" sim={sim} />
          </div>
          <p className="card-sub">
            {describe(d?.request.questions.intent.instructions)} <span className="metric">conf <b>{fmtPct(intent.confidence)}</b></span>
          </p>
          <ChoiceBars answer={intent} />
        </div>
      )}

      {next && revealed >= 2 && (
        <div className="card reveal">
          <div className="card-head">
            <span className="card-title">
              next_action <span className="kind">choice</span>
            </span>
            <Source kind="model" sim={sim} />
          </div>
          <p className="card-sub">
            Candidate actions ranked by the model. Rules may block some; the policy takes the best allowed one.{" "}
            <span className="metric">conf <b>{fmtPct(next.confidence)}</b></span>
          </p>
          <ChoiceBars answer={next} labels={labels} blocked={d?.effect.blocked} selectedKey={d?.effect.candidateKey ?? null} />
        </div>
      )}

      {urgency && risk && revealed >= 2 && (
        <div className="card reveal">
          <div className="card-head">
            <span className="card-title">
              signals <span className="kind">score</span> <span className="kind">noul</span>
            </span>
            <Source kind="model" sim={sim} />
          </div>
          <div className="signal-head">
            <span>urgency</span>
            <span className="metric">
              score <b>{urgency.score.toFixed(2)}</b> · conf <b>{fmtPct(urgency.confidence)}</b>
            </span>
          </div>
          <ScoreBars answer={urgency} />
          <div className="signal-head">
            <span>risk</span>
            <span className="metric">
              score <b>{risk.score.toFixed(2)}</b> · conf <b>{fmtPct(risk.confidence)}</b>
            </span>
          </div>
          <ScoreBars answer={risk} />
          <div className="grid-2" style={{ marginTop: 14 }}>
            {nouls.map(([k, n]) =>
              n ? (
                <NoulGauge
                  key={k}
                  answer={n}
                  threshold={k === "needs_human" ? THRESHOLDS.needsHuman : k === "ambiguous" ? THRESHOLDS.ambiguous : k === "disallowed" ? THRESHOLDS.disallowed : undefined}
                  question={k.replace("_", " ")}
                />
              ) : null,
            )}
          </div>
          <p className="card-sub" style={{ margin: "10px 0 0" }}>│ marks a rule threshold applied to the model&apos;s probability.</p>
        </div>
      )}

      {d && revealed >= 3 && (
        <div className="card reveal">
          <div className="card-head">
            <span className="card-title telemetry">Safety &amp; policy rules</span>
            <Source kind="rule" />
          </div>
          <ul className="rules">
            {d.effect.rules.map((r) => (
              <li key={r.id} className={`rule-item ${r.status}`}>
                <span className="rule-icon" aria-hidden>
                  {RULE_ICON[r.status]}
                </span>
                <span className="rule-id mono">{r.id}</span>
                <span className="rule-body">
                  <b>{r.label}</b> <span className={`rule-status ${r.status}`}>{r.status}</span>
                  <span className="rule-detail">{r.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d && revealed >= 4 && (
        <div className={`card effect reveal${sim ? " sim-tone" : ""}`}>
          <div className="card-head">
            <span className="card-title telemetry">Selected action</span>
            <Source kind="rule" />
          </div>
          <div className="effect-action">
            {d.effect.label}
            <span className="tag neutral">{d.effect.priority}</span>
          </div>
          {d.effect.constraints.length > 0 && (
            <div className="flags">
              {d.effect.constraints.map((c) => (
                <span key={c} className="tag amber">
                  {c}
                </span>
              ))}
            </div>
          )}
          <ul className="reasons">
            {d.effect.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <MissionDelta before={d.world} after={d.worldAfter} />
        </div>
      )}

    </div>
  );
}

function MissionDelta({ before, after }: { before: World; after: World }) {
  const b = before.mission ? `${before.mission.name} (${before.mission.status})` : "none";
  const a = after.mission ? `${after.mission.name} (${after.mission.status})` : "none";
  return (
    <div className="directive">
      <span className="tm-label">MISSION</span> {b === a ? <>unchanged · {a}</> : <>{b} <span className="arrow">→</span> <b>{a}</b></>}
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
      {which === "request" && !sim && <p className="card-sub">The API key is attached server-side and never reaches the browser.</p>}
      <pre className="code">{JSON.stringify(body, null, 2)}</pre>
    </div>
  );
}
