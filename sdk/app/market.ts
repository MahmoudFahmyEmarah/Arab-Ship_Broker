import type { SupabaseClient } from "@supabase/supabase-js";

import type { CargoListingRow } from "@/lib/schemas/cargo";
import type {
  VesselAvailabilityRow,
  VesselRow,
} from "@/lib/schemas/vessel";

/**
 * Governed market rows never use a table primary key as their public identity.
 * `id` and `listing_key` are the same short-lived, actor/purpose-bound handle.
 * The raw listing id is present only when the caller may manage that listing.
 */
export interface MarketAccessFields {
  id: string;
  listing_key: string;
  /**
   * The counterpart's key on its market board. Match-purpose handles are not
   * comparable with board-purpose handles, so match rows provide this second
   * opaque key for focus/filter correlation without exposing a raw id.
   */
  board_listing_key?: string | null;
  is_owned: boolean;
  can_manage: boolean;
  owned_listing_id: string | null;
  expires_at: string;
  match_count?: number | null;
  poster?: MarketPosterRow | null;
}

export interface MarketPosterRow {
  name: string | null;
  company: string | null;
  kind: "individual" | "company" | "employee";
  is_admin: boolean;
}

export interface MarketFit {
  rate_aligned: boolean;
  dwt_delta: number | null;
  zone: string | null;
  laycan: string | null;
  grain: boolean;
  dg: boolean;
  gear_required: boolean;
  part_cargo: boolean;
}

/** Strict allow-list for cargo data that may cross the member market boundary. */
export type MarketCargoRow = MarketAccessFields & {
  listing_type?: "cargo";
  ref: CargoListingRow["ref"];
  status: CargoListingRow["status"];
  review_status: CargoListingRow["review_status"];
  goes_live_at: CargoListingRow["goes_live_at"];
  cargo_type: CargoListingRow["cargo_type"];
  commodity_name: CargoListingRow["commodity_name"];
  is_dg_cargo: CargoListingRow["is_dg_cargo"];
  is_grain_cargo: CargoListingRow["is_grain_cargo"];
  qty_min_mt: CargoListingRow["qty_min_mt"];
  qty_max_mt: CargoListingRow["qty_max_mt"];
  stowage_factor: CargoListingRow["stowage_factor"];
  volume_cbm: CargoListingRow["volume_cbm"];
  load_port_locode: CargoListingRow["load_port_locode"];
  load_port_name: CargoListingRow["load_port_name"];
  load_zone: CargoListingRow["load_zone"];
  load_country: CargoListingRow["load_country"];
  disch_port_locode: CargoListingRow["disch_port_locode"];
  disch_port_name: CargoListingRow["disch_port_name"];
  disch_zone: CargoListingRow["disch_zone"];
  disch_country: CargoListingRow["disch_country"];
  load_port_scope: CargoListingRow["load_port_scope"];
  disch_port_scope: CargoListingRow["disch_port_scope"];
  load_ref_locode: CargoListingRow["load_ref_locode"];
  disch_ref_locode: CargoListingRow["disch_ref_locode"];
  load_ports: CargoListingRow["load_ports"];
  disch_ports: CargoListingRow["disch_ports"];
  laycan_from: CargoListingRow["laycan_from"];
  laycan_to: CargoListingRow["laycan_to"];
  is_spot: CargoListingRow["is_spot"];
  nor_clause: CargoListingRow["nor_clause"];
  load_rate: CargoListingRow["load_rate"];
  disch_rate: CargoListingRow["disch_rate"];
  load_terms: CargoListingRow["load_terms"];
  laytime_structure: string | null;
  freight_idea_usd_mt: CargoListingRow["freight_idea_usd_mt"];
  commission_pct: CargoListingRow["commission_pct"];
  commission_ttl_pct: CargoListingRow["commission_ttl_pct"];
  demurrage_rate: CargoListingRow["demurrage_rate"];
  despatch_rate: CargoListingRow["despatch_rate"];
  requires_geared: CargoListingRow["requires_geared"];
  max_vessel_age_yr: CargoListingRow["max_vessel_age_yr"];
  max_loa_m: CargoListingRow["max_loa_m"];
  max_draft_m: CargoListingRow["max_draft_m"];
  broker: CargoListingRow["broker"];
  created_at: CargoListingRow["created_at"];
  updated_at: CargoListingRow["updated_at"];
  refreshed_at: string | null;
  fit?: MarketFit | null;
};

