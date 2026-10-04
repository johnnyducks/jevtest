"use client";

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "marty.theme";
const EVENT = "marty:theme";

/** The saved choice, else the system setting. Mirrors the inline script in layout.tsx. */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const set = document.documentElement.dataset.theme;
  return set === "light" ? "light" : "dark";
}

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode: applies now, just isn't remembered */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The active theme, live (the 3D scene recolours with it). */
export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      return () => window.removeEventListener(EVENT, cb);
    },
    currentTheme,
    () => "dark",
  );
}

/** Runs before first paint (inline in <head>) so there's no dark flash for light-mode viewers. */
export const THEME_INIT = `try{var t=localStorage.getItem("${KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t}catch(e){}`;
