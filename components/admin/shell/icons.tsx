// Admin sidebar icon set — inline 14×14 line SVGs, ported verbatim from the
// design handoff (14_admin_rebuild/admin/admin-shell.jsx). currentColor so the
// .adm-side__icon CSS controls the hue (muted → navy on active).
import * as React from "react";

const base = {
  viewBox: "0 0 14 14",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  width: 14,
  height: 14,
} as const;

export const ADMIN_ICONS: Record<string, React.ReactNode> = {
  dash: (
    <svg {...base}>
      <rect x="2" y="2" width="4" height="4" rx="0.5" />
      <rect x="8" y="2" width="4" height="4" rx="0.5" />
      <rect x="2" y="8" width="4" height="4" rx="0.5" />
      <rect x="8" y="8" width="4" height="4" rx="0.5" />
    </svg>
  ),
  queue: (
    <svg {...base} strokeLinecap="round">
      <path d="M3 4h8M3 7h8M3 10h5" />
      <circle cx="11.5" cy="10" r="1.4" />
    </svg>
  ),
  list: (
    <svg {...base} strokeLinecap="round">
      <circle cx="3.5" cy="4" r="0.7" />
      <line x1="6" y1="4" x2="12" y2="4" />
      <circle cx="3.5" cy="7" r="0.7" />
      <line x1="6" y1="7" x2="12" y2="7" />
      <circle cx="3.5" cy="10" r="0.7" />
      <line x1="6" y1="10" x2="12" y2="10" />
    </svg>
  ),
  vessel: (
    <svg {...base} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 8 L7 9.5 L11.5 8" />
      <path d="M3.5 8 V5 h7 V8" />
      <path d="M7 5 V2.5" />
      <path d="M2.5 10.5 q4.5 2 9 0" />
    </svg>
  ),
  users: (
    <svg {...base}>
      <circle cx="5" cy="5" r="2.2" />
      <path d="M2 12 c0 -2 1.5 -3.5 3 -3.5 s3 1.5 3 3.5" />
      <circle cx="10" cy="5.5" r="1.8" />
      <path d="M8 12 c0 -1.7 1.2 -3 2 -3 s2 1.3 2 3" />
    </svg>
  ),
  building: (
    <svg {...base} strokeLinejoin="round" strokeLinecap="round">
      <rect x="2.5" y="1.8" width="5.5" height="10.2" rx="0.5" />
      <path d="M8 5 h3.5 v7 H2.5" />
      <path d="M4 4 h2 M4 6 h2 M4 8 h2 M9.4 7 h0.8 M9.4 9 h0.8" />
    </svg>
  ),
  bunker: (
    <svg {...base}>
      <path d="M2 12 h10 M3 9 l-1 3 M11 9 l1 3 M4 4 h6 v5 h-6 z M5 1.5 h4 v2.5 h-4 z" />
    </svg>
  ),
  commod: (
    <svg {...base} strokeLinecap="round">
      <rect x="2.5" y="2.5" width="9" height="9" rx="1" />
      <path d="M5 2.5 v9 M9 2.5 v9 M2.5 5 h9 M2.5 9 h9" />
    </svg>
  ),
  port: (
    <svg {...base} strokeLinecap="round">
      <circle cx="7" cy="4" r="1.6" />
      <path d="M7 5.6 v6 M3.5 11.5 h7 M5 8.5 l-1.5 3 M9 8.5 l1.5 3" />
    </svg>
  ),
  rules: (
    <svg {...base} strokeLinecap="round">
      <circle cx="4" cy="7" r="1.6" />
      <path d="M4 1.5 v3.9 M4 8.6 v3.9" />
      <circle cx="10" cy="7" r="1.6" />
      <path d="M10 1.5 v3.9 M10 8.6 v3.9" />
    </svg>
  ),
  chart: (
    <svg {...base} strokeLinecap="round">
      <path d="M2 12 V4 M2 12 h10" />
      <rect x="4" y="8" width="2" height="3.5" />
      <rect x="7" y="6" width="2" height="5.5" />
      <rect x="10" y="4" width="2" height="7.5" />
    </svg>
  ),
  announ: (
    <svg {...base} strokeLinecap="round">
      <path d="M3 5 v4 l5 2 V3 Z" />
      <path d="M8 5 q3 0 3 2 t-3 2" />
    </svg>
  ),
  shield: (
    <svg {...base} strokeLinejoin="round" strokeLinecap="round">
      <path d="M7 1.5 L12 3 v4 c0 3 -2 5 -5 6 -3 -1 -5 -3 -5 -6 V3 Z" />
      <path d="M5 7 l1.5 1.5 L9 6" />
    </svg>
  ),
  shieldlock: (
    <svg {...base} strokeLinejoin="round" strokeLinecap="round">
      <path d="M7 1.5 L12 3 v4 c0 3 -2 5 -5 6 -3 -1 -5 -3 -5 -6 V3 Z" />
      <rect x="5.2" y="6.2" width="3.6" height="3" rx="0.5" />
      <path d="M5.9 6.2 V5.3 a1.1 1.1 0 0 1 2.2 0 v0.9" />
    </svg>
  ),
};

export function AdminIcon({ name }: { name: string }) {
  return <span className="adm-side__icon">{ADMIN_ICONS[name] ?? ADMIN_ICONS.dash}</span>;
}