type SafeMarketVessel = {
  /** Raw registry id is returned only to the exact owner/admin. */
  id: string | null;
  vessel_name: VesselRow["vessel_name"];
  imo_number: VesselRow["imo_number"];
  vessel_type: VesselRow["vessel_type"];
  dwt_grain: VesselRow["dwt_grain"];
  dwt_bale: VesselRow["dwt_bale"];
  grain_cbm: VesselRow["grain_cbm"];
  bale_cbm: VesselRow["bale_cbm"];
  gross_tonnage: VesselRow["gross_tonnage"];
  scnrt: VesselRow["scnrt"];
  build_year: VesselRow["build_year"];
  flag: VesselRow["flag"];
  scope: VesselRow["scope"];
  risk_level: VesselRow["risk_level"];
  is_geared: VesselRow["is_geared"];
  grain_certified: VesselRow["grain_certified"];
  dg_certified: VesselRow["dg_certified"];
  max_loa_m: VesselRow["max_loa_m"];
  max_draft_m: VesselRow["max_draft_m"];
  beam_m: VesselRow["beam_m"];
  preferred_zones: VesselRow["preferred_zones"];
  is_tbn: boolean;
  is_verified: boolean;
};

/** Strict allow-list for open-position data crossing the market boundary. */
export type MarketVesselRow = MarketAccessFields & {
    listing_type?: "vessel_availability" | "vessel";
    ref: VesselAvailabilityRow["ref"];
    open_port_locode: VesselAvailabilityRow["open_port_locode"];
    open_port_name: VesselAvailabilityRow["open_port_name"];
    open_zone: VesselAvailabilityRow["open_zone"];
    open_date: VesselAvailabilityRow["open_date"];
    open_date_range_days: VesselAvailabilityRow["open_date_range_days"];
    last_cargo: VesselAvailabilityRow["last_cargo"];
    service_speed_kn: VesselAvailabilityRow["service_speed_kn"];
    me_consumption_mt_day: VesselAvailabilityRow["me_consumption_mt_day"];
    me_consumption_port_mt_day: VesselAvailabilityRow["me_consumption_port_mt_day"];
    aux_consumption_mt_day: VesselAvailabilityRow["aux_consumption_mt_day"];
    aux_consumption_port_mt_day: VesselAvailabilityRow["aux_consumption_port_mt_day"];
    vlsfo_sea_mt_day: number | null;
    vlsfo_port_mt_day: number | null;
    lsmgo_sea_mt_day: number | null;
    lsmgo_port_mt_day: number | null;
    fuel_type: VesselAvailabilityRow["fuel_type"];
    freight_idea_usd_mt: VesselAvailabilityRow["freight_idea_usd_mt"];
    accepts_part_cargo: VesselAvailabilityRow["accepts_part_cargo"];
    status: VesselAvailabilityRow["status"];
    review_status: VesselAvailabilityRow["review_status"];
    goes_live_at: VesselAvailabilityRow["goes_live_at"];
    created_at: VesselAvailabilityRow["created_at"];
    updated_at: VesselAvailabilityRow["updated_at"];
    refreshed_at: string | null;
    vessel: SafeMarketVessel;
    fit?: MarketFit | null;
  };

export type MarketListingRow = MarketCargoRow | MarketVesselRow;
export type MarketListingType = "cargo" | "vessel_availability";

export interface MarketListFilters {
  archiveCutoff?: string | null;
  activeFrom?: string | null;
}

