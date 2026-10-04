// Portal data loaders — the single boundary between live Supabase data and the
// design view models. Server-only (used from server components).
//
// Each loader tries the real sdk/app query via a server Supabase client and,
// only if Supabase isn't configured (or the query yields nothing), falls back
// to typed sample rows so the /portal preview always renders. Wiring a page to
// live data therefore required no UI changes — just these loaders.
import { getAppUserRow } from "@/lib/app-user";
import { getSpotActiveDays, getVesselActiveDays } from "@/lib/app-settings";
import { getMyCargoListings } from "@/sdk/app/cargos";
import { getFuelIndexSnapshot, type FuelIndexSnapshot } from "@/sdk/app/bunker";
import {
  getMyVesselAvailability,
} from "@/sdk/app/vessels";
import {
  listMarketCargo,
  listMarketVessels,
  type MarketCargoRow,
  type MarketVesselRow,
} from "@/sdk/app/market";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { PortGeo } from "./port-coords";
import { getTemporalAccess, type TemporalAccess } from "@/lib/temporal";
import { toCargoView, vesselFromAvailability } from "./adapters";
import { MOCK_CARGOS, MOCK_VESSELS } from "./mock";
import { CargoView, VesselView } from "./types";
import { legInfo, portKey, type PortNames } from "./route-legs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripVesselNamePrefix } from "@/lib/schemas/vessel";
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
    const row = await getAppUserRow<{ role?: string; trust_tier?: string }>(
      supabase, user.id, "role, trust_tier");
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

// Fuel prices for the voyage estimator, through the governed snapshot
// (sdk/app/bunker.ts#getFuelIndexSnapshot, C2O-033). `snapshot.status` is the
// truth: only "trusted" prices are live. The numeric fields keep the legacy
// calculator rendering and carry the fallback values when the snapshot is
// unavailable; a caller must never label them live unless `live` says so.
// The Voyage engine consumes the snapshot itself for the bunkering port.
export async function loadFuelPrices(portLocode?: string | null): Promise<{
  vlsfo: number; lsmgo: number; port: string; updated: string;
  live: { vlsfo: boolean; lsmgo: boolean };
  snapshot: FuelIndexSnapshot | null;
}> {
  const fallback = {
    vlsfo: 585, lsmgo: 725, port: "Fallback values (no live index)", updated: "",
    live: { vlsfo: false, lsmgo: false }, snapshot: null,
  };
  if (!isSupabaseConfigured()) return fallback;
  let snapshot: FuelIndexSnapshot;
  try {
    const supabase = await getSupabaseServerClient();
    snapshot = await getFuelIndexSnapshot(supabase, { portLocode: portLocode ?? undefined, productKeys: ["VLSFO", "LSMGO"] });
  } catch (err) {
    console.error("[portal] fuel index snapshot failed:", err);
    return fallback;
  }
  if (snapshot.status !== "trusted") return { ...fallback, snapshot };
  const price = (k: string) => snapshot.products.find((p) => p.key === k)!;
  const latest = snapshot.products.map((p) => p.latestQuoteAt).sort().pop()!;
  return {
    vlsfo: price("VLSFO").averageUsdMt,
    lsmgo: price("LSMGO").averageUsdMt,
    port: snapshot.actualPort ?? (snapshot.region ? `${snapshot.region} average` : "Platform index (all ports)"),
    updated: new Date(latest).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    live: { vlsfo: true, lsmgo: true },
    snapshot,
  };
}

// Port names for the route legs: locode → trade name and normalised name →
// locode, from the ports table (a few hundred rows; one query per request).
async function loadPortNames(): Promise<PortNames | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.from("ports").select("locode, trade_name").eq("is_active", true);
    if (error || !data) return null;
    const names: PortNames = { byCode: {}, byName: {} };
    for (const p of data as { locode: string; trade_name: string | null }[]) {
      const code = (p.locode ?? "").replace(/\s+/g, "").toUpperCase();
      if (!code) continue;
      if (p.trade_name) { names.byCode[code] = p.trade_name; const k = portKey(p.trade_name); if (k && !names.byName[k]) names.byName[k] = code; }
    }
    return names;
  } catch { return null; }
}

function withLegs(v: CargoView, names: PortNames | null): CargoView {
  const ps = v.portScope;
  return {
    ...v,
    polLeg: legInfo(v.route.polCode, v.route.polName, v.route.polZone, names,
      ps ? { scope: ps.polScope, refCode: ps.polRef } : null),
    podLeg: legInfo(v.route.podCode, v.route.podName, v.route.podZone, names,
      ps ? { scope: ps.podScope, refCode: ps.podRef } : null),
  };
}

