"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  ["/", "Guide"],
  ["/start", "Plan my project"],
  ["/track", "My applications"],
  ["/resources", "Forms & contacts"],
] as const;

export function Header() {
  const path = usePathname();
  const staff = path.startsWith("/staff");
  return (
    <header className="top">
      <div className="wrap">
        <Link className="brand" href="/">
          <span className="mark" aria-hidden="true">
            <svg viewBox="0 0 16 16"><path d="M2 14V7l6-5 6 5v7h-4v-4H6v4z" fill="#1B1B19" /></svg>
          </span>
          <span>
            Moorestown Permits<small>Construction Office</small>
          </span>
        </Link>
        <nav className="main" style={{ visibility: staff ? "hidden" : "visible" }}>
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
        <nav className="modeswitch" aria-label="Portal view">
          <Link href="/" aria-current={staff ? undefined : "page"}>Homeowner</Link>
          <Link href="/staff" aria-current={staff ? "page" : undefined}>Staff</Link>
        </nav>
      </div>
    </header>
  );
}
