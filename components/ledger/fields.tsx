"use client";

// Broker Ledger — shared field primitives, ported 1:1 from the handoff step
// registries (reference/handoff/asb/pp2-steps.jsx / pc2-steps.jsx).
// Styled by ledger.css (pp2-* classes) under the .asb-ds page scope.

import * as React from "react";
import { useMemo, useState } from "react";
import { FLAG_STATES } from "@/lib/geo/countries";
import { SegmentedToggle } from "./ds";

export type SelectOption = string | { value: string; label: string };

const norm = (o: SelectOption) => (typeof o === "string" ? { value: o, label: o } : o);

/** Display-only capitalisation: DB values may be lowercase (e.g. hatch types
 *  "side-rolling") but every dropdown shows them capitalised. */
export const capFirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function Field({
  label,
  req,
  help,
  full,
  children,
}: {
  label: string;
  req?: boolean;
  help?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={"pp2-field" + (full ? " pp2-field--full" : "")}>
      <label className="pp2-label">
        {label}
        {req && <span className="pp2-label__req">*</span>}
        {help && (
          <span className="pp2-tip" tabIndex={0}>
            <span className="pp2-tip__mark">!</span>
            <span className="pp2-tip__bub">{help}</span>
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value?: string | null;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}) {
  return (
    <select className="pp2-select" value={value || ""} onChange={(e) => onChange(e.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(norm).map((o) => (
        <option key={o.value} value={o.value}>
          {capFirst(o.label)}
        </option>
      ))}
    </select>
  );
}

/** Dropdown whose options carry hover-definition flyouts (business-approved
 *  wording lives in defs.ts). */
export function SelectTip({
  value,
  onChange,
  options,
  placeholder,
  defs,
  side,
}: {
  value?: string | null;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  defs?: Record<string, string>;
  side?: "right";
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const opts = options.map(norm);
  const sel = opts.find((o) => o.value === value);
  // Long lists scroll inside the menu; a scroll container would clip the
  // floating per-option bubbles, so their definition docks to a strip at the
  // bottom of the menu instead. Short lists keep the floating flyouts.
  const scrolly = opts.length > 9;
  const dockedDef = defs ? defs[hover ?? ""] ?? defs[value ?? ""] : undefined;
  return (
    <div
      className={"pp2-seltip" + (open ? " is-open" : "") + (side === "right" ? " pp2-seltip--right" : "")}
      tabIndex={0}
      onBlur={() => setOpen(false)}
    >
      <button type="button" className="pp2-select pp2-seltip__btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className={sel ? "" : "pp2-seltip__ph"}>{sel ? capFirst(sel.label) : placeholder || "Select…"}</span>
        <span className="pp2-seltip__car" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className={"pp2-seltip__menu" + (scrolly ? " pp2-seltip__menu--scroll" : "")} role="listbox">
          <div className={scrolly ? "pp2-seltip__list" : undefined} onMouseLeave={scrolly ? () => setHover(null) : undefined}>
            {opts.map((o) => (
              <button
                type="button"
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                className={"pp2-optip" + (o.value === value ? " is-sel" : "")}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={scrolly ? () => setHover(o.value) : undefined}
                onFocus={scrolly ? () => setHover(o.value) : undefined}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span className="pp2-optip__code">{capFirst(o.label)}</span>
                {!scrolly && defs && defs[o.value] && (
                  <span className="pp2-optip__bub" role="tooltip">
                    {defs[o.value]}
                  </span>
                )}
              </button>
            ))}
          </div>
          {scrolly && dockedDef && (
            <div className="pp2-seltip__def" role="tooltip">
              {dockedDef}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function NumInput({
  value,
  onChange,
  placeholder,
  unit,
  decimal,
  max,
}: {
  value?: string | number | null;
  onChange: (value: string) => void;
  placeholder?: string;
  unit?: string;
  decimal?: boolean;
  max?: number;
}) {
  return (
    <div className="pp2-num">
      <input
        className="pp2-select"
        style={{ backgroundImage: "none" }}
        inputMode={decimal ? "decimal" : "numeric"}
        value={value == null ? "" : value}
        onChange={(e) => {
          let v = e.target.value.replace(decimal ? /[^\d.]/g : /[^\d]/g, "");
          if (max != null && Number(v) > max) v = String(max);
          onChange(v);
        }}
        placeholder={placeholder}
      />
      {unit && <span className="pp2-num__unit">{unit}</span>}
    </div>
  );
}

/** Plain text input in the ledger chrome (pp2-select without the caret). */
export function TextInput({
  value,
  onChange,
  placeholder,
  maxLength,
  transform,
  style,
}: {
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  transform?: (value: string) => string;
  style?: React.CSSProperties;
}) {
  return (
    <input
      className="pp2-select"
      style={{ backgroundImage: "none", ...style }}
      value={value ?? ""}
      maxLength={maxLength}
      onChange={(e) => onChange(transform ? transform(e.target.value) : e.target.value)}
      placeholder={placeholder}
    />
  );
}

/** Searchable flag-state picker: type to filter the maritime-ordered
 *  FLAG_STATES registry (Panama/Liberia/… first), pick from the menu, or keep
 *  free text for an exotic registry. */
export function CountryPicker({
  value,
  onChange,
  placeholder,
}: {
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const s = (value ?? "").trim().toLowerCase();
    const list = s ? FLAG_STATES.filter((c) => c.toLowerCase().includes(s)) : [...FLAG_STATES];
    return list.slice(0, 10);
  }, [value]);
  const exact = results.length === 1 && results[0].toLowerCase() === (value ?? "").trim().toLowerCase();
  return (
    <div className="pp2-port">
      <input
        className="pp2-select"
        style={{ backgroundImage: "none" }}
        value={value ?? ""}
        placeholder={placeholder || "Search flag state…"}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && !exact && results.length > 0 && (
        <div className="pp2-port__menu">
          {results.map((c) => (
            <button
              type="button"
              className="pp2-port__opt"
              key={c}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
            >
              <span className="pp2-port__opt-name">{c}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function YesNo({ value, onChange }: { value?: string | null; onChange: (value: string) => void }) {
  return (
    <SegmentedToggle
      className="pp2-yn"
      value={value || ""}
      onChange={onChange}
      options={[
        { value: "Y", label: "Yes" },
        { value: "N", label: "No" },
      ]}
    />
  );
}

export function ZoneChips({
  zones,
  value = [],
  onChange,
}: {
  zones: string[];
  value?: string[];
  onChange: (zones: string[]) => void;
}) {
  const toggleZone = (z: string) => onChange(value.includes(z) ? value.filter((x) => x !== z) : [...value, z]);
  return (
    <div className="pp2-chips">
      {zones.map((z) => (
        <button type="button" key={z} className={"pp2-chip-toggle" + (value.includes(z) ? " is-on" : "")} onClick={() => toggleZone(z)}>
          {z}
        </button>
      ))}
    </div>
  );
}

export function InlineNote({
  tone,
  icon,
  children,
  style,
}: {
  tone?: "alert" | "ok";
  icon?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className={"pp2-inline-note" + (tone ? ` pp2-inline-note--${tone}` : "")} style={style}>
      {icon}
      <span className="pp2-inline-note__t">{children}</span>
    </div>
  );
}

export const fmt = (n: unknown): string => (n == null || n === "" ? "-" : Number(n).toLocaleString("en-US"));

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const addDaysISO = (d: string, n: number) => {
  const dt = new Date(d + "T00:00:00");
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
};
export const diffDaysISO = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
