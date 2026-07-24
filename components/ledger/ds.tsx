"use client";

// components/ledger/ds.tsx — ASB Design System primitives used by the Broker
// Ledger pages, ported 1:1 from the vendored DS bundle
// (reference/handoff/ds-bundle.js, namespace ASBDesignSystem_0955c8).
// Class names (asb-btn, asb-input, asb-badge, asb-toggle, match-toggle,
// asb-icon, asb-search) are styled by components/ledger/ledger.css under the
// .asb-ds scope. Do not restyle here — the vendored CSS is the design truth.

import * as React from "react";

// ── Icon — ASB custom icon set, 24×24 grid ──────────────────────────────────
const ICONS: Record<string, { solid?: boolean; svg: string }> = {
  Dashboard: {
    svg: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>'
  },
  Cargo: {
    solid: true,
    svg: '<path d="M 13.5 6 L 22.5 19 L 9.5 19 Z"/><path d="M 7 10 L 14.5 19 L 1.5 19 L 5 14 Z"/>'
  },
  Vessel: {
    solid: true,
    svg: '<rect x="4" y="9.5" width="3" height="3"/><rect x="5" y="6" width="1.6" height="3.8"/><path d="M 1.5 14 L 17 14 Q 21 14 22.5 11 L 22.5 16 Q 22 17.5 19 17.5 L 4 17.5 Q 2 17.5 1.5 16 Z"/><path d="M 1.5 19.5 Q 4 18.5 6.5 19.5 T 11.5 19.5 T 16.5 19.5 T 22.5 19.5" stroke="currentColor" stroke-width="1.1" fill="none"/><path d="M 1.5 21.5 Q 4 20.5 6.5 21.5 T 11.5 21.5 T 16.5 21.5 T 22.5 21.5" stroke="currentColor" stroke-width="1.1" fill="none"/>'
  },
  Voyage: {
    solid: true,
    svg: '<rect x="4" y="6" width="1.6" height="3.5"/><circle cx="3.2" cy="5" r="1"/><circle cx="4.6" cy="3.7" r="1"/><rect x="3.5" y="9.5" width="3.5" height="3.5"/><rect x="7" y="9.5" width="3.5" height="3.5"/><circle cx="17.5" cy="7.5" r="4.2"/><path d="M 1.5 13 L 21 13 L 17.5 18 L 5 18 Z"/><path d="M 1.5 20.5 Q 4 19.5 6.5 20.5 T 11.5 20.5 T 16.5 20.5 T 22.5 20.5" stroke="currentColor" stroke-width="1.2" fill="none"/>'
  },
  PortDA: {
    solid: true,
    svg: '<rect fill="currentColor" x="10.4" y="2" width="3.2" height="2" rx="0.4"/><path fill="none" stroke="currentColor" stroke-width="0.8" d="M11.4 4 L9.2 7.3 M12.6 4 L14.8 7.3"/><rect fill="currentColor" x="8.6" y="7" width="6.8" height="1.2" rx="0.3"/><path fill="currentColor" d="M9 8.2 C7.6 10 8.1 12.1 11.8 12.7 L11.8 8.2 Z M15 8.2 C16.4 10 15.9 12.1 12.2 12.7 L12.2 8.2 Z"/><path fill="currentColor" d="M8.5 15 Q10 13 12 14 Q14 13 15.5 15 Z"/><path fill="currentColor" d="M8.5 15 L15.5 15 L14 18.4 L10 18.4 Z"/><path fill="none" stroke="currentColor" stroke-width="0.9" d="M9.6 18.4 L8.6 21 M14.4 18.4 L15.4 21"/><rect fill="currentColor" x="8.4" y="20.3" width="7.2" height="0.8"/>'
  },
  VoyCalc: {
    solid: true,
    svg: '<path fill="currentColor" fill-rule="evenodd" d="M4 8 L18 8 Q19 8 19 9 L19 16 Q19 17 18 17 L4 17 Q3 17 3 16 L3 9 Q3 8 4 8 Z M6.5 13 Q11 13.7 15.5 13 L14.4 14.8 Q11 15.4 7.6 14.8 Z M9.4 10.6 L12.6 10.6 L12.6 12.8 L9.4 12.8 Z M10.8 9 L12 9 L12 10.6 L10.8 10.6 Z"/><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M9 3.8 A6 6 0 0 0 3.4 8.4"/><path fill="currentColor" d="M2.1 7.4 L3.9 9 L4.9 7 Z"/><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M15 20.4 A6 6 0 0 0 20.6 15.8"/><path fill="currentColor" d="M21.9 16.8 L20.1 15.2 L19.1 17.2 Z"/>'
  },
  Settings: {
    svg: '<circle cx="12" cy="12" r="3"/><path d="M 12 2 L 12 5 M 12 19 L 12 22 M 2 12 L 5 12 M 19 12 L 22 12 M 5 5 L 7 7 M 17 17 L 19 19 M 5 19 L 7 17 M 17 7 L 19 5"/>'
  },
  Sidebar: {
    svg: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><line x1="9" y1="4" x2="9" y2="20"/>'
  },
  SignOut: {
    svg: '<path d="M 13 5 L 13 4 Q 13 3 12 3 L 5 3 Q 4 3 4 4 L 4 20 Q 4 21 5 21 L 12 21 Q 13 21 13 20 L 13 19"/><line x1="10" y1="12" x2="21" y2="12"/><polyline points="17,8 21,12 17,16"/>'
  },
  Map: {
    svg: '<polygon points="3,7 9,4 15,7 21,4 21,17 15,20 9,17 3,20"/><line x1="9" y1="4" x2="9" y2="17"/><line x1="15" y1="7" x2="15" y2="20"/>'
  },
  Plus: {
    svg: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'
  },
  Close: {
    svg: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>'
  },
  Back: {
    svg: '<polyline points="14,6 8,12 14,18"/>'
  },
  Search: {
    svg: '<circle cx="10" cy="10" r="6"/><line x1="15" y1="15" x2="20" y2="20"/>'
  },
  User: {
    svg: '<circle cx="12" cy="8" r="3.5"/><path d="M 4 21 Q 4 14 12 14 Q 20 14 20 21"/>'
  },
  Shield: {
    svg: '<path d="M 12 3 L 4 6 L 4 12 Q 4 18 12 21 Q 20 18 20 12 L 20 6 Z"/>'
  },
  ShieldLock: {
    svg: '<path d="M 12 3 L 4 6 L 4 12 Q 4 18 12 21 Q 20 18 20 12 L 20 6 Z"/><rect x="9.5" y="11" width="5" height="5" rx="0.5"/><path d="M 10.5 11 V 9.5 Q 10.5 8 12 8 Q 13.5 8 13.5 9.5 V 11"/>'
  },
  Bell: {
    svg: '<path d="M 6 17 V 11 Q 6 6 12 6 Q 18 6 18 11 V 17 L 20 19 H 4 Z"/><path d="M 10 21 Q 12 22 14 21"/>'
  },
  Star: {
    svg: '<polygon points="12,3 14.5,9 21,9.5 16,14 17.5,21 12,17.5 6.5,21 8,14 3,9.5 9.5,9"/>'
  },
  Doc: {
    svg: '<path d="M 6 3 L 16 3 L 19 6 L 19 21 L 6 21 Z"/><line x1="9" y1="9" x2="16" y2="9"/><line x1="9" y1="13" x2="16" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>'
  },
  ZoomIn: {
    svg: '<circle cx="10" cy="10" r="6"/><line x1="10" y1="7" x2="10" y2="13"/><line x1="7" y1="10" x2="13" y2="10"/><line x1="15" y1="15" x2="20" y2="20"/>'
  },
  ZoomOut: {
    svg: '<circle cx="10" cy="10" r="6"/><line x1="7" y1="10" x2="13" y2="10"/><line x1="15" y1="15" x2="20" y2="20"/>'
  },
  Caret: {
    svg: '<polyline points="6,9 12,15 18,9"/>'
  },
  Bolt: {
    svg: '<polygon points="13,3 5,13 11,13 9,21 19,11 13,11"/>'
  }
};

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

