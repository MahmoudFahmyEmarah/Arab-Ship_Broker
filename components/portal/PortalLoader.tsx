"use client";

// Propeller loading overlay, ported from the design (asb/loader-overlay.js).
// Used as a Next route-level loading fallback and available for transitions.
import * as React from "react";

export function Propeller({ size = 200 }: { size?: number }) {
  return (
    <svg className="asb-prop" viewBox="0 0 320 320" width={size} height={size} aria-hidden>
      <defs>
        <path id="asb-blade" fill="currentColor" d="M152 144 C 145 116 139 86 150 56 C 157 38 177 35 185 55 C 197 84 192 117 177 139 C 171 147 158 149 152 144 Z" />
      </defs>
      <circle className="hydro-out" cx="160" cy="160" r="138" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray="26 62" opacity=".16" />
      <circle className="hydro-in" cx="160" cy="160" r="110" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="16 70" opacity=".10" />
      <g className="blades">
        <use href="#asb-blade" />
        <use href="#asb-blade" transform="rotate(120 160 160)" />
        <use href="#asb-blade" transform="rotate(240 160 160)" />
      </g>
      <circle cx="160" cy="160" r="22" fill="currentColor" />
      <circle cx="160" cy="160" r="8" fill="var(--asb-gray-50)" />
    </svg>
  );
}

export function PortalLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="asb-loading-overlay is-visible">
      <div style={{ textAlign: "center", color: "var(--asb-navy)" }}>
        <Propeller />
        <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 8, color: "var(--asb-gray-500)" }}>{label}</div>
      </div>
    </div>
  );
}
