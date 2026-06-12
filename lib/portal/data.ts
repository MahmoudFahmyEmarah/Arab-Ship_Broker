// Portal data loaders — the single boundary between live Supabase data and the
// design view models. Server-only (used from server components).
//
// Each loader tries the real sdk/app query via a server Supabase client and,
// only if Supabase isn't configured (or the query yields nothing), falls back
// to typed sample rows so the /portal preview always renders. Wiring a page to
// live data therefore required no UI changes — just these loaders.
import { getCargos, getMyCargoListings, getMatchesForCargo } from "@/sdk/app/cargos";
import {
  getOpenVesselAvailability,
  getMyVesselAvailability,
  getMatchesForAvailability,
} from "@/sdk/app/vessels";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { PortGeo } from "./port-coords";
import { getTemporalAccess, type TemporalAccess } from "@/lib/temporal";
import { toCargoView, vesselFromAvailability } from "./adapters";
import { MOCK_CARGOS, MOCK_VESSELS } from "./mock";
import { CargoView, VesselView } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CargoListingRow } from "@/lib/schemas/cargo";
import type { VesselAvailabilityWithVessel } from "@/lib/schemas/vessel";
import type { CargoOpt, VesselOpt } from "./post-types";

export type DataSource = "live" | "sample";
export type Loaded<T> = { views: T[]; source: DataSource; archiveLabel?: string };

// Tier-based archive window (Verified = 3 months, Standard = 1 month, Admin =
// unlimited). Enforced at the QUERY level — there is no RLS policy for it — so
// the discovery loaders MUST pass the cutoff or older listings leak across tiers.
async function loadArchiveAccess(supabase: SupabaseClient): Promise<TemporalAccess> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return getTemporalAccess("", "NEW");
    const { data } = await supabase
      .from("users")
      .select("role, trust_tier")
      .eq("id", user.id)
      .single();
    const row = data as { role?: string; trust_tier?: string } | null;
    return getTemporalAccess(normalizeRole(row?.role) ?? "", row?.trust_tier ?? "NEW");
  } catch {
    return getTemporalAccess("", "NEW"); // safest default: most restrictive window
  }
}

// Demo match counts for the sample fallback (live counts come from the
// match RPCs, wired per-listing in a later phase).
const CARGO_MATCHES = [3, 1, 7, 2, 5, 4];
const VESSEL_MATCHES = [7, 12, 9, 5, 3, 8];

function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return !!url && !url.includes("placeholder");
}

// Live match counts come from the per-listing match RPCs. We fan out in
// parallel (bounded) and tolerate per-listing failures (default 0). For large
// boards a dedicated count view/RPC would be more efficient — noted follow-up.
const MATCH_COUNT_CAP = 60;

