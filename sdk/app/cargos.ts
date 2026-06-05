import { SupabaseClient } from "@supabase/supabase-js";
import {
  CargoFormValues,
  CargoListingRow,
  CargoListingFilters,
  sfToFt3Lt,
} from "@/lib/schemas/cargo";

export async function submitCargo(
  supabase: SupabaseClient,
  payload: CargoFormValues,
): Promise<{ id: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in to post a cargo listing.");

  const sfInFt3Lt =
    payload.stowage_factor !== undefined
      ? sfToFt3Lt(
          payload.stowage_factor,
          payload.stowage_factor_unit ?? "ft3_lt",
        )
      : null;

  const { data: cargo, error: cargoError } = await supabase
    .rpc("create_cargo_listing", {
      payload: {
        commodity_id: payload.commodity_id,
        commodity_name: payload.commodity_name,
        cargo_type: payload.cargo_type,
        is_dg_cargo: payload.is_dg_cargo,
        is_grain_cargo: payload.is_grain_cargo,
        packaging_type: payload.packaging_type ?? null,
        css_category: payload.css_category ?? null,
        qty_min_mt: payload.qty_min_mt,
        qty_max_mt: payload.qty_max_mt,
        stowage_factor: sfInFt3Lt ?? null,
        volume_cbm: payload.volume_cbm ?? null,
        load_port_locode: payload.load_port_locode,
        disch_port_locode: payload.disch_port_locode,
        laycan_from: payload.laycan_from || null,
        laycan_to: payload.laycan_to || null,
        load_rate: payload.load_rate ?? null,
        disch_rate: payload.disch_rate ?? null,
        load_terms: payload.load_terms ?? null,
        tolerance_pct: payload.tolerance_pct ?? null,
        tolerance_holder: payload.tolerance_holder ?? null,
        laytime_basis: payload.laytime_basis ?? null,
        laytime_structure: payload.laytime_structure || null,
        freight_idea_usd_mt: payload.freight_idea_usd_mt ?? null,
        commission_pct: payload.commission_pct ?? null,
        commission_ttl_pct: payload.commission_ttl_pct ?? null,
        demurrage_rate: payload.demurrage_rate ?? null,
        despatch_rate: payload.despatch_rate ?? null,
        broker: payload.broker || null,
        notes: payload.notes || null,
      },
    })
    .single();

  if (cargoError) throw cargoError;
  const typedCargo = cargo as CargoListingRow;

  const answers = payload.safety_answers ?? {};
  const answerRows = Object.entries(answers)
    .filter(([, value]) => value !== "" && value !== undefined)
    .map(([question_key, answer_value]) => ({
      cargo_listing_id: typedCargo.id,
      question_key,
      answer_value: String(answer_value),
      answered_by: user.id,
    }));

  if (answerRows.length > 0) {
    const { error: answersError } = await supabase
      .from("cargo_safety_answers")
      .insert(answerRows);
    if (answersError)
      console.error("Safety answers insert failed:", answersError.message);
  }

  return { id: typedCargo.id };
}

