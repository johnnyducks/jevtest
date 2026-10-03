"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { LiveSnapshot } from "@/lib/live/types";
import { HANDLE } from "@/lib/live/types";
import { type Card, ENVIRONMENT } from "@/lib/twin/environment";
import { makeTransform } from "@/lib/twin/geometry";
import { buildGrid } from "@/lib/twin/grid";
import { Gear, Help, Send } from "../icons";
import { CardHover, CardModal, useCardArt } from "../cards/CardArt";
import CardCheck from "../cards/CardCheck";
import Popover from "../Popover";
import TwinMap from "../twin/TwinMap";
import LiveChat from "./LiveChat";
import { useLive, useSmoothPose, useStored } from "./useLive";

// The 3D views load only when someone opens them, so the 2D map stays as light as before.
const Room3D = dynamic(() => import("../three/Room3D"), {
  ssr: false,
  loading: () => <div className="three-fallback mono">Loading 3D…</div>,
});

type ViewMode = "2d" | "orbit" | "fpv";
const VIEWS: { id: ViewMode; label: string; title: string }[] = [
  { id: "2d", label: "2D", title: "Top-down map" },
  { id: "orbit", label: "3D", title: "3D observer: drag to orbit, scroll to zoom" },
  { id: "fpv", label: "FPV", title: "First-person: Marty's camera" },
];

const GRID = buildGrid(ENVIRONMENT);
const VIEW = makeTransform(ENVIRONMENT.width, ENVIRONMENT.height);

async function post(url: string, body: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
    return { ok: r.ok, message: j?.error?.message ?? j?.message ?? (r.ok ? "" : `HTTP ${r.status}`) };
  } catch {
    return { ok: false, message: "Network error. Is the server running?" };
  }
}

