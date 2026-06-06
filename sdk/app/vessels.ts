import { SupabaseClient } from "@supabase/supabase-js";
import {
  VesselRow,
  VesselAvailabilityRow,
  VesselAvailabilityWithVessel,
  VesselMatchResult,
  AvailabilityFormValues,
  VesselCreateValues,
  MyVesselRow,
} from "@/lib/schemas/vessel";

const VESSEL_BROKER_FIELDS = [
  "id",
  "vessel_name",
  "imo_number",
  "vessel_type",
  "dwt_grain",
  "dwt_bale",
  "grain_cbm",
  "bale_cbm",
  "build_year",
  "flag",
  "flag_category",
  "scope",
  "risk_level",
  "preferred_zones",
  "is_geared",
  "grain_certified",
  "dg_certified",
  "max_loa_m",
  "max_draft_m",
  "is_sanctioned",
  "vessel_review_status",
  // Counterparty PII (owner_company, owner_country, manager_company, …) is
  // intentionally NOT selected here — it is locked at the DB layer and only
  // readable by the vessel's own owner (via v_vessel_detail) or admin.
  "notes",
].join(", ");

export async function searchVessels(
  supabase: SupabaseClient,
  query: string,
): Promise<VesselRow[]> {
  if (!query || query.trim().length < 2) return [];

  const { data, error } = await supabase
    .from("vessels")
    .select(VESSEL_BROKER_FIELDS)
    .or(
      `vessel_name.ilike.%${query.trim()}%,imo_number.ilike.%${query.trim()}%`,
    )
    .eq("is_sanctioned", false)
    .order("vessel_name")
    .limit(10);

  if (error) throw error;
  return (data ?? []) as unknown as VesselRow[];
}

export async function getVesselById(
  supabase: SupabaseClient,
  id: string,
): Promise<VesselRow | null> {
  const { data, error } = await supabase
    .from("vessels")
    .select(VESSEL_BROKER_FIELDS)
    .eq("id", id)
    .eq("is_sanctioned", false)
    .single();

  if (error) return null;
  return data as unknown as VesselRow;
}

export async function getClaimedVesselById(
  supabase: SupabaseClient,
  vesselId: string,
): Promise<VesselRow | null> {
  const { data: claim, error } = await supabase
    .from("vessel_claims")
    .select("id")
    .eq("vessel_id", vesselId)
    .maybeSingle();

  if (error || !claim) return null;
  return getVesselById(supabase, vesselId);
}

export async function submitVesselAvailability(
  supabase: SupabaseClient,
  payload: AvailabilityFormValues,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .rpc("create_vessel_availability", {
      payload: {
        vessel_id: payload.vessel_id,
        open_port_locode: payload.open_port_locode,
        ballast_port_locode: payload.ballast_port_locode ?? null,
        open_date: payload.open_date,
        open_date_range_days: payload.open_date_range_days ?? 7,
        last_cargo: payload.last_cargo ?? null,
        service_speed_kn: payload.service_speed_kn ?? null,
        me_consumption_mt_day: payload.me_consumption_mt_day ?? null,
        me_consumption_port_mt_day: payload.me_consumption_port_mt_day ?? null,
        aux_consumption_mt_day: payload.aux_consumption_mt_day ?? null,
        aux_consumption_port_mt_day:
          payload.aux_consumption_port_mt_day ?? null,
        fuel_type: payload.fuel_type ?? null,
        accepts_part_cargo: payload.accepts_part_cargo ?? false,
        notes: payload.notes ?? null,
      },
    })
    .single();

  if (error) throw error;
  return { id: (data as VesselAvailabilityRow).id };
}