export async function updateCargo(
  supabase: SupabaseClient,
  id: string,
  payload: Partial<CargoFormValues>,
): Promise<CargoListingRow> {
  const dbPayload: Record<string, unknown> = {};

  if (payload.qty_min_mt !== undefined)
    dbPayload.qty_min_mt = payload.qty_min_mt;
  if (payload.qty_max_mt !== undefined)
    dbPayload.qty_max_mt = payload.qty_max_mt;

  if (payload.stowage_factor !== undefined) {
    dbPayload.stowage_factor =
      payload.stowage_factor !== undefined
        ? sfToFt3Lt(
            payload.stowage_factor,
            payload.stowage_factor_unit ?? "ft3_lt",
          )
        : null;
  }

  if (payload.volume_cbm !== undefined)
    dbPayload.volume_cbm = payload.volume_cbm ?? null;
  if (payload.load_port_locode !== undefined)
    dbPayload.load_port_locode = payload.load_port_locode;
  if (payload.disch_port_locode !== undefined)
    dbPayload.disch_port_locode = payload.disch_port_locode;
  if (payload.laycan_from !== undefined)
    dbPayload.laycan_from = payload.laycan_from || null;
  if (payload.laycan_to !== undefined)
    dbPayload.laycan_to = payload.laycan_to || null;
  if (payload.load_rate !== undefined)
    dbPayload.load_rate = payload.load_rate ?? null;
  if (payload.disch_rate !== undefined)
    dbPayload.disch_rate = payload.disch_rate ?? null;
  if (payload.load_terms !== undefined)
    dbPayload.load_terms = payload.load_terms ?? null;
  if (payload.laytime_basis !== undefined)
    dbPayload.laytime_basis = payload.laytime_basis ?? null;
  if (payload.freight_idea_usd_mt !== undefined)
    dbPayload.freight_idea_usd_mt = payload.freight_idea_usd_mt;
  if (payload.commission_pct !== undefined)
    dbPayload.commission_pct = payload.commission_pct;
  if (payload.commission_ttl_pct !== undefined)
    dbPayload.commission_ttl_pct = payload.commission_ttl_pct ?? null;
  if (payload.demurrage_rate !== undefined)
    dbPayload.demurrage_rate = payload.demurrage_rate;
  if (payload.despatch_rate !== undefined)
    dbPayload.despatch_rate = payload.despatch_rate ?? null;
  if (payload.broker !== undefined) dbPayload.broker = payload.broker || null;
  if (payload.notes !== undefined) dbPayload.notes = payload.notes || null;

  const { data, error } = await supabase
    .from("cargo_listings")
    .update(dbPayload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  const answers = payload.safety_answers;
  if (answers && Object.keys(answers).length > 0) {
    const nonEmpty = Object.fromEntries(
      Object.entries(answers).filter(([, v]) => v !== "" && v !== undefined),
    );
    if (Object.keys(nonEmpty).length > 0) {
      const { error: saErr } = await supabase.rpc(
        "update_cargo_safety_answers",
        { p_cargo_id: id, p_answers: nonEmpty },
      );
      if (saErr) console.error("Safety answers update failed:", saErr.message);
    }
  }

  return data as CargoListingRow;
}

export async function getCargos(
  supabase: SupabaseClient,
  filters: CargoListingFilters = {},
): Promise<CargoListingRow[]> {
  let qb = supabase
    .from("cargo_listings")
    .select("*")
    .in("status", ["IN", "PARTIAL"])
    .eq("review_status", "APPROVED");

  if (filters.zone) qb = qb.eq("load_zone", filters.zone);
  if (filters.cargo_type) qb = qb.eq("cargo_type", filters.cargo_type);
  if (filters.is_dg_only) qb = qb.eq("is_dg_cargo", true);
  if (filters.min_qty) qb = qb.gte("qty_max_mt", filters.min_qty);
  if (filters.max_qty) qb = qb.lte("qty_min_mt", filters.max_qty);
  if (filters.laycan_from)
    qb = qb.or(`laycan_from.gte.${filters.laycan_from},is_spot.eq.true`);
  if (filters.laycan_to)
    qb = qb.or(`laycan_to.lte.${filters.laycan_to},is_spot.eq.true`);

  if (filters.archiveCutoff) {
    qb = qb.or(
      [
        `is_spot.eq.true`,
        `laycan_from.gte.${filters.archiveCutoff}`,
        `and(laycan_from.is.null,created_at.gte.${filters.archiveCutoff})`,
      ].join(","),
    );
  }

  switch (filters.sort) {
    case "qty_asc":
      qb = qb.order("qty_max_mt", { ascending: true });
      break;
    case "qty_desc":
      qb = qb.order("qty_max_mt", { ascending: false });
      break;
    case "laycan_asc":
      qb = qb.order("laycan_from", { ascending: true, nullsFirst: false });
      break;
    default:
      qb = qb.order("created_at", { ascending: false });
  }

  const { data, error } = await qb;
  if (error) throw error;
  return (data ?? []) as CargoListingRow[];
}

export async function getCargoById(
  supabase: SupabaseClient,
  id: string,
): Promise<CargoListingRow | null> {
  const { data, error } = await supabase
    .from("cargo_listings")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data as CargoListingRow;
}

export async function getMyCargoListings(
  supabase: SupabaseClient,
): Promise<CargoListingRow[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: ownership, error: ownershipError } = await supabase
    .from("listing_ownership")
    .select("listing_id")
    .eq("owner_user_id", user.id)
    .eq("listing_type", "cargo")
    .eq("is_current", true)
    .eq("role", "primary");

  if (ownershipError) throw ownershipError;
  if (!ownership?.length) return [];

  const ids = ownership.map((o) => o.listing_id);
  const { data, error } = await supabase
    .from("cargo_listings")
    .select("*")
    .in("id", ids)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as CargoListingRow[];
}

export async function getCargoSafetyAnswers(
  supabase: SupabaseClient,
  cargoId: string,
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("cargo_safety_answers")
    .select("question_key, answer_value")
    .eq("cargo_listing_id", cargoId);

  if (error || !data) return {};
  return Object.fromEntries(
    data
      .filter((row) => row.answer_value !== null)
      .map((row) => [row.question_key, row.answer_value as string]),
  );
}

export type CargoMatchResult = {
  availability_id: string;
  vessel_ref: string | null;
  vessel_id: string;
  vessel_name: string;
  vessel_type: string;
  dwt_grain: number | null;
  build_year: number | null;
  flag: string | null;
  scope: string;
  risk_level: string;
  is_geared: boolean | null;
  grain_certified: boolean | null;
  dg_certified: boolean | null;
  open_port_name: string;
  open_zone: string;
  open_date: string | null;
  open_date_range_days: number;
  accepts_part_cargo: boolean;
  freight_idea_usd_mt: number | null;
  is_rate_aligned: boolean;
  dwt_delta: number;
};

export async function getMatchesForCargo(
  supabase: SupabaseClient,
  cargoId: string,
): Promise<CargoMatchResult[]> {
  const { data, error } = await supabase.rpc("get_matches_for_cargo", {
    p_cargo_id: cargoId,
  });
  if (error) throw error;
  return (data ?? []) as CargoMatchResult[];
}

/**
 * Persist the owner's circulation choice (In circulation vs Private to ASB)
 * via the ownership-checked set_listing_circulation RPC (migration …000500).
 * Never affects contact visibility — that stays admin/owner-only.
 */
export async function setListingCirculation(
  supabase: SupabaseClient,
  type: "cargo" | "vessel_availability",
  id: string,
  value: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("set_listing_circulation", {
    p_type: type,
    p_id: id,
    p_value: value,
  });
  if (error) throw error;
}
