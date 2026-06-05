"use client";

// Functional dashboard filter dropdowns, ported from the new design
// (asb/pages.jsx). Operate on the portal view models.
import * as React from "react";
import { CargoView, VesselView } from "@/lib/portal/types";

export const CLASS_OPTS = ["IMSBC", "Grain", "DG"];
const GRAIN_SET = new Set(["Wheat", "Corn", "Barley", "Rice", "Sorghum", "Soybean", "Soybeans", "Maize"]);

export function cargoClassTags(c: CargoView): string[] {
  const t: string[] = [];
  if (c.imsbcGroup) t.push("IMSBC");
  if (c.commodity && GRAIN_SET.has(c.commodity)) t.push("Grain");
  if (c.imsbcGroup === "B" || c.isDg) t.push("DG");
  return t;
}
export function vesselClassTags(v: VesselView): string[] {
  const t = ["IMSBC"];
  if (v.grainCertified) t.push("Grain");
  if (v.dgCertified) t.push("DG");
  return t;
}
export const toMt = (s: string | number | null | undefined) =>
  parseInt(String(s ?? "").replace(/[^0-9]/g, ""), 10) || 0;

export type SizeRange = { min: number | null; max: number | null } | null;

export function rangeSummary(r: SizeRange): string | null {
  if (!r) return null;
  if (r.min != null && r.max != null) return `${(r.min / 1000) | 0}–${(r.max / 1000) | 0}k`;
  if (r.min != null) return `≥ ${(r.min / 1000) | 0}k`;
  if (r.max != null) return `≤ ${(r.max / 1000) | 0}k`;
  return null;
}

export function FilterMenu({
  label,
  badge,
  summary,
  active,
  width = 200,
  children,
}: {
  label: string;
  badge?: number | null;
  summary?: string | null;
  active?: boolean;
  width?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, [open]);
  return (
    <div className="filter-menu" ref={ref}>
      <button
        className={`asb-chip ${active ? "is-active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span>{label}</span>
        {summary && <span className="fm-sum">{summary}</span>}
        {badge != null && <span className="fm-badge">{badge}</span>}
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="filter-menu__panel" style={{ width }} onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}

export function CheckList({
  options,
  value,
  onChange,
  onClear,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  onClear: () => void;
}) {
  const toggle = (o: string) =>
    onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <div className="fm-list">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} className={`fm-opt ${on ? "is-on" : ""}`} onClick={() => toggle(o)}>
            <span className="fm-check">{on ? "✓" : ""}</span>
            <span className="fm-opt__lbl">{o}</span>
          </button>
        );
      })}
      {value.length > 0 && (
        <button className="fm-clear" onClick={onClear}>
          Clear selection
        </button>
      )}
    </div>
  );
}

const SIZE_PRESETS = [
  { l: "Up to 5,000 MT", min: 0, max: 5000 },
  { l: "5,000 – 35,000 MT", min: 5000, max: 35000 },
  { l: "35,000 – 60,000 MT", min: 35000, max: 60000 },
  { l: "60,000 MT and above", min: 60000, max: null as number | null },
];
export function RangeMenu({ value, onChange }: { value: SizeRange; onChange: (v: SizeRange) => void }) {
  const eq = (p: (typeof SIZE_PRESETS)[number]) => value && value.min === p.min && value.max === p.max;
  return (
    <div className="fm-list">
      {SIZE_PRESETS.map((p) => (
        <button key={p.l} className={`fm-opt ${eq(p) ? "is-on" : ""}`} onClick={() => onChange(eq(p) ? null : { min: p.min, max: p.max })}>
          <span className="fm-check">{eq(p) ? "✓" : ""}</span>
          <span className="fm-opt__lbl">{p.l}</span>
        </button>
      ))}
      <div className="fm-range">
        <input
          type="number"
          placeholder="Min"
          value={value?.min ?? ""}
          onChange={(e) => onChange({ min: e.target.value === "" ? null : +e.target.value, max: value?.max ?? null })}
        />
        <span>–</span>
        <input
          type="number"
          placeholder="Max"
          value={value?.max ?? ""}
          onChange={(e) => onChange({ min: value?.min ?? null, max: e.target.value === "" ? null : +e.target.value })}
        />
      </div>
      <div className="fm-hint">Matches vessel DWT &amp; cargo quantity</div>
    </div>
  );
}

const TIME_OPTS = [
  { l: "Within 7 days", d: 7 },
  { l: "Within 14 days", d: 14 },
  { l: "Within 30 days", d: 30 },
];
export function TimeMenu({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="fm-list">
      {TIME_OPTS.map((t) => (
        <button key={t.d} className={`fm-opt ${value === t.d ? "is-on" : ""}`} onClick={() => onChange(value === t.d ? null : t.d)}>
          <span className="fm-check">{value === t.d ? "✓" : ""}</span>
          <span className="fm-opt__lbl">{t.l}</span>
        </button>
      ))}
      <div className="fm-hint">Applies to cargo laycan &amp; vessel open date</div>
    </div>
  );
}

export function RadioList({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="fm-list">
      {options.map((o) => (
        <button key={o} className={`fm-opt ${value === o ? "is-on" : ""}`} onClick={() => onChange(value === o ? null : o)}>
          <span className="fm-check">{value === o ? "✓" : ""}</span>
          <span className="fm-opt__lbl">{o}</span>
        </button>
      ))}
    </div>
  );
}

export function GearSeg({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opts: [string, string][] = [["any", "Any"], ["geared", "Geared"], ["gearless", "Gearless"]];
  return (
    <div className="match-toggle">
      {opts.map(([v, l]) => (
        <button key={v} className={value === v ? "is-on" : ""} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}
