"use client";

import type { DecisionSummary, Mission, MissionStatus } from "@/lib/twin/controller";
import { toDegrees } from "@/lib/twin/geometry";
import type { MotionState } from "@/lib/twin/motion";
import { ChoiceBars, fmtPct } from "../Viz";

const STATUS_LABEL: Record<MissionStatus, string> = {
  received: "Request received",
  interpreting: "Interpreting request",
  resolving: "Resolving target",
  planning: "Planning route",
  route_ready: "Route ready",
  moving: "Moving",
  arrived: "Arrived",
  stopped: "Stopped",
  cancelled: "Cancelled",
  needs_clarification: "Needs clarification",
  no_route: "No valid route",
  rejected: "Declined",
  answered: "Answered",
  error: "Error",
};

const TONE: Partial<Record<MissionStatus, string>> = {
  moving: "live",
  route_ready: "live",
  arrived: "ok",
  stopped: "warn",
  cancelled: "muted",
  needs_clarification: "warn",
  no_route: "bad",
  rejected: "bad",
  error: "bad",
  answered: "muted",
};

export function StatusChip({ status }: { status: MissionStatus }) {
  return <span className={`m-chip ${TONE[status] ?? "busy"}`}>{STATUS_LABEL[status]}</span>;
}

function SourceTag({ d }: { d: DecisionSummary | undefined }) {
  if (!d) return null;
  if (d.source === "rule") return <span className="tag rule" title="Deterministic application logic, not a model output">rule</span>;
  return (
    <span className="tag live" title="Returned by Jev">
      model · jev
    </span>
  );
}

const Det = () => (
  <span className="tag rule" title="Deterministic application logic">
    deterministic
  </span>
);

/** Decision trace for one mission: lifecycle, interpretation, target, route and alternatives. */
export function MissionTrace({ mission: m }: { mission: Mission }) {
  return (
    <div className="mission-trace">
      <ol className="lifecycle">
        {m.transitions.map((t, i) => (
          <li key={i} className={i === m.transitions.length - 1 ? "current" : ""}>
            <span className="lc-dot" />
            <span className="lc-label">{STATUS_LABEL[t.status]}</span>
            <span className="lc-time mono">+{Math.max(0, t.at - m.createdAt)} ms</span>
            {t.note && <span className="lc-note">{t.note}</span>}
          </li>
        ))}
      </ol>
      {m.explanation && <p className="explanation">{m.explanation}</p>}
    <dl className="trace">
      <dt>Intent</dt>
      <dd>
        {m.decision?.intent ? (
          <>
            <b>{m.decision.intent.choice}</b>{" "}
            <span className="mono dim">conf {fmtPct(m.decision.intent.confidence)}</span> <SourceTag d={m.decision} />
          </>
        ) : m.decision?.source === "rule" ? (
          <span className="dim">not interpreted by a model</span>
        ) : (
          <span className="dim">{m.status === "interpreting" ? "awaiting decision…" : "—"}</span>
        )}
      </dd>

      <dt>Action</dt>
      <dd>
        {m.decision ? (
          <>
            <b>{m.decision.actionLabel}</b> <SourceTag d={m.decision} />
            {m.decision.reasons[0] && <div className="trace-sub">{m.decision.reasons[0]}</div>}
          </>
        ) : (
          "—"
        )}
      </dd>

      <dt>Target</dt>
      <dd>
        {m.resolution ? (
          <>
            {m.resolution.status === "resolved" ? (
              <b>{m.resolution.target.name}</b>
            ) : m.resolution.status === "ambiguous" ? (
              <b>Ambiguous</b>
            ) : (
              <b>Not found</b>
            )}{" "}
            <Det />
            <div className="trace-sub">
              {m.resolution.status === "resolved"
                ? `${m.resolution.target.id} · ${m.resolution.method}${m.resolution.matched ? ` “${m.resolution.matched}”` : ""}`
                : m.resolution.status === "ambiguous"
                  ? `“${m.resolution.matched}” → ${m.resolution.options.map((o) => o.id).join(", ")}`
                  : m.resolution.detail}
            </div>
          </>
        ) : (
          "—"
        )}
      </dd>

      <dt>Route</dt>
      <dd>
        {m.plan ? (
          <>
            <b>{m.plan.status === "ok" ? `${m.plan.length} m · ${m.plan.waypoints.length - 1} leg${m.plan.waypoints.length === 2 ? "" : "s"}` : m.plan.status.replace("_", " ")}</b> <Det />
            <div className="trace-sub">
              A* on a {m.plan.status === "ok" ? `${m.plan.rawCells}-cell path` : "grid"} · {m.plan.expanded} cells searched
              {m.plan.status === "ok" && (m.plan.detour ? " · detour (direct line blocked)" : " · direct")}
            </div>
          </>
        ) : (
          "—"
        )}
      </dd>
    </dl>

    {m.decision?.nextAction && m.decision.source !== "rule" && (
      <details className="alternatives">
        <summary>
          Alternatives the model considered <SourceTag d={m.decision} />
        </summary>
        <ChoiceBars
          answer={m.decision.nextAction}
          labels={m.decision.labels}
          blocked={m.decision.blocked}
          selectedKey={m.decision.labels && m.decision.action in m.decision.labels ? m.decision.action : null}
        />
        {m.decision.rules.some((r) => r.status !== "pass") && (
          <ul className="reasons">
            {m.decision.rules
              .filter((r) => r.status !== "pass")
              .map((r) => (
                <li key={r.id}>
                  {r.id} {r.label}: {r.detail}
                </li>
              ))}
          </ul>
        )}
        <p className="card-sub" style={{ margin: "8px 0 0" }}>
          {`Values exactly as returned by ${m.decision.model}`}
          {m.decision.latencyMs !== undefined ? ` · ${m.decision.latencyMs} ms` : ""}
        </p>
      </details>
    )}
    </div>
  );
}

/** Compact live readout of Marty's pose and motion, overlaid on the map. */
export function MapHud({ motion, speed }: { motion: MotionState; speed: number }) {
  const remaining =
    motion.status === "moving" && motion.path.length
      ? motion.path.slice(motion.waypoint).reduce((acc, p, i, arr) => {
          const prev = i === 0 ? motion.pose : arr[i - 1];
          return acc + Math.hypot(p.x - prev.x, p.y - prev.y);
        }, 0)
      : 0;
  return (
    <div className="map-hud mono" aria-label="Marty's position">
      <span className={`m-chip ${motion.status === "moving" ? "live" : motion.status === "arrived" ? "ok" : motion.status === "stopped" ? "warn" : "muted"}`}>
        {motion.status}
      </span>
      <span className="hud-coord">
        X <b>{motion.pose.x.toFixed(2)}</b>
      </span>
      <span className="hud-coord">
        Y <b>{motion.pose.y.toFixed(2)}</b>
      </span>
      <span className="hud-coord">
        HDG <b>{((toDegrees(motion.pose.heading) + 360) % 360).toFixed(0)}°</b>
      </span>
      {motion.status === "moving" && (
        <span>
          <b>{speed.toFixed(1)}</b> m/s · <b>{remaining.toFixed(1)}</b> m left
        </span>
      )}
    </div>
  );
}
