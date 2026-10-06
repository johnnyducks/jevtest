"use client";

import type { DriveKey } from "@/lib/twin/teleop";

const ROWS: { code: DriveKey; key: string; hint: string; label: string }[][] = [
  [
    { code: "KeyQ", key: "Q", hint: "↺", label: "rotate left" },
    { code: "KeyW", key: "W", hint: "↑", label: "forward" },
    { code: "KeyE", key: "E", hint: "↻", label: "rotate right" },
  ],
  [
    { code: "KeyA", key: "A", hint: "←", label: "strafe left" },
    { code: "KeyS", key: "S", hint: "↓", label: "backward" },
    { code: "KeyD", key: "D", hint: "→", label: "strafe right" },
  ],
];

const LABEL = { locked: "locked", stop: "stopped", precise: "25% speed", drive: "driving", ready: "ready" } as const;

/** The WASD/QE layout over the FPV view; keys light up while held. Display only: the keyboard does the driving. */
export default function TeleopPad({
  held,
  precision,
  driving,
  stopFlash,
  locked,
}: {
  held: ReadonlySet<DriveKey>;
  precision: boolean;
  driving: boolean;
  stopFlash: boolean;
  /** An operator key is required and not entered: show the layout, dimmed, with a note. */
  locked: boolean;
}) {
  const state = locked ? "locked" : stopFlash ? "stop" : driving ? (precision ? "precise" : "drive") : precision ? "precise" : "ready";
  return (
    <div className={`teleop mono${locked ? " locked" : ""}`} aria-label="Keyboard driving controls">
      <div className="teleop-head">
        <span>Drive</span>
        <span className={`teleop-state ${state}`}>{LABEL[state]}</span>
      </div>
      <div className="teleop-keys">
        {ROWS.map((row, i) => (
          <div key={i} className="teleop-row">
            {row.map((k) => (
              <kbd key={k.code} className={held.has(k.code) ? "on" : ""} title={k.label}>
                {k.key}
                <i aria-hidden>{k.hint}</i>
              </kbd>
            ))}
          </div>
        ))}
      </div>
      <div className="teleop-mods">
        <kbd className={`wide${precision ? " on precise" : ""}`} title="Hold for precision mode (about 25% speed)">
          Shift
        </kbd>
        <kbd className={`wide${stopFlash ? " on stop" : ""}`} title="Stop">
          Space
        </kbd>
      </div>
      {locked && <div className="teleop-note">Operator key needed (gear menu)</div>}
    </div>
  );
}
