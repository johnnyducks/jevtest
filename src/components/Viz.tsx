"use client";

import { useEffect, useState } from "react";
import type { ChoiceAnswer, Describable, NoulAnswer, ScoreAnswer } from "@/lib/jev/types";

/** Flips to true one frame after mount so CSS width transitions animate from 0. */
function useGrow() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

export const fmtPct = (p: number) => `${(p * 100).toFixed(1)}%`;

/** Returned probability of the selected choice; "n/a" if Jev omitted it (never invented). */
export const choicePct = (a: ChoiceAnswer) => {
  const p = a.probabilities[a.choice];
  return typeof p === "number" ? fmtPct(p) : "n/a";
};

export function describe(d: Describable | null | undefined): string {
  if (d == null) return "";
  return typeof d === "string" ? d : JSON.stringify(d);
}

/** A Jev choice distribution. For candidate actions, the policy's selection and blocked rows are overlaid. */
export function ChoiceBars({
  answer,
  labels,
  blocked,
  selectedKey,
}: {
  answer: ChoiceAnswer;
  /** Display labels for choice keys (falls back to the key). */
  labels?: Record<string, string>;
  /** Keys removed by deterministic rules. */
  blocked?: string[];
  /** Key the policy selected; defaults to Jev's own top choice. */
  selectedKey?: string | null;
}) {
  const grow = useGrow();
  const sel = selectedKey === undefined ? answer.choice : selectedKey;
  // Show every returned key, sorted by returned probability. Values are displayed as-is.
  const rows = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
  const stacked = !!labels;
  return (
    <div className={`bars${stacked ? " stacked" : ""}`} role="list">
      {rows.map(([name, p], i) => {
        const isBlocked = blocked?.includes(name);
        const isTop = name === answer.choice;
        return (
          <div
            key={name}
            role="listitem"
            className={`bar-row${name === sel ? " selected" : ""}${isBlocked ? " blocked" : ""}`}
            aria-label={`${labels?.[name] ?? name}: ${fmtPct(p)}${isBlocked ? ", blocked by rule" : ""}`}
          >
            <span className={`bar-label${stacked ? "" : " mono"}`} title={labels?.[name] ?? name}>
              {labels?.[name] ?? name}
              {stacked && isTop && name !== sel && <span className="mini-tag">model top</span>}
              {isBlocked && <span className="mini-tag warn">blocked</span>}
              {stacked && name === sel && <span className="mini-tag sel">selected</span>}
            </span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ width: grow ? `${Math.max(0, Math.min(1, p)) * 100}%` : 0, transitionDelay: `${i * 50}ms` }}
              />
            </span>
            <span className="bar-value">{fmtPct(p)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ScoreBars({ answer }: { answer: ScoreAnswer }) {
  const grow = useGrow();
  const keys = Object.keys(answer.probabilities).sort((a, b) => Number(a) - Number(b));
  const max = Math.max(0, ...keys.map(Number));
  const top = keys.reduce((best, k) => (answer.probabilities[k] > answer.probabilities[best] ? k : best), keys[0]);
  const markerPct = max > 0 ? (Math.max(0, Math.min(max, answer.score)) / max) * 100 : 0;
  return (
    <>
      <div className="bars" role="list">
        {keys.map((k, i) => {
          const p = answer.probabilities[k];
          return (
            <div
              key={k}
              role="listitem"
              className={`bar-row wide-label${k === top ? " selected" : ""}`}
              title={describe(answer.legend[k])}
            >
              <span className="bar-label">
                <span className="mono dim">{k}</span> {describe(answer.legend[k])}
              </span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{ width: grow ? `${Math.max(0, Math.min(1, p)) * 100}%` : 0, transitionDelay: `${i * 60}ms` }}
                />
              </span>
              <span className="bar-value">{fmtPct(p)}</span>
            </div>
          );
        })}
      </div>
      <div className="scale" aria-label={`Expected score ${answer.score.toFixed(2)} of ${max}`}>
        <span className="scale-track" />
        {keys.map((k) => (
          <span key={k} className="scale-tick" style={{ left: `${max ? (Number(k) / max) * 100 : 0}%` }} />
        ))}
        <span className="scale-marker" style={{ left: grow ? `${markerPct}%` : 0 }} />
      </div>
    </>
  );
}

export function NoulGauge({ answer, threshold, question }: { answer: NoulAnswer; threshold?: number; question: string }) {
  const grow = useGrow();
  const p = Math.max(0, Math.min(1, answer.noul));
  return (
    <div className="noul">
      <div className="noul-q">{question}</div>
      <div className="noul-track" aria-label={`Probability yes: ${fmtPct(p)}`}>
        <span className="noul-fill" style={{ width: grow ? `${p * 100}%` : 0 }} />
        {threshold !== undefined && (
          <span className="noul-threshold" style={{ left: `${threshold * 100}%` }} title={`Policy threshold ${fmtPct(threshold)}`} />
        )}
      </div>
      <div className="noul-legend">
        <span>no</span>
        <span className="metric">
          P(yes) <b>{fmtPct(p)}</b>
        </span>
        <span>yes</span>
      </div>
    </div>
  );
}

export function Spark({ answer, sim }: { answer: ChoiceAnswer; sim: boolean }) {
  const vals = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
  return (
    <span className={`spark${sim ? " sim-tone" : ""}`} aria-hidden>
      {vals.map(([k, v]) => (
        <i key={k} className={k === answer.choice ? "top" : ""} style={{ height: `${Math.max(2, v * 20)}px` }} />
      ))}
    </span>
  );
}
