"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { ChatItem, LiveEvent, LiveSnapshot } from "@/lib/live/types";
import type { Pose } from "@/lib/twin/environment";

type State = { snap: LiveSnapshot | null; connected: boolean };

function reduce(s: State, e: LiveEvent | { type: "connected"; value: boolean }): State {
  if (e.type === "connected") return { ...s, connected: e.value };
  if (e.type === "snapshot") return { snap: e.snapshot, connected: true };
  if (!s.snap) return s;
  const snap = s.snap;
  switch (e.type) {
    case "telemetry":
      return { ...s, snap: { ...snap, telemetry: e.telemetry } };
    case "trip":
      return { ...s, snap: { ...snap, trip: e.trip } };
    case "game":
      return { ...s, snap: { ...snap, game: e.game } };
    case "catalog":
      return { ...s, snap: { ...snap, catalog: e.catalog, catalogVersion: e.catalogVersion } };
    case "status":
      return { ...s, snap: { ...snap, viewers: e.viewers, deciding: e.deciding, queue: e.queue } };
    case "chat": {
      const i = snap.chat.findIndex((c) => c.id === e.item.id);
      const chat: ChatItem[] = i >= 0 ? snap.chat.map((c, j) => (j === i ? e.item : c)) : [...snap.chat, e.item].slice(-200);
      return { ...s, snap: { ...snap, chat } };
    }
  }
}

/** Live session state from the server's event stream. Reconnects automatically. */
export function useLive() {
  const [state, dispatch] = useReducer(reduce, { snap: null, connected: false });
  useEffect(() => {
    const es = new EventSource("/api/live/stream");
    es.onmessage = (m) => {
      try {
        dispatch(JSON.parse(m.data) as LiveEvent);
      } catch {
        /* ignore malformed */
      }
    };
    es.onerror = () => dispatch({ type: "connected", value: false });
    return () => es.close();
  }, []);
  return state;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Smooths 10 Hz telemetry into 60 fps motion on screen. Display only. */
export function useSmoothPose(target: Pose | undefined): Pose | undefined {
  const [pose, setPose] = useState(target);
  const cur = useRef(target);
  const goal = useRef(target);
  goal.current = target;
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const g = goal.current;
      const c = cur.current;
      const dt = Math.min(0.2, (now - last) / 1000);
      last = now;
      if (g && c) {
        const far = Math.hypot(g.x - c.x, g.y - c.y) > 1;
        const k = far ? 1 : Math.min(1, dt / 0.11);
        const next = { x: c.x + (g.x - c.x) * k, y: c.y + (g.y - c.y) * k, heading: c.heading + wrap(g.heading - c.heading) * k };
        if (Math.abs(next.x - c.x) + Math.abs(next.y - c.y) + Math.abs(next.heading - c.heading) > 1e-5) {
          cur.current = next;
          setPose(next);
        }
      } else if (g) {
        cur.current = g;
        setPose(g);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return pose;
}

function readStore(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStore(key: string, v: string) {
  try {
    if (v) localStorage.setItem(key, v);
    else localStorage.removeItem(key);
  } catch {
    /* private mode: fine, just not remembered */
  }
}

/** A value remembered in this browser (handle, operator key). */
export function useStored(key: string): [string, (v: string) => void] {
  const [v, setV] = useState("");
  useEffect(() => setV(readStore(key)), [key]);
  return [
    v,
    (next: string) => {
      setV(next);
      writeStore(key, next);
    },
  ];
}
