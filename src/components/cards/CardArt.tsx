"use client";

import { useCallback, useEffect, useState } from "react";
import type { CardArt, CardArtBody } from "@/lib/cardsight/types";
import type { Card } from "@/lib/twin/environment";

/** Card artwork for the room, from /api/cards (CardSight AI + any images added in public/cards). */
export function useCardArt(): [Record<string, CardArt>, () => void] {
  const [art, setArt] = useState<Record<string, CardArt>>({});
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) =>
      fetch("/api/cards")
        .then((r) => (r.ok ? (r.json() as Promise<CardArtBody>) : null))
        .catch(() => null)
        .then((body) => {
          if (!alive || !body) return;
          setArt(body.cards);
          // Lookups that failed for a passing reason (rate limit, network) get one more try.
          if (attempt < 2 && Object.values(body.cards).some((c) => c.status === "error")) timer = setTimeout(() => load(attempt + 1), 65_000);
        });
    void load(0);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [version]);
  return [art, reload];
}

function Face({ src, label, empty }: { src: string | null; label: string; empty: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="card-face">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} onError={() => setFailed(true)} />
      ) : (
        <div className="card-face-empty mono">{failed ? "Image unavailable right now" : empty}</div>
      )}
      <figcaption className="mono">{label}</figcaption>
    </figure>
  );
}

function Meta({ card, art }: { card: Card; art?: CardArt }) {
  const cs = art?.cardsight;
  return (
    <div className="card-meta">
      <div className="card-meta-title">{card.name}</div>
      <div className="card-meta-sub">
        {cs ? (
          <>
            {cs.releaseName ?? `${card.year}`}
            {cs.setName && !/^base$/i.test(cs.setName) ? ` · ${cs.setName}` : ""}
            {cs.number ? ` · #${cs.number}` : ""}
          </>
        ) : (
          <>
            {card.meta.set ?? card.year} · {card.team}
          </>
        )}
      </div>
      {cs?.description && <p className="card-meta-desc">{cs.description}</p>}
      <div className="card-meta-src mono">
        {art?.status === "matched" ? (
          <>
            CardSight AI catalog{art.confidence === "likely" ? " · likely match" : ""}
          </>
        ) : (
          (art?.note ?? "Looking up the card…")
        )}
        {art?.backSource === "local" && " · back image added locally"}
      </div>
    </div>
  );
}

/** Floating preview while the pointer is over a card on the 2D map. */
export function CardHover({ card, art, at, points }: { card: Card; art?: CardArt; at: { x: number; y: number }; points: number }) {
  const w = art?.back ? 300 : 190;
  const left = Math.min(window.innerWidth - w - 12, Math.max(12, at.x + 16));
  const top = Math.min(window.innerHeight - 330, Math.max(12, at.y - 140));
  return (
    <div className="card-hover" style={{ left, top, width: w }} role="tooltip">
      <div className="card-hover-faces">
        <Face src={art?.front ?? null} label="Front" empty="No image" />
        {art?.back && <Face src={art.back} label="Back" empty="No image" />}
      </div>
      <Meta card={card} art={art} />
      <div className="card-hover-foot mono">{points ? `${points} pts · ` : ""}click to send Marty</div>
    </div>
  );
}

/** Full card view: front and back (when there is one), details, and a button to send Marty. */
export function CardModal({ card, art, onClose, onGo }: { card: Card; art?: CardArt; onClose: () => void; onGo: () => void }) {
  const [side, setSide] = useState<"front" | "back">("front");
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="card-modal-backdrop" onClick={onClose}>
      <div className="card-modal" role="dialog" aria-modal="true" aria-label={card.name} onClick={(e) => e.stopPropagation()}>
        <button className="card-modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className={`card-modal-faces${art?.back ? " two" : ""}`}>
          {/* Wide screens show both sides; narrow ones flip between them. */}
          <div className={`side front${side === "front" ? " on" : ""}`}>
            <Face src={art?.front ?? null} label="Front" empty={art?.status === "matched" ? "No image in the catalog" : "No image yet"} />
          </div>
          {art?.back && (
            <div className={`side back${side === "back" ? " on" : ""}`}>
              <Face src={art.back} label="Back" empty="No image" />
            </div>
          )}
        </div>
        {art?.back && (
          <button className="btn card-flip" onClick={() => setSide((s) => (s === "front" ? "back" : "front"))}>
            ⟲ Show {side === "front" ? "back" : "front"}
          </button>
        )}
        {!art?.back && <p className="card-modal-note">Back not available: CardSight provides card fronts only.</p>}
        <Meta card={card} art={art} />
        <button className="btn accent card-go" onClick={onGo}>
          Send Marty to {card.name}
        </button>
      </div>
    </div>
  );
}
