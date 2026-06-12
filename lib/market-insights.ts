// Public Market Insights — types + server loaders.
// The public page reads ONLY frozen, published editions through anon RPCs
// (get_latest_market_insights / _edition / _archive). Those RPCs return the
// already-aggregated, already-floored, already-banded jsonb produced by the
// Part-1 generator — never raw rows. A sample edition is used as a fallback so
// the page renders before the first Monday job runs / in preview; the sample
// itself obeys the rules (bands, ≥5 floor, an "Other" rollup).
import { createClient } from "@supabase/supabase-js";

export interface InsightBucket {
  label: string;
  count: number;
}

export interface InsightPayload {
  window: { from: string; to: string };
  scope: string;
  snapshot: {
    cargoes_live: number;
    open_tonnage: number;
    active_lanes: number;
    avg_cargo_size_mt: number | null;
  };
  regime_mix: InsightBucket[];
  size_bands: InsightBucket[];
  top_lanes: InsightBucket[];
  top_commodities: InsightBucket[];
  load_zones: InsightBucket[];
  disch_zones: InsightBucket[];
  floor: number;
}

export interface InsightEdition {
  week_id: string;
  range_from: string;
  range_to: string;
  payload: InsightPayload;
  narrative: string | null;
  published_at: string | null;
  sample?: boolean;
}

export interface ArchiveItem {
  week_id: string;
  range_from: string;
  range_to: string;
  published_at: string | null;
}

// Fixed band order for display (mirrors the generator's banding).
export const SIZE_BAND_ORDER = ["<10K", "10–20K", "20–35K", "35–50K", "50K+"] as const;

function anon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || url.includes("placeholder")) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Sample fallback edition (rules-compliant) ──────────────────────────────
export const SAMPLE_EDITION: InsightEdition = {
  week_id: "2026-W23",
  range_from: "2026-05-30",
  range_to: "2026-06-05",
  published_at: "2026-06-08T06:00:00Z",
  sample: true,
  narrative:
    "Sub-66K activity stayed firm out of the Arabian Gulf into East Med, with grain " +
    "parcels leading the mix. Red Sea demand held despite routing caution. Break-bulk " +
    "out of the Black Sea thinned. (Sample edition — replaced by the live Monday run.)",
  payload: {
    window: { from: "2026-05-30", to: "2026-06-05" },
    scope: "Regional dry bulk & break-bulk, sub-66K — AG / R.Sea / E.Med / B.Sea / A.Sea",
    snapshot: { cargoes_live: 84, open_tonnage: 39, active_lanes: 12, avg_cargo_size_mt: 28500 },
    regime_mix: [
      { label: "Dry bulk (IMSBC)", count: 47 },
      { label: "Grain", count: 28 },
      { label: "Break-bulk (CSS)", count: 9 },
    ],
    size_bands: [
      { label: "20–35K", count: 31 },
      { label: "10–20K", count: 24 },
      { label: "35–50K", count: 16 },
      { label: "<10K", count: 8 },
      { label: "50K+", count: 5 },
    ],
    top_lanes: [
      { label: "AG → E.MED", count: 14 },
      { label: "R.SEA → AG", count: 9 },
      { label: "B.SEA → E.MED", count: 7 },
      { label: "AG → A.SEA", count: 6 },
      { label: "Other", count: 11 }, // ← rolled-up lanes that fell under the ≥5 floor
    ],
    top_commodities: [
      { label: "Wheat", count: 18 },
      { label: "Clinker", count: 11 },
      { label: "Urea", count: 7 },
      { label: "Steel products", count: 6 },
      { label: "Other", count: 14 },
    ],
    load_zones: [
      { label: "AG", count: 33 },
      { label: "B.SEA", count: 19 },
      { label: "R.SEA", count: 14 },
      { label: "E.MED", count: 9 },
      { label: "Other", count: 9 },
    ],
    disch_zones: [
      { label: "E.MED", count: 26 },
      { label: "AG", count: 21 },
      { label: "A.SEA", count: 17 },
      { label: "R.SEA", count: 11 },
      { label: "Other", count: 9 },
    ],
    floor: 5,
  },
};