const ROT: Record<string, number> = { down: 0, up: 180, left: 90, right: -90 };
const PLUS_BADGE =
  '<circle cx="20" cy="4" r="3" fill="#fff"/><line x1="20" y1="2.6" x2="20" y2="5.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="18.6" y1="4" x2="21.4" y2="4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>';

export function Icon({
  name,
  size = 16,
  color,
  plus = false,
  direction = "down",
  className = "",
  title,
  style,
  ...rest
}: {
  name: string;
  size?: number;
  color?: string;
  plus?: boolean;
  direction?: "down" | "up" | "left" | "right";
  title?: string;
} & Omit<React.SVGProps<SVGSVGElement>, "name">) {
  const ic = ICONS[name];
  if (!ic) return null;
  const solid = !!ic.solid;
  const sw = size <= 16 ? 1.7 : 1.5;
  const rot = ROT[direction] || 0;
  let inner = ic.svg;
  if (plus && (name === "Cargo" || name === "Vessel")) inner += PLUS_BADGE;
  if (title) inner = "<title>" + title + "</title>" + inner;
  const props: React.SVGProps<SVGSVGElement> = {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: solid ? "currentColor" : "none",
    className: ("asb-icon " + className).trim(),
    style: {
      color,
      display: "inline-block",
      verticalAlign: "middle",
      flex: "none",
      ...(name === "Caret" && rot
        ? { transform: "rotate(" + rot + "deg)", transition: "transform var(--t-fast,150ms) var(--ease,ease)" }
        : null),
      ...style,
    },
    "aria-hidden": title ? undefined : true,
    role: title ? "img" : undefined,
    dangerouslySetInnerHTML: { __html: inner },
    ...rest,
  };
  if (!solid) {
    props.stroke = "currentColor";
    props.strokeWidth = sw;
    props.strokeLinecap = "round";
    props.strokeLinejoin = "round";
  }
  return <svg {...props} />;
}

