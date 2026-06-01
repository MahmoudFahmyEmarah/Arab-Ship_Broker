import { SupabaseClient } from "@supabase/supabase-js";

import {
  CommodityOption,
  SafetyQuestion,
  CargoType,
  ImsbcCategory,
} from "@/lib/schemas/cargo";

export async function searchCommodities(
  supabase: SupabaseClient,
  query: string,
): Promise<CommodityOption[]> {
  if (!query || query.trim().length < 2) return [];

  const q = query.trim();

  const [byName, byAlias] = await Promise.all([
    supabase
      .from("commodities")
      .select(
        "id, canonical_name, cargo_type, imsbc_category, is_dg, is_grain, default_sf_m3t",
      )
      .eq("is_active", true)
      .ilike("canonical_name", `%${q}%`)
      .order("sort_order")
      .limit(10),

    supabase
      .from("commodities")
      .select(
        "id, canonical_name, cargo_type, imsbc_category, is_dg, is_grain, default_sf_m3t",
      )
      .eq("is_active", true)
      .filter("display_aliases", "cs", `{${q}}`)
      .order("sort_order")
      .limit(10),
  ]);

  const nameResults = (byName.data ?? []) as CommodityOption[];
  const aliasResults = (byAlias.data ?? []) as CommodityOption[];

  const seen = new Set(nameResults.map((c) => c.id));
  const combined = [
    ...nameResults,
    ...aliasResults.filter((c) => !seen.has(c.id)),
  ];

  return combined.slice(0, 10);
}

export async function getCommodityById(
  supabase: SupabaseClient,
  id: string,
): Promise<CommodityOption | null> {
  const { data, error } = await supabase
    .from("commodities")
    .select(
      "id, canonical_name, cargo_type, imsbc_category, is_dg, is_grain, default_sf_m3t",
    )
    .eq("id", id)
    .single();

  if (error) return null;
  return data as CommodityOption;
}

export async function getSafetyQuestions(
  supabase: SupabaseClient,
  cargoType: CargoType,
  imsbcCategory: ImsbcCategory,
): Promise<SafetyQuestion[]> {
  const { data, error } = await supabase
    .from("safety_questions")
    .select(
      "id, question_key, question_text, answer_type, select_options, is_required, is_matchmaking_field, matchmaking_column, section_label, help_text, sort_order",
    )
    .eq("is_active", true)
    .or(`applies_to_cargo_type.is.null,applies_to_cargo_type.cs.{${cargoType}}`)
    .contains("applies_to_categories", [imsbcCategory])
    .order("sort_order");

  if (error) throw error;
  return (data ?? []) as SafetyQuestion[];
}