function unwrapItems<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const object = value as { items?: unknown };
    if (Array.isArray(object.items)) return object.items as T[];
  }
  return [];
}

function isCargoRow(row: MarketListingRow): row is MarketCargoRow {
  return "commodity_name" in row;
}

export function isMarketCargoRow(row: MarketListingRow): row is MarketCargoRow {
  return isCargoRow(row);
}

export function isMarketVesselRow(row: MarketListingRow): row is MarketVesselRow {
  return !isCargoRow(row) && "vessel" in row;
}

export function marketBoardKey(row: MarketListingRow): string {
  return row.board_listing_key ?? row.listing_key;
}

export async function listMarketCargo(
  supabase: SupabaseClient,
  filters: MarketListFilters = {},
): Promise<MarketCargoRow[]> {
  const { data, error } = await supabase.rpc("list_market_cargo", {
    p_archive_cutoff: filters.archiveCutoff ?? null,
    p_spot_active_from: filters.activeFrom ?? null,
  });
  if (error) throw error;
  return unwrapItems<MarketCargoRow>(data);
}

export async function listMarketVessels(
  supabase: SupabaseClient,
  filters: MarketListFilters = {},
): Promise<MarketVesselRow[]> {
  const { data, error } = await supabase.rpc("list_market_vessels", {
    p_archive_cutoff: filters.archiveCutoff ?? null,
    p_vessel_active_from: filters.activeFrom ?? null,
  });
  if (error) throw error;
  return unwrapItems<MarketVesselRow>(data);
}

export async function listMarketMatches(
  supabase: SupabaseClient,
  listingKey: string,
): Promise<MarketListingRow[]> {
  const { data, error } = await supabase.rpc("list_market_matches", {
    p_listing_key: listingKey,
  });
  if (error) throw error;
  return unwrapItems<MarketListingRow>(data);
}

export async function getMarketListingDetail(
  supabase: SupabaseClient,
  listingKey: string,
): Promise<(MarketListingRow & { ownership?: Record<string, unknown> | null }) | null> {
  const { data, error } = await supabase.rpc("get_market_listing_detail", {
    p_listing_key: listingKey,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as MarketListingRow & { ownership?: Record<string, unknown> | null };
}

/**
 * Return the complete registry row only on a raw-id management surface.
 *
 * The database function authorises administrators, vessel claimants, and the
 * exact personal/org owner of one of the hull's positions. Market viewers must
 * use `getMarketListingDetail` with an opaque listing key instead.
 */
export async function getManagedVessel(
  supabase: SupabaseClient,
  vesselId: string,
): Promise<VesselRow | null> {
  const { data, error } = await supabase.rpc("get_managed_vessel", {
    p_vessel_id: vesselId,
  });

  if (error) {
    const diagnostic = [error.code, error.message, error.details, error.hint]
      .filter(Boolean)
      .join(" ");
    if (diagnostic.includes("MARKET_NOT_FOUND")) return null;
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return row as VesselRow;
}

/** Exact personal/org-seat ownership check for raw management routes. */
export async function ownsMarketListing(
  supabase: SupabaseClient,
  listingType: MarketListingType,
  listingId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("fn_market_owns_listing", {
    p_listing_type: listingType,
    p_listing_id: listingId,
  });
  if (error) throw error;
  return data === true;
}

export async function canManageMarketListing(
  supabase: SupabaseClient,
  listingType: MarketListingType,
  listingId: string,
): Promise<boolean> {
  if (await ownsMarketListing(supabase, listingType, listingId)) return true;
  const { data, error } = await supabase.rpc("fn_is_admin");
  if (error) throw error;
  return data === true;
}

export function marketKeyForOwnedListing(
  rows: readonly MarketListingRow[],
  ownedListingId: string,
): string | null {
  return rows.find((row) => row.owned_listing_id === ownedListingId)?.listing_key ?? null;
}
