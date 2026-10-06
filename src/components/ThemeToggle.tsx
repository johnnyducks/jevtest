"use client";

import { Moon, Sun } from "./icons";
import { setTheme, useTheme } from "./theme";

/** Sun / moon button: switches between light and dark. */
export default function ThemeToggle() {
  const theme = useTheme();
  const next = theme === "light" ? "dark" : "light";
  return (
    <button className="theme-toggle" onClick={() => setTheme(next)} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      {theme === "light" ? <Moon width={16} height={16} /> : <Sun width={16} height={16} />}
    </button>
  );
}
