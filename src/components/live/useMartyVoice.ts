"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatItem } from "@/lib/live/types";
import type { Units } from "@/lib/units";

/** A tenth of a second of silence: played on the click that turns the voice on, so the browser lets later audio play. */
const SILENCE = "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";
/** Don't fall behind the chat: if more lines than this are waiting, skip to the newest. */
const MAX_WAITING = 2;

export type VoiceState = { speaking: string | null; blocked: boolean; error: string | null };

/**
 * Reads Marty's new chat lines aloud, one at a time, when the viewer turns the
 * voice on. Audio comes from /api/live/speech/<line id> (ElevenLabs, server side).
 * Lines already in the chat when it's turned on are not read; any line can be
 * replayed with say(id).
 */
export function useMartyVoice(chat: ChatItem[] | undefined, on: boolean, units: Units) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const queue = useRef<string[]>([]);
  const busy = useRef(false);
  const unitsRef = useRef(units);
  unitsRef.current = units;
  const [state, setState] = useState<VoiceState>({ speaking: null, blocked: false, error: null });

  const el = () => (audio.current ??= new Audio());

  const next = useCallback(() => {
    if (busy.current) return;
    const id = queue.current.shift();
    if (!id) {
      setState((s) => ({ ...s, speaking: null }));
      return;
    }
    busy.current = true;
    setState((s) => ({ ...s, speaking: id }));
    const a = el();
    const done = () => {
      a.onended = a.onerror = null;
      busy.current = false;
      next();
    };
    a.onended = done;
    a.onerror = () => {
      // Ask the server why (the audio element can't see the error message).
      fetch(a.src)
        .then((r) => (r.ok ? null : r.json().catch(() => null)))
        .then((j: { error?: string } | null) => j?.error && setState((s) => ({ ...s, error: j.error! })))
        .catch(() => setState((s) => ({ ...s, error: "Couldn't load Marty's voice." })));
      done();
    };
    a.src = `/api/live/speech/${encodeURIComponent(id)}?units=${unitsRef.current}`;
    a.play().then(
      () => setState((s) => (s.blocked || s.error ? { ...s, blocked: false, error: null } : s)),
      (err: unknown) => {
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          // The browser wants a click first. Keep the line; the speaker button unlocks it.
          queue.current.unshift(id);
          a.onended = a.onerror = null;
          busy.current = false;
          setState((s) => ({ ...s, speaking: null, blocked: true }));
        }
        // Other failures (bad audio, server error) land in onerror.
      },
    );
  }, []);

  // New finished lines from Marty → queue them.
  useEffect(() => {
    if (!chat) return;
    const lines = chat.filter((c) => c.kind === "marty" && c.state === "done" && c.text).map((c) => c.id);
    if (!on || !seen.current) {
      seen.current = new Set(lines); // turned off, or just turned on: don't read the backlog
      return;
    }
    const fresh = lines.filter((id) => !seen.current!.has(id));
    if (!fresh.length) return;
    for (const id of fresh) seen.current.add(id);
    queue.current.push(...fresh);
    if (queue.current.length > MAX_WAITING) queue.current.splice(0, queue.current.length - MAX_WAITING);
    next();
  }, [chat, on, next]);

  // Turned off → stop talking.
  useEffect(() => {
    if (on) return;
    queue.current = [];
    seen.current = null;
    const a = audio.current;
    if (a) {
      a.onended = a.onerror = null;
      a.pause();
    }
    busy.current = false;
    setState({ speaking: null, blocked: false, error: null });
  }, [on]);

  /** Call from a click: lets this page play sound from now on (browsers require a click first), then carries on. */
  const unlock = useCallback(() => {
    const a = el();
    if (!busy.current) {
      a.src = SILENCE;
      a.play().catch(() => {});
    }
    setState((s) => ({ ...s, blocked: false, error: null }));
    setTimeout(next, 150);
  }, [next]);

  /** Read one line now (the speaker on a chat message). */
  const say = useCallback(
    (id: string) => {
      const a = el();
      a.onended = a.onerror = null;
      a.pause();
      busy.current = false;
      queue.current = [id];
      next();
    },
    [next],
  );

  return { ...state, unlock, say };
}
