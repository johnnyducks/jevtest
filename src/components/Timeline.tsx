"use client";

import type { ChoiceAnswer } from "@/lib/jev/types";
import type { Turn } from "./types";
import { choicePct, Spark } from "./Viz";

interface Props {
  turns: Turn[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

/** Chronological decision log for this session (newest first). */
export default function Timeline({ turns, selectedId, onSelect }: Props) {
  if (!turns.length) return <div className="card inspector-idle">Decisions will be logged here for this session.</div>;

  return (
    <ol className="timeline">
      {turns
        .map((t, i) => ({ t, i }))
        .reverse()
        .map(({ t, i }) => {
          const d = t.decision.status === "done" ? t.decision.data : null;
          const intent = d?.response.answers.intent as ChoiceAnswer | undefined;
          const sim = t.mode === "demo";
          const time = new Date(t.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          return (
            <li key={t.id}>
              <button className="tl-item" aria-current={t.id === selectedId} onClick={() => onSelect(t.id)}>
                <span className="tl-index">#{i + 1}</span>
                <span className="tl-body">
                  <div className="tl-msg">
                    {t.whatIf ? <span className="whatif-tag">what if</span> : null}
                    {t.text}
                  </div>
                  <div className="tl-meta">
                    {time} · BAT {t.world.battery}% ·{" "}
                    {t.decision.status === "pending"
                      ? "thinking…"
                      : t.decision.status === "error"
                        ? `error: ${t.decision.error.code}`
                        : intent && d
                          ? `${intent.choice} ${choicePct(intent)} → ${d.effect.label}`
                          : "—"}
                  </div>
                  {t.whatIf && <div className="tl-meta">{t.whatIf}</div>}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {intent && <Spark answer={intent} sim={sim} />}
                  <span className={`tag ${sim ? "sim" : "live"}`}>{sim ? "sim" : "live"}</span>
                </span>
              </button>
            </li>
          );
        })}
    </ol>
  );
}
