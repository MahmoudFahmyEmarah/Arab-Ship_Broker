import { SupabaseClient } from "@supabase/supabase-js";
import { PortOption } from "@/lib/schemas/cargo";
import { searchPorts } from "@/sdk/app/ports";

// SDK for the Broker Ledger posting flows (Concept 4).
// Reads go through the reference tables / registry seeded from the UNIFIED
// workbook; writes go through the v2 RPCs (create_cargo_listing_v2,
// create_vessel_position). The v1 SDK (cargos.ts / vessels.ts) keeps serving
// the legacy pages until sign-off.

// ── commodity search + classification ───────────────────────────────────────

export interface CommodityNameHit {
  display_name: string;
  source: "market" | "grain" | "imsbc" | "css" | "commodity";
  regime: "GRAIN" | "IMSBC" | "CSS" | "UNMAPPED";
  group_or_cat: string | null;
  form: "dry-bulk" | "break-bulk";
}

export async function searchCommodityNames(
  supabase: SupabaseClient,
  query: string,
  limit = 25,
): Promise<CommodityNameHit[]> {
  if (!query || query.trim().length < 2) return [];
  const { data, error } = await supabase.rpc("search_commodity_names", {
    p_q: query.trim(),
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as CommodityNameHit[];
}

export interface ClassificationReadout {
  matched: boolean;
  regime?: "GRAIN" | "IMSBC" | "CSS" | "UNMAPPED";
  official_name?: string | null;
  market_name?: string | null;
  group_or_cat?: string | null;
  css_category?: string | null;
  un_number?: string | null;
  is_dg?: boolean;
  is_mhb?: boolean;
  liquefaction?: boolean;
  is_grain?: boolean;
  is_break_bulk?: boolean;
  note?: string | null;
}

export type ClassifyResult = { gated: true } | { gated: false; readout: ClassificationReadout };

/** Live classification readout — Subscriber (T3/T4) feature, gated in the DB. */
export async function classifyCommodity(supabase: SupabaseClient, name: string): Promise<ClassifyResult> {
  const { data, error } = await supabase.rpc("classify_commodity", { p_name: name });
  if (error) {
    if (/TIER_GATED/i.test(error.message ?? "")) return { gated: true };
    throw error;
  }
  return { gated: false, readout: (data ?? { matched: false }) as ClassificationReadout };
}

// ── port search (curated table + full UN/LOCODE reference, merged) ──────────

// Deactivated curated rows are retired codes (old codes / legacy spaced
// duplicates, see migration 20260725120000). The UN/LOCODE backstop still
// contains some of them, so suppress backstop hits matching a retired code —
// otherwise the dedupe would resurface through the reference tier.
let retiredCache: { at: number; codes: Set<string> } | null = null;
async function retiredPortCodes(supabase: SupabaseClient): Promise<Set<string>> {
  if (retiredCache && Date.now() - retiredCache.at < 5 * 60_000) return retiredCache.codes;
  try {
    const { data } = await supabase.from("ports").select("locode").eq("is_active", false).limit(500);
    const codes = new Set((data ?? []).map((r: { locode: string }) => r.locode.replace(/\s+/g, "").toUpperCase()));
    retiredCache = { at: Date.now(), codes };
    return codes;
  } catch {
    return retiredCache?.codes ?? new Set();
  }
}

export async function searchLedgerPorts(supabase: SupabaseClient, query: string): Promise<PortOption[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const [tableRes, refRes, retired] = await Promise.all([
    searchPorts(supabase, q).catch(() => [] as PortOption[]),
    fetch(`/api/ports/search?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((d) => (d.results ?? []) as PortOption[])
      .catch(() => [] as PortOption[]),
    retiredPortCodes(supabase),
  ]);
  const norm = (l: string) => l.replace(/\s+/g, "").toUpperCase();
  const seen = new Set(tableRes.map((p) => norm(p.locode)));
  return [...tableRes, ...refRes.filter((p) => !seen.has(norm(p.locode)) && !retired.has(norm(p.locode)))].slice(0, 8);
}

// ── vessel registry search ───────────────────────────────────────────────────

export interface VesselRegistryHit {
  id: string;
  imo_number: string | null;
  vessel_name: string;
  vessel_type: string;
  dwt_grain: number | null;
  build_year: number | null;
  flag: string | null;
  gross_tonnage: number | null;
  max_loa_m: number | null;
  beam_m: number | null;
  max_draft_m: number | null;
  class_society: string | null;
  is_verified: boolean | null;
  vessel_config: string | null;
  num_holds: number | null;
  num_hatches: number | null;
  box_shaped: boolean | null;
  hatch_type: string | null;
  strengthened_heavy: boolean | null;
  holds_may_be_empty: string | null;
  log_fitted: boolean | null;
  is_geared: boolean | null;
  crane_count: number | null;
  crane_swl_mt: number | null;
  registered_owner: string | null;
  parent_group: string | null;
  technical_operator: string | null;
  disponent_owner: string | null;
  source_tag: string | null;
}

const VESSEL_REGISTRY_COLUMNS =
  "id, imo_number, vessel_name, vessel_type, dwt_grain, build_year, flag, gross_tonnage, max_loa_m, beam_m, max_draft_m, class_society, is_verified, vessel_config, num_holds, num_hatches, box_shaped, hatch_type, strengthened_heavy, holds_may_be_empty, log_fitted, is_geared, crane_count, crane_swl_mt, registered_owner, parent_group, technical_operator, disponent_owner, source_tag";

export async function getVesselRegistryById(supabase: SupabaseClient, vesselId: string): Promise<VesselRegistryHit | null> {
  const { data, error } = await supabase
    .from("vessels")
    .select(VESSEL_REGISTRY_COLUMNS)
    .eq("id", vesselId)
    .eq("is_sanctioned", false)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as VesselRegistryHit) ?? null;
}

export async function searchVesselRegistry(supabase: SupabaseClient, query: string): Promise<VesselRegistryHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase
    .from("vessels")
    .select(VESSEL_REGISTRY_COLUMNS)
    .or(`vessel_name.ilike.%${q}%,imo_number.ilike.%${q}%`)
    .eq("is_sanctioned", false)
    .eq("is_tbn", false)
    .order("vessel_name")
    .limit(40);
  if (error) throw error;
  return (data ?? []) as unknown as VesselRegistryHit[];
}

// ── company registry (03_COMPANIES, tier-gated profile) ──────────────────────

export interface CompanyHit {
  id: string;
  name: string;
  country: string | null;
  imo: string | null;
  fleet_total: number | null;
  owns_count: number | null;
  manages_comm_count: number | null;
  ism_manages_count: number | null;
}

export async function searchCompanies(supabase: SupabaseClient, query: string, limit = 25): Promise<CompanyHit[]> {
  if (!query || query.trim().length < 2) return [];
  const { data, error } = await supabase.rpc("search_companies", { p_q: query.trim(), p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CompanyHit[];
}

export interface CompanyProfile extends CompanyHit {
  gated: boolean;
  address?: string | null;
  desk_contact_name?: string | null;
  desk_email?: string | null;
  desk_phone?: string | null;
  linked_to_imo?: string | null;
  link_note?: string | null;
  link_type?: string | null;
}

export async function getCompanyProfile(supabase: SupabaseClient, orgId: string): Promise<CompanyProfile> {
  const { data, error } = await supabase.rpc("get_company_profile", { p_org_id: orgId });
  if (error) throw error;
  return data as CompanyProfile;
}

// ── submissions (v2 RPCs) ────────────────────────────────────────────────────

export interface CargoLedgerPayload {
  commodity_name: string;
  cargo_type: "Dry Bulk" | "Break Bulk";
  qty_mt: number;
  tolerance_pct?: number | null;
  tolerance_holder?: string | null;
  volume_cbm: number;
  packaging_type?: string | null;
  load_port_locode: string;
  disch_port_locode: string;
  load_rate?: string | null;
  disch_rate?: string | null;
  rate_mechanism?: string | null;
  day_exceptions?: string | null;
  turn_time_hrs?: number | null;
  laytime_reversible?: string | null;
  laycan_from: string;
  laycan_to?: string | null;
  is_spot?: boolean;
  nor_clause?: string | null;
  freight_idea_usd_mt?: number | null;
  freight_basis?: string | null;
  despatch_basis?: string | null;
  commission_ttl_pct?: number | null;
  iac_flag?: boolean;
  notes?: string | null;
}

export async function submitCargoLedgerRpc(supabase: SupabaseClient, payload: CargoLedgerPayload) {
  const { data, error } = await supabase.rpc("create_cargo_listing_v2", { payload });
  if (error) throw new Error(friendlyRpcError(error.message));
  return data;
}

export interface VesselPositionPayload {
  entry_mode: "fleet" | "new" | "tbn";
  vessel_id?: string | null;
  /** Fleet mode: fills vessels.dwt_grain when the record has none. */
  dwt_backfill_mt?: number | null;
  vessel?: {
    imo: string;
    name: string;
    type: string;
    dwt?: string | number | null;
    built?: string | number | null;
    flag?: string | null;
    loa_m?: string | number | null;
    grt?: string | number | null;
    class_society?: string | null;
  } | null;
  tbn?: {
    type: string;
    dwt: string | number;
    flag: string;
    built?: string | number | null;
    loa_m?: string | number | null;
    beam_m?: string | number | null;
    draft_m?: string | number | null;
    grt?: string | number | null;
    class_society?: string | null;
  } | null;
  ownership?: {
    registered_owner?: string | null;
    parent_group?: string | null;
    technical_operator?: string | null;
    commercial_operator?: string | null;
    disponent_owner?: string | null;
  } | null;
  arrangement?: {
    _source?: string;
    config?: string | null;
    num_holds?: string | number | null;
    num_hatches?: string | number | null;
    box_shaped?: boolean | null;
    hatch_type?: string | null;
    strengthened_heavy?: boolean | null;
    holds_may_be_empty?: string | null;
    log_fitted?: boolean | null;
  } | null;
  availability: {
    status: string;
    charter_type?: string | null;
    open_port_locode: string;
    open_from: string;
    trading_zones?: string[];
    next_direction?: string | null;
    wog?: boolean;
  };
  performance?: {
    service_speed_kn?: string | number | null;
    fuel_type?: string | null;
    me_cons_sea?: string | number | null;
    me_cons_port?: string | number | null;
    aux_cons_port?: string | number | null;
    brob_mt?: string | number | null;
    scrubber?: boolean;
    eca?: boolean;
  } | null;
  gear?: {
    _source?: string;
    geared?: boolean | null;
    crane_count?: string | number | null;
    crane_swl?: string | number | null;
    num_grabs?: string | number | null;
    grab_capacity?: string | number | null;
    kick_plate?: boolean;
  } | null;
  notes?: string | null;
}

export interface VesselPositionResult {
  vessel_id: string;
  availability_id: string;
  ref: string | null;
  review_status: string;
}

export async function submitVesselPositionRpc(
  supabase: SupabaseClient,
  payload: VesselPositionPayload,
): Promise<VesselPositionResult> {
  const { data, error } = await supabase.rpc("create_vessel_position", { payload });
  if (error) throw new Error(friendlyRpcError(error.message));
  return data as VesselPositionResult;
}

/** Strip Postgres error prefixes and surface the business message. */
function friendlyRpcError(message: string | undefined): string {
  if (!message) return "Posting failed — please try again.";
  return message.replace(/^SIZE_GATE:\s*/, "").replace(/^TIER_GATED:\s*/, "");
}
