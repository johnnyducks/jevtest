import type { SVGProps } from "react";

const base = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Logo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p} stroke="var(--accent)">
    <path d="M12 3v6" />
    <path d="M12 9 6 15" />
    <path d="M12 9l6 6" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <circle cx="12" cy="3.5" r="1" fill="var(--accent)" />
  </svg>
);

export const Send = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);

export const Check = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width={12} height={12} strokeWidth={3} {...p}>
    <path d="m5 12 5 5 9-10" />
  </svg>
);

export const Cross = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width={12} height={12} strokeWidth={3} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const Flask = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M9 3h6" />
    <path d="M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" />
    <path d="M7 15h10" />
  </svg>
);

export const Bolt = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </svg>
);
