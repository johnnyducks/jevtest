"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * Small icon button with a popover. Opens on hover (pointer devices) and on
 * tap/click; closes on outside click or Escape.
 */
export default function Popover({
  trigger,
  label,
  children,
  align = "left",
  hover = true,
}: {
  trigger: ReactNode;
  label: string;
  children: ReactNode;
  align?: "left" | "right";
  /** Also open while the pointer hovers (off for menus with actions). */
  hover?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = open || (hover && hovering);
  return (
    <div
      className="popover"
      ref={ref}
      onPointerEnter={(e) => hover && e.pointerType === "mouse" && setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      <button className="icon-btn" aria-label={label} aria-expanded={shown} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {shown && (
        <div className={`popover-panel ${align}`} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}
