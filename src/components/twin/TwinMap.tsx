"use client";

import { useMemo, useRef, useState } from "react";
import type { Mission } from "@/lib/twin/controller";
import type { Card, Environment, Pose, Vec } from "@/lib/twin/environment";
import type { ViewTransform } from "@/lib/twin/geometry";
import { blockReason, type Grid } from "@/lib/twin/grid";
import type { MotionState } from "@/lib/twin/motion";

interface Props {
  env: Environment;
  grid: Grid;
  view: ViewTransform;
  motion: MotionState;
  /** Mission whose route/target is drawn. */
  mission: Mission | undefined;
  showClearance: boolean;
  onPlace: (pose: Pose) => void;
  onCardGo: (card: Card) => void;
}

const fmt = (n: number) => n.toFixed(2);

export default function TwinMap({ env, grid, view, motion, mission, showClearance, onPlace, onCardGo }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Card | null>(null);
  const [drag, setDrag] = useState<{ pos: Vec; reason: string | null } | null>(null);
  const S = view.toScreen;
  const L = view.len;
  const moving = motion.status === "moving";

  /** Pointer → world coordinates through the SVG's own CTM, so it works at any rendered size. */
  const toWorld = (e: React.PointerEvent): Vec | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return view.toWorld({ x: pt.x, y: pt.y });
  };

  const onDown = (e: React.PointerEvent) => {
    if (moving) return;
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
    const moved = Math.hypot(drag.pos.x - motion.pose.x, drag.pos.y - motion.pose.y) > 0.02;
    if (moved) onPlace({ x: Math.round(drag.pos.x * 100) / 100, y: Math.round(drag.pos.y * 100) / 100, heading: motion.pose.heading });
    setDrag(null);
  };

  const gridLines = useMemo(() => {
    const lines: { a: Vec; b: Vec; major: boolean }[] = [];
    for (let x = 0; x <= env.width + 1e-9; x += 0.5) lines.push({ a: { x, y: 0 }, b: { x, y: env.height }, major: Number.isInteger(x) });
    for (let y = 0; y <= env.height + 1e-9; y += 0.5) lines.push({ a: { x: 0, y }, b: { x: env.width, y }, major: Number.isInteger(y) });
    return lines;
  }, [env]);

  const plan = mission?.plan;
  const route = plan?.status === "ok" ? plan.waypoints : [];
  const target = mission?.target;
  const status = mission?.status;
  const showRoute = route.length > 1 && status && ["route_ready", "moving", "arrived", "stopped", "cancelled"].includes(status);
  const routeDim = status === "cancelled" || status === "stopped";
  const pts = route.map((p) => S(p));
  const room0 = S({ x: 0, y: env.height });
  const inflation = grid.inflation;

  return (
    <svg
      ref={svgRef}
      className="twin-map"
      viewBox={`0 0 ${view.width} ${view.height}`}
      role="img"
      aria-label="Overhead map of the card room"
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
      {Array.from({ length: env.width / 2 + 1 }, (_, i) => i * 2).map((x) => {
        const p = S({ x, y: 0 });
        return (
          <text key={`x${x}`} x={p.x} y={p.y + 16} className="axis-label" textAnchor="middle">
            {x}m
          </text>
        );
      })}
      {Array.from({ length: env.height / 2 + 1 }, (_, i) => i * 2).map((y) => {
        const p = S({ x: 0, y });
        return (
          <text key={`y${y}`} x={p.x - 8} y={p.y + 3} className="axis-label" textAnchor="end">
            {y}
          </text>
        );
      })}

      {/* Clearance zones (obstacles inflated by Marty's radius + margin) */}
      {showClearance &&
        env.obstacles.map((o) => {
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
      {env.obstacles.map((o) => {
        const p = S({ x: o.x, y: o.y + o.h });
        const c = S({ x: o.x + o.w / 2, y: o.y + o.h / 2 });
        const vertical = o.h > o.w * 3;
        return (
          <g key={o.id} className={`obstacle ${o.kind}`}>
            <rect x={p.x} y={p.y} width={L(o.w)} height={L(o.h)} rx={o.kind === "plinth" ? 3 : 1.5} fill={o.kind === "cage" ? "url(#hatch)" : undefined} />
            {o.kind !== "cage" && (o.w > 0.7 || vertical) && (
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
        const v = S({ x: (minX + env.width) / 2, y: (minY + env.height) / 2 - 0.25 });
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
            <rect x={d.x - L(0.22)} y={d.y - L(0.22)} width={L(0.44)} height={L(0.44)} rx={3} />
            <text x={d.x} y={d.y + L(0.42)} textAnchor="middle" className="axis-label">
              DOCK
            </text>
          </g>
        );
      })()}

      {/* Route */}
      {showRoute && (
        <g className={`route${routeDim ? " dim" : ""}${status === "arrived" ? " done" : ""}`}>
          <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} className="route-line" />
          {pts.slice(1).map((p, i) => {
            const a = pts[i];
            const ang = (Math.atan2(p.y - a.y, p.x - a.x) * 180) / Math.PI;
            const mid = { x: (a.x + p.x) / 2, y: (a.y + p.y) / 2 };
            return <path key={`ch${i}`} d="M -4 -4 L 2 0 L -4 4" transform={`translate(${mid.x} ${mid.y}) rotate(${ang})`} className="route-chevron" />;
          })}
          {pts.slice(1, -1).map((p, i) => (
            <circle key={`wp${i}`} cx={p.x} cy={p.y} r={3.2} className={`waypoint${motion.missionId === mission?.id && i + 1 < motion.waypoint ? " passed" : ""}`} />
          ))}
        </g>
      )}
      {mission?.from && showRoute && <circle cx={S(mission.from).x} cy={S(mission.from).y} r={4} className="route-start" />}

      {/* Cards */}
      {env.cards.map((c) => {
        const p = S(c.position);
        const isTarget = target?.kind === "card" && target.id === c.id;
        const along = Math.atan2(-c.facing.y, c.facing.x) * (180 / Math.PI); // screen angle of facing
        const lp = S({ x: c.position.x + c.facing.x * 0.32, y: c.position.y + c.facing.y * 0.32 });
        const last = (n: string) => n.replace(/ (Jr\.|Suzuki)$/, "").split(" ").at(-1)!;
        const short = env.cards.filter((o) => last(o.name) === last(c.name)).length > 1 ? c.name : last(c.name);
        return (
          <g
            key={c.id}
            className={`card${isTarget ? " target" : ""}${hover?.id === c.id ? " hover" : ""}`}
            onPointerEnter={() => setHover(c)}
            onPointerLeave={() => setHover((h) => (h?.id === c.id ? null : h))}
            onClick={() => onCardGo(c)}
            role="button"
            tabIndex={0}
            aria-label={`${c.name} card. Click to ask Marty to go there.`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onCardGo(c);
            }}
          >
            <rect x={p.x - L(0.06)} y={p.y - L(0.2)} width={L(0.12)} height={L(0.4)} rx={1.5} transform={`rotate(${along} ${p.x} ${p.y})`} className="card-body" />
            <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle" className="card-label">
              {short}
            </text>
            {(isTarget || hover?.id === c.id) && <circle cx={S(c.approach).x} cy={S(c.approach).y} r={2.5} className="approach-dot" />}
          </g>
        );
      })}

      {/* Destination */}
      {target && status && (() => {
        const t = S(target.point);
        const card = target.cardPosition ? S(target.cardPosition) : null;
        const fail = status === "no_route";
        return (
          <g className={`destination${fail ? " fail" : ""}${status === "arrived" ? " arrived" : ""}`}>
            {card && <line x1={t.x} y1={t.y} x2={card.x} y2={card.y} className="dest-tether" />}
            {fail ? (
              <>
                <path d={`M ${t.x - 7} ${t.y - 7} L ${t.x + 7} ${t.y + 7} M ${t.x + 7} ${t.y - 7} L ${t.x - 7} ${t.y + 7}`} className="dest-x" />
                <text x={t.x} y={t.y < view.pad + 60 ? t.y + 24 : t.y - 14} textAnchor="middle" className="dest-label">
                  NO ROUTE
                </text>
              </>
            ) : (
              <>
                <circle cx={t.x} cy={t.y} r={11} className="dest-ring" />
                <circle cx={t.x} cy={t.y} r={3} className="dest-dot" />
                {status === "arrived" && (
                  <>
                    <circle cx={t.x} cy={t.y} r={11} className="dest-pulse" />
                    <text x={t.x} y={t.y < view.pad + 60 ? t.y + 26 : t.y - 18} textAnchor="middle" className="dest-label ok">
                      ARRIVED
                    </text>
                  </>
                )}
              </>
            )}
          </g>
        );
      })()}

      {/* Drag preview */}
      {drag && (
        <g className={`drag-ghost${drag.reason ? " bad" : ""}`}>
          <circle cx={S(drag.pos).x} cy={S(drag.pos).y} r={L(env.robotRadius + env.clearance)} />
          <text x={S(drag.pos).x} y={S(drag.pos).y - L(0.42)} textAnchor="middle" className="drag-label">
            {drag.reason ? drag.reason : `(${fmt(drag.pos.x)}, ${fmt(drag.pos.y)})`}
          </text>
        </g>
      )}

      {/* Marty: the single displayed position comes from the motion source */}
      {(() => {
        const p = S(motion.pose);
        const r = L(env.robotRadius);
        return (
          <g
            className={`marty ${motion.status}${moving ? "" : " draggable"}`}
            transform={`translate(${p.x} ${p.y}) rotate(${view.rotation(motion.pose.heading)})`}
            onPointerDown={onDown}
            aria-label={`Marty at ${fmt(motion.pose.x)}, ${fmt(motion.pose.y)}`}
          >
            <circle r={r * 3} fill="url(#marty-glow)" className="marty-glow" />
            <circle r={L(env.robotRadius + env.clearance)} className="marty-clearance" />
            <rect x={-r} y={-r * 0.8} width={r * 2} height={r * 1.6} rx={r * 0.35} className="marty-body" />
            <rect x={-r * 0.9} y={-r * 1.05} width={r * 1.8} height={r * 0.28} rx={1} className="marty-track" />
            <rect x={-r * 0.9} y={r * 0.77} width={r * 1.8} height={r * 0.28} rx={1} className="marty-track" />
            <path d={`M ${r * 0.15} ${-r * 0.45} L ${r * 0.95} 0 L ${r * 0.15} ${r * 0.45} Z`} className="marty-heading" />
          </g>
        );
      })()}

      {/* Hover tooltip */}
      {hover && (() => {
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
              approach ({fmt(hover.approach.x)}, {fmt(hover.approach.y)}) · click to go
            </text>
          </g>
        );
      })()}
    </svg>
  );
}
