// Formatting helpers ported from the Claude design (asb/cards.jsx), typed.
import { CargoView, CargoScope } from "./types";

const GRAIN_COMMODITIES = new Set([
  "Wheat",
  "Corn",
  "Barley",
  "Rice",
  "Sorghum",
  "Soybean",
  "Soybeans",
]);

export function cargoTypeLabel(c: Pick<CargoView, "commodity" | "type">): string {
  if (c.commodity && GRAIN_COMMODITIES.has(c.commodity)) return "GRAIN";
  const t = (c.type || "").toLowerCase();
  if (t === "dry bulk") return "DRY BULK";
  if (t === "break bulk") return "BREAK BULK";
  if (t === "project") return "PROJECT";
  if (t === "liquid") return "LIQUID";
  return (c.type || "—").toUpperCase();
}

export function cargoTypeBadgeVariant(label: string): string {
  if (label === "BREAK BULK") return "bbulk";
  if (label === "LIQUID") return "liquid";
  return "dryish";
}

// Laycan display: "dd.mm – dd.mm (yyyy)" — the year once, at the end, unless
// the range crosses a year boundary (then each date carries its own year).
export function formatLaycanRange(from: string, to: string): string {
  const parse = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
    return m ? { y: m[1], mo: m[2], d: m[3] } : null;
  };
  const f = parse(from);
  const t = parse(to);
  const dm = (x: { d: string; mo: string }) => `${x.d}.${x.mo}`;
  if (!f && !t) return from || to ? [from, to].filter(Boolean).join(" / ") : "—";
  if (f && !t) return `${dm(f)} (${f.y})`;
  if (!f && t) return `${dm(t)} (${t.y})`;
  if (f!.y === t!.y) return `${dm(f!)} – ${dm(t!)} (${f!.y})`;
  return `${dm(f!)}.${f!.y} – ${dm(t!)}.${t!.y}`;
}

export function formatQtyVol(c: CargoView): {
  weight: string;
  volume: string;
  isRange: boolean;
  sfMissing: boolean;
} {
  const isRange =
    c.qty &&
    c.qty.min !== c.qty.max &&
    c.qty.min != null &&
    c.qty.max != null;
  let weight: string;
  if (isRange && c.qty.min != null && c.qty.max != null) {
    const minK = c.qty.min / 1000;
    const maxK = c.qty.max / 1000;
    if (Number.isInteger(minK) && Number.isInteger(maxK)) {
      weight = `${minK}–${maxK.toLocaleString()},000 MT`;
    } else {
      weight = `${c.qty.min.toLocaleString()}–${c.qty.max.toLocaleString()} MT`;
    }
  } else {
    weight = `${c.qtyMt} MT`;
  }
  const unit = c.volUnit || "m³";
  let volume: string;
  if (c.sf == null) {
    volume = `— ${unit}`;
  } else if (isRange && c.qty.max != null) {
    const maxVol = Math.round(c.qty.max * c.sf);
    volume = `max ${maxVol.toLocaleString()} ${unit}`;
  } else {
    volume = `${c.vol} ${unit}`;
  }
  return { weight, volume, isRange: !!isRange, sfMissing: c.sf == null };
}

export type LdRender =
  | { kind: "badge"; label: string }
  | { kind: "tbd" }
  | { kind: "value"; text: string };

export function ldRateRender(c: CargoView): LdRender {
  const terms = (c.loadTerms || "").toUpperCase();
  if (terms.includes("FIOST")) return { kind: "badge", label: "FIOST" };
  if (terms.includes("PER CP") || terms.includes("CHARTER PARTY"))
    return { kind: "badge", label: "PER CP" };
  if (c.loadRate == null) return { kind: "tbd" };
  if (c.dischRate != null)
    return {
      kind: "value",
      text: `${c.loadRate.toLocaleString()} / ${c.dischRate.toLocaleString()} MT/d`,
    };
  return { kind: "value", text: `${c.loadRate.toLocaleString()} MT/d` };
}

export function cargoStripKey(c: CargoView): CargoScope {
  const d = c.laycanDays;
  if (d != null && d < 3) return "out";
  if (c.scope === "out") return "out";
  if (c.scope === "partial") return "partial";
  if (d != null && d <= 7) return "partial";
  return "in";
}

// Single date in the same dd.mm (yyyy) house style as laycan ranges.
export function formatShortDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}.${m[2]} (${m[1]})` : iso || "—";
}
