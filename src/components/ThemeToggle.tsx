"use client";

import { setTheme, useTheme } from "./theme";

/** Sun / moon button: switches between light and dark. */
export default function ThemeToggle() {
  const theme = useTheme();
  const next = theme === "light" ? "dark" : "light";
  return (
    <button className="theme-toggle" onClick={() => setTheme(next)} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      {theme === "light" ? "☾" : "☀"}
    </button>
  );
}
