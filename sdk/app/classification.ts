import { SupabaseClient } from "@supabase/supabase-js";

// Server-side cargo-classification engine wrappers (resolver + guard RPCs).
// The form calls resolveCargoClassification for auto-fill, and submits through
// the guard (also enforced by the cargo_parcels trigger, so a crafted request
// can't bypass it). Data-driven from commodity_map / imsbc_codes / css_categories.

export type CargoRegime = "GRAIN" | "IMSBC" | "CSS" | "UNMAPPED";

export interface ClassificationResult {
  regime: CargoRegime;
  code: string | null;
  group_or_category: string | null;
  plausible_regimes: string[];
  is_dual_form: boolean;
  mapped: boolean;
  note?: string | null;
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
  unmapped?: boolean;
}

/** Resolve market_name (+ form/grain) → regime + code + plausible set. */
export async function resolveCargoClassification(
  supabase: SupabaseClient,
  marketName: string,
  isBulk: boolean,
  isGrain: boolean | null = null,
): Promise<ClassificationResult> {
  const { data, error } = await supabase.rpc("resolve_cargo_classification", {
    p_market_name: marketName,
    p_is_bulk: isBulk,
    p_is_grain: isGrain,
  });
  if (error) throw error;
  return data as ClassificationResult;
}

/** Server-side guard: is (regime, code) plausible for this market_name? */
export async function validateCargoClassification(
  supabase: SupabaseClient,
  marketName: string,
  regime: CargoRegime,
  code: string | null = null,
): Promise<GuardResult> {
  const { data, error } = await supabase.rpc("validate_cargo_classification", {
    p_market_name: marketName,
    p_regime: regime,
    p_code: code,
  });
  if (error) throw error;
  return data as GuardResult;
}
