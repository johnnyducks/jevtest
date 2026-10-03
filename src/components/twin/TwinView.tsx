"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { postJson } from "@/lib/api";
import type { DecisionResult, Mode } from "@/lib/decision/contracts";
import { DEFAULT_WORLD } from "@/lib/marty/world";
import { TwinController } from "@/lib/twin/controller";
import { ENVIRONMENT } from "@/lib/twin/environment";
import { makeTransform } from "@/lib/twin/geometry";
import { buildGrid } from "@/lib/twin/grid";
import { SimulatedMotion } from "@/lib/twin/motion";
import { Send } from "../icons";
import TwinMap from "./TwinMap";
import TwinPanel, { StatusChip } from "./TwinPanel";

const GRID = buildGrid(ENVIRONMENT);
const VIEW = makeTransform(ENVIRONMENT.width, ENVIRONMENT.height);

const EXAMPLES = [
  "Go to Griffey.",
  "Take me to Rickey Henderson.",
  "Go to Bonds.",
  "Visit the nearest card.",
  "Go to Honus Wagner.",
  "Go to the other side of the room.",
  "Stop.",
];

/**
 * Digital-twin workspace: map + mission/decision panel + request input.
 * The decision engine is the same /api/decide route used by the Brain lab,
 * called with a twin context so Jev chooses among navigation actions.
 */
export default function TwinView({ mode }: { mode: Mode }) {
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const [{ motion, ctl }] = useState(() => {
    const motion = new SimulatedMotion(ENVIRONMENT.defaultPose);
    const ctl = new TwinController({
      env: ENVIRONMENT,
      grid: GRID,
      motion,
      decide: ({ message, twin }) =>
        postJson<DecisionResult>("/api/decide", { message, mode: modeRef.current, world: DEFAULT_WORLD, twin }),
    });
    return { motion, ctl };
  });

  const state = useSyncExternalStore(ctl.subscribe, ctl.getState, ctl.getState);
  const pose = useSyncExternalStore(motion.subscribe, motion.getState, motion.getState);
  const [draft, setDraft] = useState("");
  const [speed, setSpeed] = useState(motion.getSpeed());
  const [showClearance, setShowClearance] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => () => motion.stop(), [motion]);
  useEffect(() => {
    if (!state.notice) return;
    const t = setTimeout(() => ctl.clearNotice(), 4500);
    return () => clearTimeout(t);
  }, [state.notice, ctl]);

  const latest = state.missions.at(-1);
  const shown = state.missions.find((m) => m.id === selected) ?? latest;
  const onMap = state.missions.find((m) => m.id === state.activeId);
  const canResume = state.missions.find((m) => m.id === state.activeId)?.status === "stopped";

  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setSelected(null);
    void ctl.submit(t);
    setDraft("");
  };

  return (
    <div className="twin">
      <section className="twin-stage" aria-label="Digital twin map">
        <div className="map-toolbar">
          <span className="sim-badge" title="Browser simulation. No commands are sent to the physical Moorebot Scout.">
            <span className="dot sim" /> SIMULATION · not live Scout telemetry
          </span>
          <div className="toolbar-spacer" />
          <button className="btn danger" onClick={() => ctl.stop()} disabled={pose.status !== "moving"}>
            ■ Stop
          </button>
          <button className="btn" onClick={() => ctl.resume()} disabled={!canResume}>
            ▶ Resume
          </button>
          <button className="btn" onClick={() => (setSelected(null), ctl.reset())}>
            ↺ Reset
          </button>
        </div>

        <div className="map-frame">
          <TwinMap
            env={ENVIRONMENT}
            grid={GRID}
            view={VIEW}
            motion={pose}
            mission={onMap}
            showClearance={showClearance}
            onPlace={(p) => ctl.placeRobot(p)}
            onCardGo={(c) => send(`Go to ${c.name}`)}
          />
          {state.notice && <div className={`map-notice ${state.notice.kind}`}>{state.notice.text}</div>}
        </div>

        <div className="map-controls">
          <label className="ctl">
            <span className="tm-label">Speed</span>
            <input
              type="range"
              min={0.2}
              max={1.5}
              step={0.1}
              value={speed}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSpeed(v);
                motion.setSpeed(v);
              }}
              aria-label="Simulated speed, meters per second"
            />
            <span className="mono">{speed.toFixed(1)} m/s</span>
          </label>
          <div className="ctl">
            <span className="tm-label">Heading</span>
            <button className="btn" onClick={() => ctl.rotateRobot(Math.PI / 12)} disabled={pose.status === "moving"} aria-label="Rotate left 15 degrees">
              ⟲ 15°
            </button>
            <button className="btn" onClick={() => ctl.rotateRobot(-Math.PI / 12)} disabled={pose.status === "moving"} aria-label="Rotate right 15 degrees">
              ⟳ 15°
            </button>
          </div>
          <label className="ctl">
            <input type="checkbox" checked={showClearance} onChange={(e) => setShowClearance(e.target.checked)} />
            <span className="tm-label">Clearance zones</span>
          </label>
          <span className="hint dim">Drag Marty to set a start position · click a card to send Marty there</span>
        </div>

        <div className="twin-input">
          <div className="composer-examples" aria-label="Example requests">
            {EXAMPLES.map((e) => (
              <button key={e} className="example" onClick={() => send(e)}>
                {e}
              </button>
            ))}
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <span className="composer-prompt mono" aria-hidden>
              OP&gt;
            </span>
            <input
              className="twin-text"
              value={draft}
              maxLength={300}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={mode === "live" ? "Tell Marty where to go. Interpreted live by Jev…" : "Tell Marty where to go (demo: simulated interpretation)…"}
              aria-label="Request for Marty"
            />
            <button className="send" type="submit" disabled={!draft.trim()} aria-label="Send">
              <Send />
            </button>
          </form>
        </div>
      </section>

      <aside className="twin-side" aria-label="Mission and decision">
        <TwinPanel
          mission={shown}
          motion={pose}
          speed={speed}
          onClarify={(id) => ctl.chooseClarification(id)}
          onRetry={(t) => send(t)}
        />

        <div className="section-title" style={{ marginTop: 6 }}>
          <span>Mission log</span>
          <span className="mono">{state.missions.length}</span>
        </div>
        {state.missions.length === 0 ? (
          <div className="card inspector-idle">Requests and their outcomes will be logged here.</div>
        ) : (
          <ol className="timeline">
            {[...state.missions].reverse().map((m) => (
              <li key={m.id}>
                <button className="tl-item" aria-current={m.id === shown?.id} onClick={() => setSelected(m.id)}>
                  <span className="tl-index">#{m.seq}</span>
                  <span className="tl-body">
                    <div className="tl-msg">{m.request}</div>
                    <div className="tl-meta">
                      {m.target ? `→ ${m.target.name}` : m.decision ? m.decision.actionLabel : "…"}
                      {m.plan?.status === "ok" ? ` · ${m.plan.length} m` : ""}
                    </div>
                  </span>
                  <StatusChip status={m.status} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
