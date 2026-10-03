"use client";

import { useEffect, useRef, useState } from "react";
import { THRESHOLDS } from "@/lib/decision/policy";
import type { World } from "@/lib/marty/world";

const batteryTone = (b: number) => (b < THRESHOLDS.batteryCritical ? "crit" : b < THRESHOLDS.batteryLow ? "low" : "ok");

/** The simulated world Marty is currently deciding against. */
export function MissionPanel({ world, title = "Mission state" }: { world: World; title?: string }) {
  const tone = batteryTone(world.battery);
  const totalVotes = world.viewers.reduce((a, v) => a + v.votes, 0) || 1;
  const pollTotal = world.poll ? world.poll.explore + world.poll.revisit || 1 : 1;
  return (
    <div className="card mission">
      <div className="card-head">
        <span className="card-title telemetry">{title}</span>
        <span className="tag neutral" title="Sandbox state. No physical robot is connected.">
          simulated world
        </span>
      </div>

      <div className="telemetry-grid">
        <div className="tm">
          <span className="tm-label">BAT</span>
          <span className={`battery ${tone}`} aria-label={`Battery ${world.battery}%`}>
            <span className="battery-fill" style={{ width: `${world.battery}%` }} />
          </span>
          <span className={`tm-value mono ${tone}`}>{world.battery}%</span>
        </div>
        <div className="tm">
          <span className="tm-label">LOC</span>
          <span className="tm-text">{world.location}</span>
        </div>
      </div>

      <div className="mission-now">
        <span className="tm-label">MSN</span>
        {world.mission ? (
          <div className="mission-body">
            <div className="mission-name">
              {world.mission.name}
              <span className={`status-chip ${world.mission.status}`}>{world.mission.status}</span>
            </div>
            <div className="progress" aria-label={`Progress ${world.mission.progress}%`}>
              <span style={{ width: `${world.mission.progress}%` }} />
            </div>
          </div>
        ) : (
          <span className="tm-text dim">No active mission</span>
        )}
      </div>
      {world.pausedMission && (
        <div className="mission-paused mono">
          <span className="tm-label">PAUSED</span> {world.pausedMission}
        </div>
      )}

      {world.viewers.length > 0 && (
        <div className="queue">
          <span className="tm-label">VIEWER QUEUE</span>
          {world.viewers.map((v) => (
            <div key={v.handle} className={`queue-row${v.accepted ? " accepted" : ""}`}>
              <span className="queue-who mono">@{v.handle}</span>
              <span className="queue-req">{v.request}</span>
              <span className="queue-votes mono">
                {v.votes}
                <i style={{ width: `${(v.votes / totalVotes) * 100}%` }} />
              </span>
            </div>
          ))}
        </div>
      )}

      {world.poll && (
        <div className="queue">
          <span className="tm-label">AUDIENCE POLL</span>
          {(["explore", "revisit"] as const).map((k) => (
            <div key={k} className="queue-row">
              <span className="queue-who mono">{k === "explore" ? "EXPLORE" : "REVISIT"}</span>
              <span className="queue-req">{k === "explore" ? "Somewhere new" : "A popular area"}</span>
              <span className="queue-votes mono">
                {world.poll![k]}
                <i style={{ width: `${(world.poll![k] / pollTotal) * 100}%` }} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "What if?" controls for the selected decision's scenario variables.
 * A change (after a short pause) re-runs the same message against the edited world.
 */
export function WhatIf({
  world,
  disabled,
  onRun,
}: {
  world: World;
  disabled: boolean;
  onRun: (w: World, label: string) => void;
}) {
  const [draft, setDraft] = useState<World>(world);
  const dirty = useRef(false);
  const base = useRef(world);
  const run = useRef(onRun);
  run.current = onRun;

  // Reset when a different decision is selected.
  useEffect(() => {
    setDraft(world);
    base.current = world;
    dirty.current = false;
  }, [world]);

  useEffect(() => {
    if (!dirty.current || disabled) return;
    const id = setTimeout(() => {
      const label = describeChange(base.current, draft);
      if (!label) return;
      dirty.current = false;
      run.current(draft, label);
    }, 700);
    return () => clearTimeout(id);
  }, [draft, disabled]);

  const edit = (fn: (w: World) => void) => {
    const next = structuredClone(draft);
    fn(next);
    dirty.current = true;
    setDraft(next);
  };

  return (
    <div className="card whatif">
      <div className="card-head">
        <span className="card-title telemetry">What if?</span>
        <span className="metric dim">{disabled ? "waiting…" : "change a variable to re-decide"}</span>
      </div>

      <label className="wi-row">
        <span className="tm-label">BATTERY</span>
        <input
          type="range"
          min={0}
          max={100}
          value={draft.battery}
          disabled={disabled}
          onChange={(e) => edit((w) => (w.battery = Number(e.target.value)))}
          aria-label="Battery percent"
        />
        <span className={`tm-value mono ${batteryTone(draft.battery)}`}>{draft.battery}%</span>
      </label>

      {draft.viewers.map((v, i) => (
        <Stepper
          key={v.handle}
          label={`@${v.handle}`}
          value={v.votes}
          disabled={disabled}
          onChange={(n) => edit((w) => (w.viewers[i].votes = n))}
        />
      ))}
      {draft.poll && (
        <>
          <Stepper label="poll · explore" value={draft.poll.explore} disabled={disabled} onChange={(n) => edit((w) => (w.poll!.explore = n))} />
          <Stepper label="poll · revisit" value={draft.poll.revisit} disabled={disabled} onChange={(n) => edit((w) => (w.poll!.revisit = n))} />
        </>
      )}
    </div>
  );
}

function Stepper({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (n: number) => void }) {
  const set = (n: number) => onChange(Math.max(0, Math.min(999, n)));
  return (
    <div className="wi-row">
      <span className="tm-label wi-name">{label}</span>
      <div className="stepper">
        <button className="btn" disabled={disabled || value <= 0} onClick={() => set(value - 5)} aria-label={`${label} minus 5`}>
          −5
        </button>
        <span className="mono stepper-val">{value}</span>
        <button className="btn" disabled={disabled} onClick={() => set(value + 5)} aria-label={`${label} plus 5`}>
          +5
        </button>
      </div>
      <span className="tm-value mono dim">votes</span>
    </div>
  );
}

function describeChange(a: World, b: World): string {
  const parts: string[] = [];
  if (a.battery !== b.battery) parts.push(`battery ${a.battery}%→${b.battery}%`);
  b.viewers.forEach((v, i) => {
    const before = a.viewers[i]?.votes;
    if (before !== undefined && before !== v.votes) parts.push(`@${v.handle} ${before}→${v.votes} votes`);
  });
  if (a.poll && b.poll) {
    if (a.poll.explore !== b.poll.explore) parts.push(`explore ${a.poll.explore}→${b.poll.explore}`);
    if (a.poll.revisit !== b.poll.revisit) parts.push(`revisit ${a.poll.revisit}→${b.poll.revisit}`);
  }
  return parts.join(", ");
}