const fmtTime = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`);

/** Battery, range and trip readout over the map. */
function Hud({ snap }: { snap: LiveSnapshot }) {
  const t = snap.telemetry;
  const b = t.battery;
  const tone = b.dead ? "bad" : b.level < 20 ? "bad" : b.level < 40 ? "warn" : "ok";
  return (
    <div className="map-hud live-hud mono" aria-label="Marty's status">
      <span className={`m-chip ${t.status === "moving" ? "live" : t.status === "stopped" ? "warn" : "muted"}`}>{t.status}</span>
      <span className={`battery ${tone}`} title={`Battery ${b.level}%. Drains about 0.6% per meter driven; recharges at the dock.`}>
        <span className="battery-shell">
          <span className="battery-fill" style={{ width: `${Math.max(0, Math.min(100, b.level))}%` }} />
        </span>
        <b>{Math.round(b.level)}%</b>
        {b.charging && <span className="charging">⚡</span>}
      </span>
      <span title={`Driving range above the ${b.reserve}% reserve`}>
        <b>{Math.round(b.range)}</b> m range
      </span>
      {t.trip && (
        <span>
          <b>{t.trip.remainingMeters.toFixed(1)}</b> m left · ETA <b>{fmtTime(t.trip.etaSeconds)}</b>
        </span>
      )}
    </div>
  );
}

/** Points leaderboard and live bonuses. */
function Scoreboard({ snap, me }: { snap: LiveSnapshot; me: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Server and browser clocks can differ; count down from the server's own telemetry time.
  const skew = snap.telemetry.at ? now - snap.telemetry.at : 0;
  const top = snap.game.scores.slice(0, 5);
  return (
    <div className="scoreboard">
      <div className="sb-col">
        <div className="sb-title mono">LEADERBOARD</div>
        {top.length ? (
          <ol>
            {top.map((s) => (
              <li key={s.handle} className={me && s.handle.toLowerCase() === me.toLowerCase() ? "me" : ""}>
                <span>@{s.handle}</span>
                <b className="mono">{s.points}</b>
              </li>
            ))}
          </ol>
        ) : (
          <p className="sb-empty">No points yet. Send Marty to a card.</p>
        )}
      </div>
      <div className="sb-col">
        <div className="sb-title mono">BONUSES</div>
        {snap.game.bonuses.length ? (
          <ul>
            {snap.game.bonuses.map((b) => (
              <li key={b.id}>
                <span>
                  {b.cardName} <span className="dim">{b.label}</span>
                </span>
                <b className="mono gold">+{b.points}</b>
                <span className="mono dim">{Math.max(0, Math.round((b.expiresAt - (now - skew)) / 1000))}s</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sb-empty">None right now. They pop up every so often.</p>
        )}
      </div>
    </div>
  );
}

export default function LiveView({ keyRequired }: { keyRequired: boolean }) {
  const { snap, connected } = useLive();
  const pose = useSmoothPose(snap?.telemetry.pose);
  const [handle, setHandle] = useStored("marty.handle");
  const [opKey, setOpKey] = useStored("marty.operatorKey");
  const [storedView, setView] = useStored("marty.view");
  const view: ViewMode = storedView === "orbit" || storedView === "fpv" ? storedView : "2d";
  const [handleDraft, setHandleDraft] = useState("");
  const [editingHandle, setEditingHandle] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<{ kind: "info" | "warn"; text: string } | null>(null);
  const [showClearance, setShowClearance] = useState(true);
  const [sending, setSending] = useState(false);
  const [art, reloadArt] = useCardArt();
  const [checking, setChecking] = useState(false);
  const [hoverCard, setHoverCard] = useState<{ card: Card; at: { x: number; y: number } } | null>(null);
  const [openCard, setOpenCard] = useState<Card | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  const needHandle = !handle || editingHandle;
  const canOperate = !keyRequired || !!opKey;

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || !handle || sending) return;
    setSending(true);
    const r = await post("/api/live/chat", { handle, text: t });
    setSending(false);
    if (r.ok) setDraft("");
    else setNotice({ kind: "warn", text: r.message });
  };

  const op = async (body: Record<string, unknown>) => {
    const r = await post("/api/live/operator", { ...body, key: opKey || undefined });
    if (!r.ok || body.action === "place") setNotice({ kind: r.ok ? "info" : "warn", text: r.message });
  };

  const saveHandle = () => {
    const h = handleDraft.trim().replace(/^@/, "");
    if (!HANDLE.test(h)) {
      setNotice({ kind: "warn", text: "Handles are 2–20 letters, numbers or underscores." });
      return;
    }
    setHandle(h);
    setEditingHandle(false);
  };

  if (!snap || !pose) {
    return (
      <div className="live-loading mono">
        <span className="typing">
          <i />
          <i />
          <i />
        </span>
        {connected ? "Loading…" : "Connecting to Marty…"}
      </div>
    );
  }

  const tel = snap.telemetry;
  const moving = tel.status === "moving";

  return (
    <div className="twin">
      <section className="twin-stage" aria-label="Map">
        <div className={`map-frame${view === "2d" ? "" : " is-3d"}`}>
          {view === "2d" ? (
          <TwinMap
            env={ENVIRONMENT}
            grid={GRID}
            view={VIEW}
            pose={pose}
            status={tel.status}
            trip={snap.trip}
            bonuses={snap.game.bonuses}
            cardPoints={snap.game.cardPoints}
            showClearance={showClearance}
            onPlace={canOperate ? (p) => void op({ action: "place", x: p.x, y: p.y }) : undefined}
            onCardGo={(c) => (handle ? void send(`Go to ${c.name}`) : setDraft(`Go to ${c.name}`))}
            onCardHover={(c, at) => setHoverCard(c ? { card: c, at } : null)}
            onCardInspect={(c) => setOpenCard(c)}
          />
          ) : (
            <Room3D
              env={ENVIRONMENT}
              pose={pose}
              status={tel.status}
              trip={snap.trip}
              bonuses={snap.game.bonuses}
              cardPoints={snap.game.cardPoints}
              mode={view}
              art={art}
              onCardGo={(c) => (handle ? void send(`Go to ${c.name}`) : setDraft(`Go to ${c.name}`))}
            />
          )}

          <div className="view-switch mono" role="tablist" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? "on" : ""} title={v.title} onClick={() => setView(v.id)}>
                {v.label}
              </button>
            ))}
          </div>

          <div className="map-corner">
            <span className="viewers mono" title="People watching right now">
              <span className={`dot ${connected ? "on" : ""}`} /> {snap.viewers} watching
            </span>
            <Popover label="Help" align="right" trigger={<Help width={16} height={16} />}>
              <div className="pop-title">How it works</div>
              <ul className="pop-list">
                <li>Pick a handle, then ask Marty to go somewhere.</li>
                <li>Chain stops: “Ripken, then Bonds, then Mantle”.</li>
                <li>Laps: “go around the display table”, “lap the room”.</li>
                <li>“Go upstairs” climbs the ramp. Costs a lot of battery.</li>
                <li>Jev reads everyone&apos;s messages and picks what to do. Safety rules can veto it.</li>
                <li>You score a card&apos;s points when Marty visits it for you. Bonuses pop up now and then.</li>
                <li>Battery drains with distance. Marty recharges at the dock.</li>
                <li>Hover a card to see the real card; click to request it. On a phone, tap a card to see it, then send Marty from there.</li>
                <li>2D / 3D / FPV switches the view. 3D: drag to orbit, scroll to zoom. FPV is Marty&apos;s own camera.</li>
              </ul>
            </Popover>
            <Popover label="Settings" align="right" hover={false} trigger={<Gear width={16} height={16} />}>
              <div className="pop-title">Operator controls</div>
              {keyRequired && (
                <label className="pop-ctl">
                  <span className="tm-label">Key</span>
                  <input className="op-key" type="password" value={opKey} onChange={(e) => setOpKey(e.target.value)} placeholder="Operator key" aria-label="Operator key" />
                </label>
              )}
              <div className="pop-actions">
                <button className="btn danger" onClick={() => void op({ action: "stop" })} disabled={!canOperate || !moving}>
                  ■ Stop
                </button>
                <button className="btn" onClick={() => void op({ action: "resume" })} disabled={!canOperate || moving || snap.trip?.status !== "stopped"}>
                  ▶ Resume
                </button>
                <button className="btn" onClick={() => void op({ action: "dock" })} disabled={!canOperate || moving}>
                  ⌂ Dock
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    if (confirm("Reset Marty, the chat and all scores for everyone watching?")) void op({ action: "reset" });
                  }}
                  disabled={!canOperate}
                >
                  ↺ Reset
                </button>
              </div>
              <label className="pop-ctl">
                <span className="tm-label">Speed</span>
                <input
                  type="range"
                  min={0.2}
                  max={1.5}
                  step={0.1}
                  value={tel.speed}
                  disabled={!canOperate}
                  onChange={(e) => void op({ action: "speed", mps: Number(e.target.value) })}
                  aria-label="Speed, meters per second"
                />
                <span className="mono">{tel.speed.toFixed(1)} m/s</span>
              </label>
              <label className="pop-ctl">
                <span className="tm-label">Battery</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={Math.round(tel.battery.level)}
                  key={Math.round(tel.battery.level / 5)}
                  disabled={!canOperate}
                  onMouseUp={(e) => void op({ action: "battery", level: Number((e.target as HTMLInputElement).value) })}
                  onTouchEnd={(e) => void op({ action: "battery", level: Number((e.target as HTMLInputElement).value) })}
                  onKeyUp={(e) => void op({ action: "battery", level: Number((e.target as HTMLInputElement).value) })}
                  aria-label="Set battery level (for testing)"
                />
                <span className="mono">{Math.round(tel.battery.level)}%</span>
              </label>
              <div className="pop-ctl">
                <span className="tm-label">Heading</span>
                <button className="btn" onClick={() => void op({ action: "rotate", deg: 15 })} disabled={!canOperate || moving} aria-label="Rotate left 15 degrees">
                  ⟲ 15°
                </button>
                <button className="btn" onClick={() => void op({ action: "rotate", deg: -15 })} disabled={!canOperate || moving} aria-label="Rotate right 15 degrees">
                  ⟳ 15°
                </button>
              </div>
              <label className="pop-ctl">
                <input type="checkbox" checked={showClearance} onChange={(e) => setShowClearance(e.target.checked)} />
                <span className="tm-label">Clearance zones</span>
              </label>
              <div className="pop-ctl">
                <span className="tm-label">Cards</span>
                <button className="btn" onClick={() => setChecking(true)} disabled={!canOperate}>
                  Check card images
                </button>
              </div>
              {!canOperate && <p className="pop-warn">Enter the operator key to use these controls.</p>}
            </Popover>
          </div>

          <Hud snap={snap} />
          {snap.trip?.status === "running" && (
            <div className="trip-banner mono">
              <b>@{snap.trip.handle}</b> · {snap.trip.doing}
            </div>
          )}
          {notice && <div className={`map-notice ${notice.kind}`}>{notice.text}</div>}
        </div>
        <Scoreboard snap={snap} me={handle} />
      </section>

      <aside className="twin-chat" aria-label="Live chat">
        <LiveChat chat={snap.chat} me={handle} />
        {(snap.deciding || snap.queue.length > 0) && (
          <div className="live-status mono">
            {snap.deciding && (
              <span>
                <span className="typing small">
                  <i />
                  <i />
                  <i />
                </span>{" "}
                Jev is deciding
              </span>
            )}
            {snap.queue.length > 0 && <span>Queue: {snap.queue.map((q) => `@${q.handle}`).join(", ")}</span>}
          </div>
        )}
        {needHandle ? (
          <form
            className="composer twin-composer"
            onSubmit={(e) => {
              e.preventDefault();
              saveHandle();
            }}
          >
            <span className="composer-prompt mono" aria-hidden>
              @
            </span>
            <input
              className="twin-text"
              value={handleDraft}
              maxLength={21}
              autoFocus={editingHandle}
              onChange={(e) => setHandleDraft(e.target.value)}
              placeholder="Pick a handle to chat (e.g. card_shark)"
              aria-label="Your handle"
            />
            <button className="send" type="submit" disabled={!handleDraft.trim()} aria-label="Save handle">
              <Send />
            </button>
          </form>
        ) : (
          <form
            className="composer twin-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <button
              type="button"
              className="handle-chip mono"
              title="Change your handle"
              onClick={() => {
                setHandleDraft(handle);
                setEditingHandle(true);
              }}
            >
              @{handle}
            </button>
            <input
              className="twin-text"
              value={draft}
              maxLength={280}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Tell Marty where to go…"
              aria-label="Message for Marty"
            />
            <button className="send" type="submit" disabled={!draft.trim() || sending} aria-label="Send">
              <Send />
            </button>
          </form>
        )}
      </aside>

      {hoverCard && view === "2d" && (
        <CardHover
          card={hoverCard.card}
          art={art[hoverCard.card.id]}
          at={hoverCard.at}
          points={(snap.game.cardPoints[hoverCard.card.id] ?? 0) + (snap.game.bonuses.find((b) => b.cardId === hoverCard.card.id)?.points ?? 0)}
        />
      )}
      {checking && <CardCheck opKey={opKey} onClose={() => setChecking(false)} onDone={reloadArt} />}
      {openCard && (
        <CardModal
          card={openCard}
          art={art[openCard.id]}
          onClose={() => setOpenCard(null)}
          onGo={() => {
            setOpenCard(null);
            if (handle) void send(`Go to ${openCard.name}`);
            else setDraft(`Go to ${openCard.name}`);
          }}
        />
      )}
    </div>
  );
}
