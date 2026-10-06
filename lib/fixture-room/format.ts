// Fixture Room · value formatting, parsing and spreads (23 Sep 2026).
//
// formatFixtureValue mirrors fn_fixture_display_value; the server's
// displayValue is what is persisted and shown, this copy renders previews
// while the user types and lets the check script prove the two agree.
import type { FixtureValue, FixtureValueKind } from "./types";

const group = (n: number, decimals: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const groupUpTo2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function ddMon(iso: string, withYear: boolean): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = String(Number(m[3])).padStart(2, "0");
  return `${d} ${MONTHS[Number(m[2]) - 1]}${withYear ? ` ${m[1]}` : ""}`;
}

export function formatFixtureValue(kind: FixtureValueKind, value: FixtureValue | null | undefined, unit?: string | null): string {
  if (!value) return "—";
  const v = value as Record<string, unknown>;
  switch (kind) {
    case "text":
      return String(v.text ?? "");
    case "number":
      return `${groupUpTo2(Number(v.num))}${unit ? ` ${unit}` : ""}`;
    case "money_per_mt": {
      const cur = String(v.currency ?? "USD");
      return `${cur === "USD" ? "$" : `${cur} `}${group(Number(v.num), 2)}/MT`;
    }
    case "rate_pair":
      return `${group(Number(v.load), 0)} / ${group(Number(v.disch), 0)} MT/day`;
    case "date_range":
      if (v.spot === true) return "SPOT";
      return `${ddMon(String(v.from), false)} – ${ddMon(String(v.to), true)}`;
    case "port_pair":
      return `${v.load_name ?? v.load} → ${v.disch_name ?? v.disch}`;
    default:
      return JSON.stringify(value);
  }
}

/** The first numeric reading of a value, for spreads and gap bars. */
export function numericOf(kind: FixtureValueKind, value: FixtureValue | null | undefined): number | null {
  if (!value) return null;
  const v = value as Record<string, unknown>;
  switch (kind) {
    case "number":
    case "money_per_mt":
      return Number.isFinite(Number(v.num)) ? Number(v.num) : null;
    case "rate_pair":
      return Number.isFinite(Number(v.load)) ? Number(v.load) : null;
    case "date_range":
      if (v.spot === true || !v.from) return null;
      return Math.round(Date.parse(String(v.from)) / 86_400_000);
    default:
      return null;
  }
}

/** "$1.75", "2,000 MT/day", "3d", "aligned" or null when nothing to compare. */
export function spreadLabel(kind: FixtureValueKind, a: FixtureValue | null | undefined, b: FixtureValue | null | undefined): string | null {
  if (!a || !b) return null;
  if (kind === "text" || kind === "port_pair") {
    return formatFixtureValue(kind, a) === formatFixtureValue(kind, b) ? "aligned" : "differs";
  }
  const x = numericOf(kind, a), y = numericOf(kind, b);
  if (x == null || y == null) return null;
  const d = Math.abs(x - y);
  if (d === 0) return "aligned";
  switch (kind) {
    case "money_per_mt": return `$${group(d, 2)}`;
    case "rate_pair": return `${group(d, 0)} MT/day`;
    case "date_range": return `${d}d`;
    default: return groupUpTo2(d);
  }
}

export type ParsedValue = { ok: true; value: FixtureValue } | { ok: false; error: string };

/** Build a value from form fields (strings), with the same rules the database applies. */
export function parseFixtureInput(kind: FixtureValueKind, fields: Record<string, string | undefined>): ParsedValue {
  const num = (s: string | undefined) => {
    const n = Number(String(s ?? "").replace(/,/g, "").trim());
    return Number.isFinite(n) && String(s ?? "").trim() !== "" ? n : null;
  };
  switch (kind) {
    case "text": {
      const t = (fields.text ?? "").trim();
      if (!t || t.length > 500) return { ok: false, error: "Enter 1–500 characters." };
      return { ok: true, value: { text: t } };
    }
    case "number": {
      const n = num(fields.num);
      if (n == null) return { ok: false, error: "Enter a number." };
      return { ok: true, value: { num: n } };
    }
    case "money_per_mt": {
      const n = num(fields.num);
      if (n == null || n < 0) return { ok: false, error: "Enter a non-negative amount." };
      const cur = (fields.currency ?? "USD").trim().toUpperCase() || "USD";
      if (!/^[A-Z]{3}$/.test(cur)) return { ok: false, error: "Currency must be a 3-letter code." };
      return { ok: true, value: { num: n, currency: cur } };
    }
    case "rate_pair": {
      const l = num(fields.load), d = num(fields.disch);
      if (l == null || d == null || l <= 0 || d <= 0) return { ok: false, error: "Enter positive load and discharge rates." };
      return { ok: true, value: { load: l, disch: d } };
    }
    case "date_range": {
      if (fields.spot === "true") return { ok: true, value: { spot: true } };
      const from = (fields.from ?? "").trim(), to = (fields.to ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
        return { ok: false, error: "Enter a laycan window (to on or after from), or mark it SPOT." };
      }
      return { ok: true, value: { from, to } };
    }
    case "port_pair": {
      const load = (fields.load ?? "").trim().toUpperCase(), disch = (fields.disch ?? "").trim().toUpperCase();
      if (!load || !disch) return { ok: false, error: "Enter both a load and a discharge port." };
      return {
        ok: true,
        value: { load, disch, load_name: (fields.load_name ?? "").trim() || null, disch_name: (fields.disch_name ?? "").trim() || null },
      };
    }
  }
}

/** "11:42" style countdown; "0:00" once past. */
export function countdown(expiresAt: string | null | undefined, now: number): string | null {
  if (!expiresAt || !now) return null;
  const s = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A negotiation window that may be days long: "13d 4h", "5h 12m", then the minute countdown. */
export function windowLeftLabel(endsAt: string | null | undefined, now: number): string | null {
  if (!endsAt || !now) return null;
  const s = Math.max(0, Math.floor((Date.parse(endsAt) - now) / 1000));
  if (s >= 86_400) return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return countdown(endsAt, now);
}

/** "2m ago", "just now", "in 3h". */
export function relativeTime(iso: string | null | undefined, now: number): string {
  if (!iso || !now) return "";
  const diff = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(diff);
  const unit = abs < 60 ? [abs, "s"] : abs < 3600 ? [Math.round(abs / 60), "m"] : abs < 86_400 ? [Math.round(abs / 3600), "h"] : [Math.round(abs / 86_400), "d"];
  if (abs < 10) return "just now";
  return diff < 0 ? `${unit[0]}${unit[1]} ago` : `in ${unit[0]}${unit[1]}`;
}

export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}