export async function loadCargoViews({ mine = false } = {}): Promise<Loaded<CargoView>> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await getSupabaseServerClient();
      let archiveLabel: string | undefined;
      let views: CargoView[];
      if (mine) {
        const [rows, governed] = await Promise.all([
          getMyCargoListings(supabase),
          listMarketCargo(supabase).catch(() => [] as MarketCargoRow[]),
        ]);
        const byOwnedId = new Map(
          governed
            .filter((row) => row.owned_listing_id)
            .map((row) => [row.owned_listing_id!, row]),
        );
        views = rows.map((row) => {
          const safe = byOwnedId.get(row.id);
          const view = toCargoView(row, safe?.match_count ?? 0, {
            listingKey: safe?.listing_key ?? null,
            ownedListingId: row.id,
            isOwned: true,
            canManage: true,
            listingKeyExpiresAt: safe?.expires_at ?? null,
          });
          return safe?.poster
            ? {
                ...view,
                poster: {
                  name: safe.poster.name,
                  company: safe.poster.company,
                  kind: safe.poster.kind,
                  isAdmin: safe.poster.is_admin,
                  orgId: null,
                },
              }
            : view;
        });
      } else {
        // Discovery: bound the result to the viewer's tier-based archive window,
        // and age out spot cargoes past the admin-configured active window so the
        // board matches the public "available this week" count.
        const access = await loadArchiveAccess(supabase);
        archiveLabel = access.archiveLabel;
        const spotDays = await getSpotActiveDays();
        const spotActiveFrom = new Date(Date.now() - spotDays * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const rows = await listMarketCargo(supabase, {
          archiveCutoff: access.archiveCutoff,
          activeFrom: spotActiveFrom,
        });
        views = rows.map((row) => toCargoView(row));
      }
      const names = views.length ? await loadPortNames() : null;
      // Configured = real environment: return live results even when empty so
      // members see a proper empty state, never mock listings.
      return {
        views: views.map((view) => withLegs(view, names)),
        source: "live",
        archiveLabel,
      };
    } catch (err) {
      // A configured environment fails closed. Sample rows are design-preview
      // data only and must never replace a governed market response.
      console.error("[portal] governed cargo market load failed:", err);
      return { views: [], source: "live" };
    }
  }
  return {
    views: MOCK_CARGOS.map((r, i) => withLegs(toCargoView(r, CARGO_MATCHES[i] ?? 0), null)),
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
      let archiveLabel: string | undefined;
      let views: VesselView[];
      if (mine) {
        const [rows, governed] = await Promise.all([
          getMyVesselAvailability(supabase),
          listMarketVessels(supabase).catch(() => [] as MarketVesselRow[]),
        ]);
        const byOwnedId = new Map(
          governed
            .filter((row) => row.owned_listing_id)
            .map((row) => [row.owned_listing_id!, row]),
        );
        views = rows.map((row) => {
          const safe = byOwnedId.get(row.id);
          const view = vesselFromAvailability(row, safe?.match_count ?? 0, {
            listingKey: safe?.listing_key ?? null,
            ownedListingId: row.id,
            isOwned: true,
            canManage: true,
            listingKeyExpiresAt: safe?.expires_at ?? null,
          });
          return safe?.poster
            ? {
                ...view,
                poster: {
                  name: safe.poster.name,
                  company: safe.poster.company,
                  kind: safe.poster.kind,
                  isAdmin: safe.poster.is_admin,
                  orgId: null,
                },
              }
            : view;
        });
      } else {
        const access = await loadArchiveAccess(supabase);
        archiveLabel = access.archiveLabel;
        const vesselDays = await getVesselActiveDays();
        const vesselActiveFrom = new Date(Date.now() - vesselDays * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const rows = await listMarketVessels(supabase, {
          archiveCutoff: access.archiveCutoff,
          activeFrom: vesselActiveFrom,
        });
        views = rows.map((row) => vesselFromAvailability(row));
      }
      return {
        views,
        source: "live",
        archiveLabel,
      };
    } catch (err) {
      console.error("[portal] governed vessel market load failed:", err);
      return { views: [], source: "live" };
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
      const { data: own } = await supabase
        .from("listing_ownership")
        .select("listing_id")
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
            out.push({ id: v.id, name: stripVesselNamePrefix(v.vessel_name), imo: v.imo_number ?? "—" });
          }
        }
        if (out.length) return out;
      }
    } catch (err) {
      console.error("[portal] my vessels list load failed:", err);
    }
  }
  return MOCK_VESSELS.map((v) => ({ id: v.vessel_id, name: stripVesselNamePrefix(v.vessel.vessel_name), imo: v.vessel.imo_number ?? "—" }));
}

// ── Real viewer context (subscription tier + role), adopted from the migration ──
// Reads users.subscription_tier + is_market_partner + role for the signed-in
// user. Market partners are treated as subscribers (effective T3). Falls back to
// T3 in the unconfigured preview so the design renders unlocked.
import { viewerTierFrom } from "@/lib/tiers";
import { normalizeRole, type AppRole } from "@/lib/role";
import type { Tier } from "./tier";

export async function loadViewerContext(): Promise<{ tier: Tier; role: AppRole | null; userName: string | null; isMarketPartner: boolean }> {
  if (!isSupabaseConfigured()) return { tier: "T3", role: null, userName: null, isMarketPartner: false };
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { tier: "T3", role: null, userName: null, isMarketPartner: false };
    const data = await getAppUserRow<{ role?: string; full_name?: string; subscription_tier?: string | null; is_market_partner?: boolean | null }>(
      supabase, user.id, "role, full_name, subscription_tier, is_market_partner");
    const vt = viewerTierFrom(data as { subscription_tier?: string | null; is_market_partner?: boolean | null } | null);
    const tier = (vt.isMarketPartner ? "T3" : vt.tier) as Tier;
    return {
      tier,
      role: normalizeRole((data as { role?: string } | null)?.role),
      userName: (data as { full_name?: string } | null)?.full_name ?? null,
      isMarketPartner: vt.isMarketPartner,
    };
  } catch (err) {
    console.error("[portal] viewer context load failed:", err);
    return { tier: "T3", role: null, userName: null, isMarketPartner: false };
  }
}