export async function updateVesselAvailability(
  supabase: SupabaseClient,
  id: string,
  payload: Partial<AvailabilityFormValues>,
): Promise<VesselAvailabilityRow> {
  const dbPayload: Record<string, unknown> = {};

  if (payload.open_port_locode !== undefined)
    dbPayload.open_port_locode = payload.open_port_locode;
  if (payload.ballast_port_locode !== undefined)
    dbPayload.ballast_port_locode = payload.ballast_port_locode || null;
  if (payload.open_date !== undefined) dbPayload.open_date = payload.open_date;
  if (payload.open_date_range_days !== undefined)
    dbPayload.open_date_range_days = payload.open_date_range_days;
  if (payload.last_cargo !== undefined)
    dbPayload.last_cargo = payload.last_cargo || null;
  if (payload.service_speed_kn !== undefined)
    dbPayload.service_speed_kn = payload.service_speed_kn;
  if (payload.me_consumption_mt_day !== undefined)
    dbPayload.me_consumption_mt_day = payload.me_consumption_mt_day;
  if (payload.me_consumption_port_mt_day !== undefined)
    dbPayload.me_consumption_port_mt_day = payload.me_consumption_port_mt_day;
  if (payload.aux_consumption_mt_day !== undefined)
    dbPayload.aux_consumption_mt_day = payload.aux_consumption_mt_day;
  if (payload.aux_consumption_port_mt_day !== undefined)
    dbPayload.aux_consumption_port_mt_day = payload.aux_consumption_port_mt_day;
  if (payload.fuel_type !== undefined)
    dbPayload.fuel_type = payload.fuel_type || null;
  if (payload.accepts_part_cargo !== undefined)
    dbPayload.accepts_part_cargo = payload.accepts_part_cargo;
  if (payload.notes !== undefined) dbPayload.notes = payload.notes || null;

  const { data, error } = await supabase
    .from("vessel_availability")
    .update(dbPayload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as VesselAvailabilityRow;
}

export async function setAvailabilityStatus(
  supabase: SupabaseClient,
  id: string,
  status: "OPEN" | "ON SUBS" | "FIXED" | "INACTIVE",
): Promise<void> {
  const { error } = await supabase
    .from("vessel_availability")
    .update({ status })
    .eq("id", id);

  if (error) throw error;
}

export async function getMyVesselAvailability(
  supabase: SupabaseClient,
): Promise<VesselAvailabilityWithVessel[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: ownership, error: ownershipError } = await supabase
    .from("listing_ownership")
    .select("listing_id")
    .eq("owner_user_id", user.id)
    .eq("listing_type", "vessel_availability")
    .eq("is_current", true)
    .eq("role", "primary");

  if (ownershipError) throw ownershipError;
  if (!ownership?.length) return [];

  const ids = ownership.map((o: { listing_id: string }) => o.listing_id);

  const { data, error } = await supabase
    .from("vessel_availability")
    .select(
      `*,
       vessel:vessels (
         vessel_name, imo_number, vessel_type, dwt_grain,
         grain_cbm, bale_cbm,
         build_year, flag, risk_level, is_sanctioned,
         is_geared, grain_certified, dg_certified, max_draft_m,
         preferred_zones
       )`,
    )
    .in("id", ids)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as VesselAvailabilityWithVessel[];
}

export async function getAvailabilityById(
  supabase: SupabaseClient,
  id: string,
): Promise<VesselAvailabilityWithVessel | null> {
  const { data, error } = await supabase
    .from("vessel_availability")
    .select(
      `*,
       vessel:vessels (
         vessel_name, imo_number, vessel_type, dwt_grain, dwt_bale,
         grain_cbm, bale_cbm,
         build_year, flag, flag_category, scope, risk_level,
         is_geared, grain_certified, dg_certified,
         max_loa_m, max_draft_m, is_sanctioned,
         preferred_zones
       )`,
    )
    .eq("id", id)
    .single();

  if (error) return null;
  return data as VesselAvailabilityWithVessel;
}

export async function getMatchesForAvailability(
  supabase: SupabaseClient,
  availabilityId: string,
): Promise<VesselMatchResult[]> {
  const { data, error } = await supabase.rpc("get_matches_for_availability", {
    p_availability_id: availabilityId,
  });

  if (error) throw error;
  return (data ?? []) as VesselMatchResult[];
}

export async function getOpenVesselAvailability(
  supabase: SupabaseClient,
  options: {
    archiveCutoff?: string | null;
    zone?: string | null;
    limit?: number;
  } = {},
): Promise<VesselAvailabilityWithVessel[]> {
  let qb = supabase
    .from("vessel_availability")
    .select(
      `*,
       vessel:vessels (
         vessel_name, imo_number, vessel_type, dwt_grain,
         grain_cbm, bale_cbm,
         build_year, flag, risk_level, is_sanctioned,
         is_geared, grain_certified, dg_certified, max_draft_m,
         preferred_zones
       )`,
    )
    .eq("status", "OPEN")
    .eq("review_status", "APPROVED");

  if (options.zone) qb = qb.eq("open_zone", options.zone);

  if (options.archiveCutoff) {
    qb = qb.or(
      [`open_date.is.null`, `open_date.gte.${options.archiveCutoff}`].join(
        ",",
      ),
    );
  }

  qb = qb
    .order("open_date", { ascending: true, nullsFirst: false })
    .limit(options.limit ?? 200);

  const { data, error } = await qb;
  if (error) throw error;
  return (data ?? []) as VesselAvailabilityWithVessel[];
}