async function cargoMatchCounts(
  supabase: SupabaseClient,
  rows: CargoListingRow[],
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    rows.slice(0, MATCH_COUNT_CAP).map(async (r) => {
      try {
        const m = await getMatchesForCargo(supabase, r.id);
        return [r.id, m.length] as const;
      } catch {
        return [r.id, 0] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

async function availabilityMatchCounts(
  supabase: SupabaseClient,
  rows: VesselAvailabilityWithVessel[],
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    rows.slice(0, MATCH_COUNT_CAP).map(async (r) => {
      try {
        const m = await getMatchesForAvailability(supabase, r.id);
        return [r.id, m.length] as const;
      } catch {
        return [r.id, 0] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

// Live bunker prices for the calculators — the SAME admin-managed fuel_prices
// table the bunker ticker reads. Falls back to the econ defaults if unset.
export async function loadFuelPrices(): Promise<{ vlsfo: number; lsmgo: number; port: string; updated: string }> {
  const fallback = { vlsfo: 585, lsmgo: 725, port: "Singapore", updated: "" };
  if (!isSupabaseConfigured()) return fallback;
  try {
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase
      .from("fuel_prices")
      .select("vlsfo_usd_mt, lsmgo_usd_mt, port_area, updated_at")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const fp = data as { vlsfo_usd_mt?: number | null; lsmgo_usd_mt?: number | null; port_area?: string | null; updated_at?: string | null } | null;
    if (!fp) return fallback;
    return {
      vlsfo: fp.vlsfo_usd_mt ?? fallback.vlsfo,
      lsmgo: fp.lsmgo_usd_mt ?? fallback.lsmgo,
      port: fp.port_area ?? fallback.port,
      updated: fp.updated_at ? new Date(fp.updated_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : fallback.updated,
    };
  } catch (err) {
    console.error("[portal] fuel price load failed:", err);
    return fallback;
  }
}

export async function loadCargoViews({ mine = false } = {}): Promise<Loaded<CargoView>> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await getSupabaseServerClient();
      let rows: CargoListingRow[];
      let archiveLabel: string | undefined;
      if (mine) {
        rows = await getMyCargoListings(supabase);
      } else {
        // Discovery: bound the result to the viewer's tier-based archive window.
        const access = await loadArchiveAccess(supabase);
        archiveLabel = access.archiveLabel;
        rows = await getCargos(supabase, { archiveCutoff: access.archiveCutoff ?? undefined });
      }
      const counts = rows.length ? await cargoMatchCounts(supabase, rows) : {};
      // Configured = real environment: return live results even when empty so
      // members see a proper empty state, never mock listings.
      return {
        views: rows.map((r) => toCargoView(r, counts[r.id] ?? 0)),
        source: "live",
        archiveLabel,
      };
    } catch (err) {
      console.error("[portal] live cargo load failed, using sample:", err);
    }
  }
  return {
    views: MOCK_CARGOS.map((r, i) => toCargoView(r, CARGO_MATCHES[i] ?? 0)),
    source: "sample",
  };
}

// Port coordinates (locode → [lat, lon]) from the `ports` table, for map pins.
// Returns {} when Supabase isn't configured (map falls back to static coords)
// or under the unauthenticated preview (ports RLS requires an authed user).
export async function loadPortCoords(
  locodes: string[],
): Promise<Record<string, PortGeo>> {
  const unique = Array.from(new Set(locodes.filter(Boolean)));
  if (!unique.length || !isSupabaseConfigured()) return {};
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("ports")
      .select("locode, latitude, longitude, seaward_bearing")
      .in("locode", unique);
    if (error || !data) return {};
    const out: Record<string, PortGeo> = {};
    for (const p of data as { locode: string; latitude: number | null; longitude: number | null; seaward_bearing?: number | null }[]) {
      if (p.latitude != null && p.longitude != null) {
        out[p.locode] =
          p.seaward_bearing != null
            ? [Number(p.latitude), Number(p.longitude), Number(p.seaward_bearing)]
            : [Number(p.latitude), Number(p.longitude)];
      }
    }
    return out;
  } catch (err) {
    console.error("[portal] port coords load failed:", err);
    return {};
  }
}

export async function loadVesselViews({ mine = false } = {}): Promise<Loaded<VesselView>> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await getSupabaseServerClient();
      let rows: VesselAvailabilityWithVessel[];
      let archiveLabel: string | undefined;
      if (mine) {
        rows = await getMyVesselAvailability(supabase);
      } else {
        const access = await loadArchiveAccess(supabase);
        archiveLabel = access.archiveLabel;
        rows = await getOpenVesselAvailability(supabase, { archiveCutoff: access.archiveCutoff ?? undefined });
      }
      const counts = rows.length ? await availabilityMatchCounts(supabase, rows) : {};
      return {
        views: rows.map((r) => vesselFromAvailability(r, counts[r.id] ?? 0)),
        source: "live",
        archiveLabel,
      };
    } catch (err) {
      console.error("[portal] live vessel load failed, using sample:", err);
    }
  }
  return {
    views: MOCK_VESSELS.map((r, i) => ({
      ...vesselFromAvailability(r),
      matches: VESSEL_MATCHES[i] ?? 0,
    })),
    source: "sample",
  };
}

// ── Reference lists for the Post flows ─────────────────────────────────────
const SAMPLE_COMMODITIES: CargoOpt[] = [
  { id: "c-wheat", name: "Wheat, Bulk", cargoType: "Dry Bulk", isDg: false, isGrain: true },
  { id: "c-steel", name: "Steel Coils", cargoType: "Break Bulk", isDg: false, isGrain: false },
  { id: "c-phos", name: "Phosphate Rock", cargoType: "Dry Bulk", isDg: true, isGrain: false },
  { id: "c-urea", name: "Urea, Bagged", cargoType: "Break Bulk", isDg: false, isGrain: false },
  { id: "c-clinker", name: "Clinker", cargoType: "Dry Bulk", isDg: false, isGrain: false },
  { id: "c-barley", name: "Barley", cargoType: "Dry Bulk", isDg: false, isGrain: true },
];

export async function loadCommodities(): Promise<CargoOpt[]> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await getSupabaseServerClient();
      const { data } = await supabase
        .from("commodities")
        .select("id, canonical_name, cargo_type, is_dg, is_grain")
        .eq("is_active", true)
        .order("sort_order")
        .limit(80);
      if (data?.length) {
        return (data as { id: string; canonical_name: string; cargo_type: string; is_dg: boolean; is_grain: boolean }[]).map((r) => ({
          id: r.id, name: r.canonical_name, cargoType: r.cargo_type, isDg: r.is_dg, isGrain: r.is_grain,
        }));
      }
    } catch (err) {
      console.error("[portal] commodities load failed:", err);
    }
  }
  return SAMPLE_COMMODITIES;
}