// ── Button ───────────────────────────────────────────────────────────────────
export function LedgerButton({
  variant = "secondary",
  type = "button",
  children,
  className = "",
  ...rest
}: { variant?: "primary" | "secondary" | "ghost" | "danger" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ["asb-btn", variant !== "secondary" && "asb-btn--" + variant, className].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}

// ── Input / Search ───────────────────────────────────────────────────────────
const DEFAULT_SEARCH = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="10" r="6" />
    <line x1="14.5" y1="14.5" x2="20" y2="20" />
  </svg>
);

export function LedgerInput({
  search = false,
  icon,
  className = "",
  ...rest
}: { search?: boolean; icon?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  if (search) {
    return (
      <span className="asb-search">
        <span className="asb-search__icon">{icon || DEFAULT_SEARCH}</span>
        <input className={("asb-input " + className).trim()} {...rest} />
      </span>
    );
  }
  return <input className={("asb-input " + className).trim()} {...rest} />;
}

// ── StatusBadge ──────────────────────────────────────────────────────────────
export function StatusBadge({
  status = "in",
  children,
  className = "",
  ...rest
}: { status?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  const cls = ["asb-badge", "asb-badge--" + status, className].filter(Boolean).join(" ");
  return (
    <span className={cls} {...rest}>
      {children != null ? children : status}
    </span>
  );
}

// ── SegmentedToggle ──────────────────────────────────────────────────────────
export function SegmentedToggle({
  options = [],
  value,
  onChange,
  className = "",
  ...rest
}: {
  options: (string | { value: string; label: string })[];
  value?: string | null;
  onChange?: (value: string) => void;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "onChange">) {
  return (
    <div className={("match-toggle " + className).trim()} role="tablist" {...rest}>
      {options.map((o) => {
        const val = typeof o === "string" ? o : o.value;
        const label = typeof o === "string" ? o : o.label;
        const active = value === val;
        return (
          <button
            key={val}
            type="button"
            role="tab"
            aria-selected={active}
            className={"match-toggle__seg" + (active ? " is-active" : "")}
            onClick={() => onChange && onChange(val)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Toggle (checkbox switch) ─────────────────────────────────────────────────
export function LedgerToggle({ className = "", ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" className={("asb-toggle " + className).trim()} {...rest} />;
}
