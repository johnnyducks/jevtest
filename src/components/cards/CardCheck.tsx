"use client";

import { useEffect, useState } from "react";
import type { CardDiagnosis } from "@/lib/cardsight/server";

interface Report {
  configured: boolean;
  base: string;
  keyLength: number;
  cards: CardDiagnosis[];
}

/** Runs every card lookup again and shows what CardSight returned, in plain words. */
export default function CardCheck({ opKey, onClose, onDone }: { opKey: string; onClose: () => void; onDone: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/cards/debug", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: opKey || undefined }) })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as (Report & { error?: { message?: string } }) | null;
        if (!alive) return;
        if (!r.ok || !j) setError(j?.error?.message ?? `HTTP ${r.status}`);
        else {
          setReport(j);
          onDone();
        }
      })
      .catch(() => alive && setError("Couldn't reach the app's server."));
    return () => {
      alive = false;
    };
  }, [opKey, onDone]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const matched = report?.cards.filter((c) => c.outcome.startsWith("Matched")).length ?? 0;

  return (
    <div className="card-modal-backdrop" onClick={onClose}>
      <div className="card-modal card-check" role="dialog" aria-modal="true" aria-label="Check card images" onClick={(e) => e.stopPropagation()}>
        <button className="card-modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="pop-title">Card images · CardSight AI</div>
        {error && <p className="pop-warn">{error}</p>}
        {!report && !error && (
          <p className="mono dim">
            <span className="typing small">
              <i />
              <i />
              <i />
            </span>{" "}
            Looking up all 11 cards again. This takes a few seconds…
          </p>
        )}
        {report && (
          <>
            <p className="cc-summary">
              {!report.configured
                ? "No CardSight key is set on the server. Add CARDSIGHT_API_KEY to .env.local and restart the app."
                : `${matched} of ${report.cards.length} cards matched. Key is set (${report.keyLength} characters), server ${report.base}.`}
            </p>
            <ul className="cc-list">
              {report.cards.map((c) => (
                <li key={c.cardId} className={c.outcome.startsWith("Matched") ? "ok" : "bad"}>
                  <div className="cc-head">
                    <b>{c.name}</b>
                    <span>{c.outcome}</span>
                  </div>
                  {c.image && <div className={`cc-sub mono ${c.image.ok ? "" : "warn"}`}>image: {c.image.detail}</div>}
                  {c.searches.length > 0 && (
                    <div className="cc-sub mono">
                      searched: {c.searches.map((s) => `"${s.q}" (${s.filters}) → ${s.error ? `error: ${s.error}` : `${s.results} results`}`).join(" · ")}
                    </div>
                  )}
                  {!c.outcome.startsWith("Matched") && c.candidates.length > 0 && (
                    <details>
                      <summary className="mono">closest results</summary>
                      <ul className="cc-cands mono">
                        {c.candidates.map((h, i) => (
                          <li key={i}>
                            {h.name} · {h.year ?? "?"} · {h.release ?? "?"}
                            {h.set ? ` / ${h.set}` : ""} · #{h.number ?? "?"} → <em>{h.verdict}</em>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
            <p className="card-meta-src mono">If a card isn&apos;t matched, take a screenshot of this screen and send it over.</p>
          </>
        )}
      </div>
    </div>
  );
}