export async function loadMyVesselsList(): Promise<VesselOpt[]> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await getSupabaseServerClient();
      // Prod has no v_my_vessels: a user's fleet = distinct vessels behind the
      // availability positions they own (listing_ownership).
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: own } = await supabase
          .from("listing_ownership")
          .select("listing_id")
          .eq("owner_user_id", user.id)
          .eq("listing_type", "vessel_availability")
          .eq("is_current", true)
          .eq("role", "primary");
        const ids = (own ?? []).map((o: { listing_id: string }) => o.listing_id);
        if (ids.length) {
          const { data } = await supabase
            .from("vessel_availability")
            .select("vessel:vessels ( id, vessel_name, imo_number )")
            .in("id", ids);
          type VJoin = { id: string; vessel_name: string; imo_number: string | null };
          const seen = new Set<string>();
          const out: VesselOpt[] = [];
          for (const row of (data ?? []) as { vessel: VJoin | VJoin[] | null }[]) {
            const v = Array.isArray(row.vessel) ? row.vessel[0] : row.vessel;
            if (v && !seen.has(v.id)) {
              seen.add(v.id);
              out.push({ id: v.id, name: v.vessel_name, imo: v.imo_number ?? "—" });
            }
          }
          if (out.length) return out;
        }
      }
    } catch (err) {
      console.error("[portal] my vessels list load failed:", err);
    }
  }
  return MOCK_VESSELS.map((v) => ({ id: v.vessel_id, name: v.vessel.vessel_name, imo: v.vessel.imo_number ?? "—" }));
}

// ── Real viewer context (subscription tier + role), adopted from the migration ──
// Reads users.subscription_tier + is_market_partner + role for the signed-in
// user. Market partners are treated as subscribers (effective T3). Falls back to
// T3 in the unconfigured preview so the design renders unlocked.
import { viewerTierFrom } from "@/lib/tiers";
import { normalizeRole, type AppRole } from "@/lib/role";
import type { Tier } from "./tier";

export async function loadViewerContext(): Promise<{ tier: Tier; role: AppRole | null; userName: string | null }> {
  if (!isSupabaseConfigured()) return { tier: "T3", role: null, userName: null };
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { tier: "T3", role: null, userName: null };
    const { data } = await supabase
      .from("users")
      .select("role, full_name, subscription_tier")
      .eq("id", user.id)
      .single();
    const vt = viewerTierFrom(data as { subscription_tier?: string | null; is_market_partner?: boolean | null } | null);
    const tier = (vt.isMarketPartner ? "T3" : vt.tier) as Tier;
    return { tier, role: normalizeRole((data as { role?: string } | null)?.role), userName: (data as { full_name?: string } | null)?.full_name ?? null };
  } catch (err) {
    console.error("[portal] viewer context load failed:", err);
    return { tier: "T3", role: null, userName: null };
  }
}
