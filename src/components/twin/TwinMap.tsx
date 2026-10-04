"use client";

import { useMemo, useRef, useState } from "react";
import type { Bonus } from "@/lib/game/game";
import type { PublicTrip } from "@/lib/live/types";
import { type Card, DIMENSIONS, type Environment, type Pose, type Ramp, type Vec } from "@/lib/twin/environment";
import type { ViewTransform } from "@/lib/twin/geometry";
import { blockReason, type Grid } from "@/lib/twin/grid";
import type { MotionStatus } from "@/lib/twin/motion";
import { formatShort, type Units } from "@/lib/units";

interface Props {
  /** The floor being shown. */
  env: Environment;
  grid: Grid;
  ramps: Ramp[];
  /** Marty's floor and continuous height in floors (fractional on a ramp); he's drawn when on or next to this floor. */
  martyFloor: number;
  martyLevel: number;
  units: Units;
  view: ViewTransform;
  pose: Pose;
  status: MotionStatus;
  /** Current or last trip: its route and stops are drawn. */
  trip: PublicTrip | null;
  bonuses: Bonus[];
  /** Base points available per card right now (0 while on cooldown). */
  cardPoints: Record<string, number>;
  showClearance: boolean;
  /** Drag-to-place, when the viewer may operate Marty. */
  onPlace?: (pose: Pose) => void;
  onCardGo: (card: Card) => void;
  /** Pointer over a card (null when it leaves), with screen coordinates, for a preview. */
  onCardHover?: (card: Card | null, at: { x: number; y: number }) => void;
  /** Tap on a touch screen: open the card instead of sending Marty straight away. */
  onCardInspect?: (card: Card) => void;
}

const IN = 0.0254;

