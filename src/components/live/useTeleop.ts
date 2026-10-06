"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type DriveCommand, type DriveKey, isDriveKey, isStill, keysToDrive, STILL } from "@/lib/twin/teleop";

type Send = (body: Record<string, unknown>) => Promise<{ ok: boolean; message: string }>;

/** Repeat a held command this often; the server stops Marty if it hears nothing for TELEOP_DEADMAN_MS (600 ms). */
const HEARTBEAT_MS = 200;

/** Typing somewhere: chat, handle, operator key, catalog fields, any editable element. */
function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"].includes(el.type);
  return false;
}

/** A command that ends motion: an operator stop, or letting go of every key. */
const isStop = (b: Record<string, unknown> | null) => !!b && (b.action === "stop" || (b.action === "drive" && isStill(b as unknown as DriveCommand)));

const same = (a: DriveCommand, b: DriveCommand) => a.forward === b.forward && a.strafe === b.strafe && a.rotate === b.rotate;

/**
 * Keyboard driving for the FPV view. WASD/QE set one velocity command
 * (forward, strafe, rotate), Shift scales it to precision speed, Space is an
 * operator stop. Commands go through the operator channel; while keys are
 * held the command is repeated so the server's deadman keeps Marty moving,
 * and anything that takes the keyboard away (blur, hidden tab, typing,
 * leaving FPV) stops him.
 */
export function useTeleop(enabled: boolean, send: Send, onError: (message: string) => void) {
  const [held, setHeld] = useState<ReadonlySet<DriveKey>>(new Set());
  const [precision, setPrecision] = useState(false);
  const [stopFlash, setStopFlash] = useState(false);

  const keys = useRef(new Set<DriveKey>());
  const shift = useRef(false);
  const sent = useRef<DriveCommand>(STILL);
  const sendRef = useRef(send);
  const errRef = useRef(onError);
  sendRef.current = send;
  errRef.current = onError;

  // Every command goes out at once; waiting on responses would make driving feel as slow as the
  // slowest round trip. Requests can then land out of order. A drive overtaken by an older one is
  // corrected by the next heartbeat; a stop can't wait for one, so a stop sent while anything else
  // was in flight is sent again once all of it has settled, and an older drive never has the last word.
  const inflight = useRef(0);
  const latest = useRef<Record<string, unknown> | null>(null);
  const resend = useRef(false);
  const lastError = useRef("");
  const fire = useCallback((body: Record<string, unknown>) => {
    inflight.current++;
    void sendRef
      .current(body)
      .catch(() => ({ ok: false, message: "Network error." }))
      .then((r) => {
        inflight.current--;
        if (!r.ok && r.message !== lastError.current) errRef.current(r.message);
        lastError.current = r.ok ? "" : r.message;
        if (inflight.current === 0 && resend.current) {
          resend.current = false;
          if (isStop(latest.current)) fire(latest.current!);
        }
      });
  }, []);
  const queue = useCallback(
    (body: Record<string, unknown>) => {
      latest.current = body;
      if (isStop(body) && inflight.current > 0) resend.current = true;
      fire(body);
    },
    [fire],
  );

  /** Recompute the command from the held keys and send it if it changed. */
  const update = useCallback(() => {
    setHeld(new Set(keys.current));
    setPrecision(shift.current);
    const cmd = keysToDrive(keys.current, shift.current);
    if (same(cmd, sent.current)) return;
    sent.current = cmd;
    queue({ action: "drive", ...cmd });
  }, [queue]);

  /** Let go of everything; stop Marty if this browser was driving him. */
  const release = useCallback(() => {
    keys.current.clear();
    shift.current = false;
    update();
  }, [update]);

  // Heartbeat while a command is held.
  const driving = held.size > 0 && !isStill(keysToDrive(held, precision));
  useEffect(() => {
    if (!driving) return;
    const t = setInterval(() => {
      if (!isStill(sent.current)) queue({ action: "drive", ...sent.current });
    }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [driving, queue]);

  useEffect(() => {
    if (!enabled) {
      release();
      return;
    }
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        shift.current = true;
        update();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (e.repeat) return;
        keys.current.clear();
        sent.current = STILL;
        update();
        // An operator stop: halts manual driving and any trip, through the existing stop.
        queue({ action: "stop" });
        setStopFlash(true);
        setTimeout(() => setStopFlash(false), 450);
        return;
      }
      if (!isDriveKey(e.code)) return;
      e.preventDefault();
      shift.current = e.shiftKey;
      if (e.repeat && keys.current.has(e.code)) return;
      keys.current.add(e.code);
      update();
    };
    // Key-ups count wherever focus is, so a key released inside a text box still lets go.
    const up = (e: KeyboardEvent) => {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") shift.current = false;
      else if (isDriveKey(e.code)) keys.current.delete(e.code);
      else return;
      update();
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") release();
    };
    // Moving into a text field mid-drive: stop rather than keep going on stale keys.
    const focusIn = (e: FocusEvent) => {
      if (isTyping(e.target)) release();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    window.addEventListener("pagehide", release);
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("focusin", focusIn);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      window.removeEventListener("pagehide", release);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("focusin", focusIn);
      release();
    };
  }, [enabled, update, release, queue]);

  return { held, precision, driving, stopFlash };
}
