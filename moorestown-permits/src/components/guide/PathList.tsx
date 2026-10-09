"use client";

import { useState } from "react";
import { PATH } from "./content";

export function PathList() {
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));
  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i); else n.add(i);
      return n;
    });
  return (
    <ol className="path">
      {PATH.map((p, i) => {
        const o = open.has(i);
        return (
          <li key={p.title} className={o ? "open" : undefined}>
            <button type="button" aria-expanded={o} onClick={() => toggle(i)}>
              <span className="n">{i + 1}</span>
              <span className="t">{p.title}<span>{p.sub}</span></span>
              <span className="muted mono small">{o ? "–" : "+"}</span>
            </button>
            <div className="body">{p.body}</div>
          </li>
        );
      })}
    </ol>
  );
}