export default function TwinMap({ env, grid, ramps, martyFloor, martyLevel, units, view, pose, status: motionStatus, trip, bonuses, cardPoints, showClearance, onPlace, onCardGo, onCardHover, onCardInspect }: Props) {
  const level = env.level;
  const here = martyFloor === level || Math.abs(martyLevel - level) < 0.999;
  const fmt = (n: number) => formatShort(n, units);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Card | null>(null);
  const lastPointer = useRef("mouse");
  const [drag, setDrag] = useState<{ pos: Vec; reason: string | null } | null>(null);
  const S = view.toScreen;
  const L = view.len;
  const moving = motionStatus === "moving";
  const motion = { pose, status: motionStatus };

  /** Pointer → world coordinates through the SVG's own CTM, so it works at any rendered size. */
  const toWorld = (e: React.PointerEvent): Vec | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return view.toWorld({ x: pt.x, y: pt.y });
  };

  const onDown = (e: React.PointerEvent) => {
    if (moving || !onPlace || !here) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag({ pos: { x: motion.pose.x, y: motion.pose.y }, reason: null });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const w = toWorld(e);
    if (w) setDrag({ pos: w, reason: blockReason(env, grid, w) });
  };
  const onUp = () => {
    if (!drag) return;
    const moved = Math.hypot(drag.pos.x - motion.pose.x, drag.pos.y - motion.pose.y) > 0.005;
    if (moved) onPlace?.({ x: Math.round(drag.pos.x * 1000) / 1000, y: Math.round(drag.pos.y * 1000) / 1000, heading: motion.pose.heading });
    setDrag(null);
  };

  // Grid: 3 in squares with a heavier line every foot, or 10 cm with every 50 cm heavier.
  const gridLines = useMemo(() => {
    const lines: { a: Vec; b: Vec; major: boolean }[] = [];
    const step = units === "imperial" ? 3 * IN : 0.1;
    const every = units === "imperial" ? 4 : 5;
    for (let i = 0; i * step <= env.width + 1e-9; i++) lines.push({ a: { x: i * step, y: 0 }, b: { x: i * step, y: env.height }, major: i % every === 0 });
    for (let i = 0; i * step <= env.height + 1e-9; i++) lines.push({ a: { x: 0, y: i * step }, b: { x: env.width, y: i * step }, major: i % every === 0 });
    return lines;
  }, [env, units]);
  const ticks = (max: number) => {
    const step = units === "imperial" ? 12 * IN : 0.5;
    return Array.from({ length: Math.floor(max / step + 1e-6) + 1 }, (_, i) => ({ at: i * step, label: units === "imperial" ? `${i}′` : `${(i * step).toFixed(1)}` }));
  };

  // Only this floor's part of the trip: its drive legs, and ramps that start or end here.
  const legs = (trip?.legs ?? []).filter((l) => (l.ramp ? l.ramp.from === level || l.ramp.to === level : l.floor === level));
  const tripLive = trip?.status === "running";
  const routeDim = trip?.status === "stopped" || trip?.status === "failed";
  const bonusAt = new Map(bonuses.map((b) => [b.cardId, b]));
  const stopCards = new Set((trip?.stops ?? []).filter((x) => x.cardId && (tripLive || !x.done)).map((x) => x.cardId!));
  const room0 = S({ x: 0, y: env.height });
  const inflation = grid.inflation;

  return (
    <svg
      ref={svgRef}
      className="twin-map"
      viewBox={`0 0 ${view.width} ${view.height}`}
      role="img"
      aria-label={`Overhead map of floor ${level}`}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setDrag(null)}
    >
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
        </pattern>
        <radialGradient id="marty-glow">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Room floor and grid */}
      <rect x={room0.x} y={room0.y} width={L(env.width)} height={L(env.height)} className="room-floor" />
      {gridLines.map((g, i) => {
        const a = S(g.a);
        const b = S(g.b);
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={g.major ? "grid-major" : "grid-minor"} />;
      })}
      {ticks(env.width).map((t) => {
        const p = S({ x: t.at, y: 0 });
        return (
          <text key={`x${t.at}`} x={p.x} y={p.y + 16} className="axis-label" textAnchor="middle">
            {t.label}
          </text>
        );
      })}
      {ticks(env.height).map((t) => {
        const p = S({ x: 0, y: t.at });
        return (
          <text key={`y${t.at}`} x={p.x - 8} y={p.y + 3} className="axis-label" textAnchor="end">
            {t.label}
          </text>
        );
      })}

      {/* Clearance zones (obstacles inflated by Marty's radius + margin) */}
      {showClearance &&
        env.obstacles.filter((o) => o.kind !== "opening" && o.kind !== "ramp").map((o) => {
          const p = S({ x: o.x - inflation, y: o.y + o.h + inflation });
          return (
            <rect key={`c-${o.id}`} x={p.x} y={p.y} width={L(o.w + 2 * inflation)} height={L(o.h + 2 * inflation)} rx={L(inflation)} className="clearance" />
          );
        })}
      {showClearance && (
        <rect
          x={room0.x + L(inflation)}
          y={room0.y + L(inflation)}
          width={L(env.width - 2 * inflation)}
          height={L(env.height - 2 * inflation)}
          className="clearance-room"
        />
      )}

      {/* Walls */}
      <rect x={room0.x} y={room0.y} width={L(env.width)} height={L(env.height)} className="room-wall" />

      {/* Obstacles */}
      {/* Ramps: the lane up to the next floor, and the opening where the ramp from below arrives */}
      {ramps
        .filter((r) => r.from === level || r.to === level)
        .map((r) => {
          const up = r.from === level;
          const p = S({ x: r.lane.x, y: r.lane.y + r.lane.h });
          const c = S({ x: r.lane.x + r.lane.w / 2, y: r.lane.y + r.lane.h / 2 });
          const east = (up ? r.top.x : r.foot.x) > (up ? r.foot.x : r.top.x);
          return (
            <g key={r.id} className={`ramp-zone ${up ? "up" : "opening"}`}>
              <rect x={p.x} y={p.y} width={L(r.lane.w)} height={L(r.lane.h)} rx={2} />
              <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="middle" className="obstacle-label">
                {up ? `${east ? "" : "← "}RAMP UP TO FLOOR ${r.to}${east ? " →" : ""}` : `OPENING · RAMP DOWN TO FLOOR ${r.from}`}
              </text>
            </g>
          );
        })}

      {env.obstacles.map((o) => {
        if (o.kind === "ramp" || o.kind === "opening") return null;
        const p = S({ x: o.x, y: o.y + o.h });
        const c = S({ x: o.x + o.w / 2, y: o.y + o.h / 2 });
        const vertical = o.h > o.w * 3;
        return (
          <g key={o.id} className={`obstacle ${o.kind}`}>
            <rect x={p.x} y={p.y} width={L(o.w)} height={L(o.h)} rx={o.kind === "plinth" ? 3 : 1.5} fill={o.kind === "cage" ? "url(#hatch)" : undefined} />
            {o.kind !== "cage" && (o.w > 0.24 || vertical) && (
              <text
                x={c.x}
                y={c.y}
                className="obstacle-label"
                textAnchor="middle"
                dominantBaseline="middle"
                transform={vertical ? `rotate(-90 ${c.x} ${c.y})` : undefined}
              >
                {o.label}
              </text>
            )}
          </g>
        );
      })}
      {(() => {
        // Label the cage enclosure (cage walls plus the room corner they close off).
        const cages = env.obstacles.filter((o) => o.kind === "cage");
        if (!cages.length) return null;
        const minX = Math.min(...cages.map((o) => o.x));
        const minY = Math.min(...cages.map((o) => o.y));
        const maxX = Math.max(...cages.map((o) => o.x + o.w));
        const v = S({ x: maxX / 2, y: (minY + env.height) / 2 - 0.05 });
        return (
          <text x={v.x} y={v.y} className="obstacle-label vault-label" textAnchor="middle">
            VAULT · LOCKED
          </text>
        );
      })()}

      {/* Dock */}
      {(() => {
        const d = S(env.dock);
        return (
          <g className="dock">
            <rect x={d.x - L(0.05)} y={d.y - L(0.05)} width={L(0.1)} height={L(0.1)} rx={3} />
            <text x={d.x} y={d.y + L(0.09)} textAnchor="middle" className="axis-label">
              DOCK
            </text>
          </g>
        );
      })()}

      {/* Route: every leg of the current trip; finished legs dim */}
      {trip && legs.length > 0 && (
        <g className={`route${routeDim ? " dim" : ""}${trip.status === "done" ? " done" : ""}`}>
          {legs.map((leg, li) => {
            const pts = leg.path.map((p) => S(p));
            return (
              <g key={li} className={leg.done && tripLive ? "leg-done" : ""}>
                <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} className="route-line" />
                {pts.slice(1).map((p, i) => {
                  const a = pts[i];
                  const ang = (Math.atan2(p.y - a.y, p.x - a.x) * 180) / Math.PI;
                  const mid = { x: (a.x + p.x) / 2, y: (a.y + p.y) / 2 };
                  return <path key={`ch${i}`} d="M -4 -4 L 2 0 L -4 4" transform={`translate(${mid.x} ${mid.y}) rotate(${ang})`} className="route-chevron" />;
                })}
              </g>
            );
          })}
          {trip.stops.map((st, i) => {
            if (st.floor !== level) return null;
            const p = S(st.point);
            return (
              <g key={`st${i}`} className={`stop-pin${st.done ? " done" : ""}`}>
                <circle cx={p.x} cy={p.y} r={8} />
                <text x={p.x} y={p.y + 0.5} textAnchor="middle" dominantBaseline="middle">
                  {st.done ? "✓" : i + 1}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* Cards */}
      {env.cards.map((c) => {
        const p = S(c.position);
        const isTarget = stopCards.has(c.id);
        const bonus = bonusAt.get(c.id);
        const pts = (cardPoints[c.id] ?? 0) + (bonus?.points ?? 0);
        const along = Math.atan2(-c.facing.y, c.facing.x) * (180 / Math.PI); // screen angle of facing
        const lp = S({ x: c.position.x + c.facing.x * 0.05, y: c.position.y + c.facing.y * 0.05 });
        const last = (n: string) => n.replace(/ (Jr\.|Suzuki)$/, "").split(" ").at(-1)!;
        const short = env.cards.filter((o) => last(o.name) === last(c.name)).length > 1 ? c.name : last(c.name);
        return (
          <g
            key={c.id}
            className={`card${isTarget ? " target" : ""}${hover?.id === c.id ? " hover" : ""}`}
            onPointerEnter={(e) => {
              if (e.pointerType === "touch") return;
              setHover(c);
              onCardHover?.(c, { x: e.clientX, y: e.clientY });
            }}
            onPointerLeave={() => {
              setHover((h) => (h?.id === c.id ? null : h));
              onCardHover?.(null, { x: 0, y: 0 });
            }}
            onPointerUp={(e) => {
              lastPointer.current = e.pointerType;
            }}
            onClick={() => {
              if (lastPointer.current === "touch" && onCardInspect) onCardInspect(c);
              else onCardGo(c);
            }}
            role="button"
            tabIndex={0}
            aria-label={`${c.name} card. Click to ask Marty to go there.`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onCardGo(c);
            }}
          >
            {/* A real 2.5 in card, seen edge-on from above, plus an invisible larger hit area */}
            <rect x={p.x - L(0.012)} y={p.y - L(DIMENSIONS.cardWidth / 2)} width={L(0.012)} height={L(DIMENSIONS.cardWidth)} rx={1} transform={`rotate(${along} ${p.x} ${p.y})`} className="card-body" />
            <rect x={p.x - L(0.04)} y={p.y - L(0.05)} width={L(0.08)} height={L(0.1)} transform={`rotate(${along} ${p.x} ${p.y})`} className="card-hit" />
            <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle" className="card-label">
              {short}
            </text>
            {(isTarget || hover?.id === c.id) && <circle cx={S(c.approach).x} cy={S(c.approach).y} r={2.5} className="approach-dot" />}
            {pts > 0 && c.id !== "wagner-t206" && (
              <g
                className={`pts-badge${bonus ? " bonus" : ""}`}
                transform={(() => {
                  // Beside the card, along the wall it hangs on, so it never covers the name.
                  const b = S({ x: c.position.x - c.facing.y * 0.07 + c.facing.x * 0.03, y: c.position.y + c.facing.x * 0.07 + c.facing.y * 0.03 });
                  return `translate(${b.x} ${b.y})`;
                })()}
              >
                <rect x={-14} y={-7} width={28} height={14} rx={7} />
                <text textAnchor="middle" dominantBaseline="middle" y={0.5}>
                  {pts}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* Drag preview */}
      {drag && (
        <g className={`drag-ghost${drag.reason ? " bad" : ""}`}>
          <circle cx={S(drag.pos).x} cy={S(drag.pos).y} r={L(env.robotRadius + env.clearance)} />
          <text x={S(drag.pos).x} y={S(drag.pos).y - L(0.11)} textAnchor="middle" className="drag-label">
            {drag.reason ? drag.reason : `(${fmt(drag.pos.x)}, ${fmt(drag.pos.y)})`}
          </text>
        </g>
      )}

      {/* Marty: the single displayed position comes from the motion source */}
      {here && (() => {
        const p = S(motion.pose);
        const len = L(DIMENSIONS.botLength);
        const wid = L(DIMENSIONS.botWidth);
        const r = len / 2;
        return (
          <g
            className={`marty ${motion.status}${moving || !onPlace ? "" : " draggable"}`}
            transform={`translate(${p.x} ${p.y}) rotate(${view.rotation(motion.pose.heading)})`}
            onPointerDown={onDown}
            aria-label={`Marty at ${fmt(motion.pose.x)}, ${fmt(motion.pose.y)}`}
          >
            <circle r={r * 3} fill="url(#marty-glow)" className="marty-glow" />
            <circle r={L(env.robotRadius + env.clearance)} className="marty-clearance" />
            {/* 4.3 in long × 4 in wide, to scale */}
            <rect x={-len / 2} y={-wid / 2 + wid * 0.12} width={len} height={wid * 0.76} rx={len * 0.12} className="marty-body" />
            <rect x={-len / 2} y={-wid / 2} width={len} height={wid * 0.16} rx={1} className="marty-track" />
            <rect x={-len / 2} y={wid / 2 - wid * 0.16} width={len} height={wid * 0.16} rx={1} className="marty-track" />
            <path d={`M ${len * 0.05} ${-wid * 0.22} L ${len * 0.45} 0 L ${len * 0.05} ${wid * 0.22} Z`} className="marty-heading" />
          </g>
        );
      })()}

      {/* Hover tooltip */}
      {hover && !onCardHover && (() => {
        const p = S(hover.position);
        const w = 172;
        const h = 62;
        const x = Math.min(view.width - w - 4, Math.max(4, p.x - w / 2));
        const y = p.y > view.height / 2 ? p.y - h - 16 : p.y + 16;
        return (
          <g className="tooltip" pointerEvents="none">
            <rect x={x} y={y} width={w} height={h} rx={6} />
            <text x={x + 10} y={y + 18} className="tt-title">
              {hover.name}
            </text>
            <text x={x + 10} y={y + 34} className="tt-meta">
              {hover.year} · {hover.team} · {hover.id}
            </text>
            <text x={x + 10} y={y + 50} className="tt-meta">
              {cardPoints[hover.id] ? `${cardPoints[hover.id]} pts` : "on cooldown"}
              {bonusAt.get(hover.id) ? ` + ${bonusAt.get(hover.id)!.points} bonus` : ""} · click to request
            </text>
          </g>
        );
      })()}
    </svg>
  );
}