export async function createVessel(
  supabase: SupabaseClient,
  values: VesselCreateValues,
): Promise<{ id: string }> {
  const payload: Record<string, unknown> = {
    vessel_name: values.vessel_name,
    imo_number: values.imo_number ?? "",
    vessel_type: values.vessel_type,
    dwt_grain: values.dwt_grain ?? "",
    dwt_bale: values.dwt_bale ?? "",
    grain_cbm: values.grain_cbm ?? "",
    bale_cbm: values.bale_cbm ?? "",
    gross_tonnage: values.gross_tonnage ?? "",
    scnrt: values.scnrt ?? "",
    build_year: values.build_year ?? "",
    flag: values.flag ?? "",
    flag_category: values.flag_category ?? "",
    is_geared: values.is_geared === undefined ? "" : String(values.is_geared),
    crane_count: values.crane_count ?? "",
    crane_swl_mt: values.crane_swl_mt ?? "",
    grain_certified:
      values.grain_certified === undefined
        ? ""
        : String(values.grain_certified),
    dg_certified:
      values.dg_certified === undefined ? "" : String(values.dg_certified),
    max_loa_m: values.max_loa_m ?? "",
    max_draft_m: values.max_draft_m ?? "",
    pi_club: values.pi_club ?? "",
    owner_company: values.owner_company ?? "",
    owner_country: values.owner_country ?? "",
    manager_company: values.manager_company ?? "",
    manager_country: values.manager_country ?? "",
    commercial_manager_company: values.commercial_manager_company ?? "",
    commercial_manager_country: values.commercial_manager_country ?? "",
    commercial_manager_contact: values.commercial_manager_contact ?? "",
    commercial_manager_email: values.commercial_manager_email ?? "",
    commercial_manager_phone: values.commercial_manager_phone ?? "",
    charter_status: values.charter_status ?? "",
    tc_charterer_name: values.tc_charterer_name ?? "",
    tc_expiry: values.tc_expiry ?? "",
    bbc_charterer_name: values.bbc_charterer_name ?? "",
    bbc_expiry: values.bbc_expiry ?? "",
    pi_ig_member:
      values.pi_ig_member === undefined ? null : values.pi_ig_member,
    pi_coverage_types: values.pi_coverage_types ?? [],
    war_risk_trading: values.war_risk_trading ?? "",
    war_risk_conditions: values.war_risk_conditions ?? "",
    preferred_trading_areas: values.preferred_trading_areas ?? [],
    preferred_zones: values.preferred_zones ?? [],
    persons_in_charge: values.persons_in_charge ?? [],
    notes: values.notes ?? "",
  };

  const { data, error } = await supabase
    .rpc("register_vessel", { payload })
    .single();

  if (error) throw error;
  return { id: data as string };
}

export async function getMyVessels(
  supabase: SupabaseClient,
): Promise<MyVesselRow[]> {
  const { data, error } = await supabase
    .from("v_my_vessels")
    .select("*")
    .order("claimed_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as MyVesselRow[];
}

export async function getVesselWithClaimStatus(
  supabase: SupabaseClient,
  vesselId: string,
): Promise<{ vessel: VesselRow | null; isClaimed: boolean }> {
  const [vesselResult, claimResult] = await Promise.all([
    // Masked view: counterparty PII is NULL unless viewer is admin/owner.
    supabase
      .from("v_vessel_detail")
      .select(
        [
          "id",
          "vessel_name",
          "imo_number",
          "vessel_type",
          "dwt_grain",
          "dwt_bale",
          "grain_cbm",
          "bale_cbm",
          "build_year",
          "flag",
          "flag_category",
          "scope",
          "risk_level",
          "risk_notes",
          "preferred_zones",
          "is_geared",
          "crane_count",
          "crane_swl_mt",
          "grain_certified",
          "dg_certified",
          "max_loa_m",
          "max_draft_m",
          "pi_club",
          "is_sanctioned",
          "owner_company",
          "owner_country",
          "manager_company",
          "manager_country",
          "notes",
          "created_at",
          "updated_at",
        ].join(", "),
      )
      .eq("id", vesselId)
      .eq("is_sanctioned", false)
      .single(),

    supabase
      .from("vessel_claims")
      .select("id")
      .eq("vessel_id", vesselId)
      .maybeSingle(),
  ]);

  return {
    vessel: vesselResult.error
      ? null
      : (vesselResult.data as unknown as VesselRow),
    isClaimed: !!claimResult.data,
  };
}