export async function getLatestEdition(): Promise<InsightEdition> {
  const c = anon();
  if (c) {
    try {
      const { data } = await c.rpc("get_latest_market_insights");
      if (data) return data as InsightEdition;
    } catch (err) {
      console.error("[insights] latest load failed, using sample:", err);
    }
  }
  return SAMPLE_EDITION;
}

export async function getEdition(weekId: string): Promise<InsightEdition | null> {
  const c = anon();
  if (c) {
    try {
      const { data } = await c.rpc("get_market_insights_edition", { p_week_id: weekId });
      if (data) return data as InsightEdition;
    } catch (err) {
      console.error("[insights] edition load failed:", err);
    }
  }
  return weekId === SAMPLE_EDITION.week_id ? SAMPLE_EDITION : null;
}

export async function getArchive(): Promise<ArchiveItem[]> {
  const c = anon();
  if (c) {
    try {
      const { data } = await c.rpc("get_market_insights_archive");
      if (Array.isArray(data) && data.length) return data as ArchiveItem[];
    } catch (err) {
      console.error("[insights] archive load failed:", err);
    }
  }
  return [
    { week_id: SAMPLE_EDITION.week_id, range_from: SAMPLE_EDITION.range_from, range_to: SAMPLE_EDITION.range_to, published_at: SAMPLE_EDITION.published_at },
    { week_id: "2026-W22", range_from: "2026-05-23", range_to: "2026-05-29", published_at: "2026-06-01T06:00:00Z" },
    { week_id: "2026-W21", range_from: "2026-05-16", range_to: "2026-05-22", published_at: "2026-05-25T06:00:00Z" },
  ];
}

export function formatRange(from: string, to: string): string {
  const f = new Date(from), t = new Date(to);
  const d = (x: Date) => x.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${d(f)}–${t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

// ════════════════════════════════════════════════════════════════════
// Handysize daily FUEL-COST estimate (Pre_Final §11). MEMBER-ONLY.
//
// FIREWALL (correctness requirement): this object must only ever be rendered
// for an authenticated member session. The public Market Insights page must
// NOT embed any of these figures in its DOM — render the locked teaser there
// instead. It is an ASB operational fuel-cost estimate, NOT a freight/hire
// market quote, and depends on no external broker data.
//
// Basis: Handysize · LSMGO · 12.5 kn sea steaming. Scenarios: Normal $1,000/t,
// Hormuz-stress $1,400/t (Strait of Hormuz escalation premium).
// ════════════════════════════════════════════════════════════════════
export interface FuelTier {
  label: string;
  cons: number; // sea consumption, t/day
  normal: number; // $/day @ $1,000/t
  stress: number; // $/day @ $1,400/t
}

export const FUEL_COST = {
  basis:
    "Handysize · LSMGO · 12.5 kn · sea steaming. Port basis ~3 t/day working cargo.",
  estimateLabel: "ASB operational estimate · not a market quote",
  scenarios: {
    normal: { label: "Normal", price: 1000 },
    stress: { label: "Hormuz-stress", price: 1400 },
  },
  tiers: [
    { label: "Modern (5yr)", cons: 13, normal: 13000, stress: 18200 },
    { label: "10-year", cons: 14, normal: 14000, stress: 19600 },
    { label: "15-year", cons: 15, normal: 15000, stress: 21000 },
    { label: "20-year+", cons: 16, normal: 16000, stress: 22400 },
  ] as FuelTier[],
  port: { cons: "3 t/day", normal: 3000, stress: 4200 },
} as const;

// ── ISO-8601 week helpers (Pre_Final §11 polish · correctness requirement) ──
// Week ids/ranges are computed from the international ISO calendar, never
// hand-typed. Used to show the current in-progress week as a disabled chip.
function isoWeekParts(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; // 1=Mon..7=Sun
  t.setUTCDate(t.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: t.getUTCFullYear(), week };
}

export function currentIsoWeek(now: Date = new Date()): {
  weekId: string; range_from: string; range_to: string;
} {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = today.getUTCDay() || 7;
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - (dow - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const { year, week } = isoWeekParts(monday);
  return {
    weekId: `${year}-W${String(week).padStart(2, "0")}`,
    range_from: monday.toISOString().slice(0, 10),
    range_to: sunday.toISOString().slice(0, 10),
  };
}
