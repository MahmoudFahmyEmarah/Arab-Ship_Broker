// Types for the AI circular parser output.
//
// ALLOWED_EXTRACT_FIELDS below doubles as the server-side output whitelist:
// the parse route drops every key the model returns that is not listed here,
// so the assistant can never surface arbitrary model output to the client
// (hard guardrail, enforced in code — not just in the prompt).

export type CircularKind = "cargo" | "vessel" | "unknown";

export interface ParsedCargo {
  cargo_type?: "Dry Bulk" | "Break Bulk";
  commodity_name?: string;
  qty_min_mt?: number;
  qty_max_mt?: number;
  tolerance_pct?: number;
  tolerance_holder?: "MOLOO" | "MOLCHOPT" | string;
  volume_cbm?: number;
  packaging_type?: string;
  bag_weight_kg?: number;
  load_port_locode?: string;
  load_port_name?: string;
  disch_port_locode?: string;
  disch_port_name?: string;
  laycan_from?: string | null;
  laycan_to?: string | null;
  is_spot?: boolean;
  load_rate?: string;
  disch_rate?: string;
  rate_mechanism?: string;
  day_exceptions?: string;
  turn_time_hrs?: number;
  laytime_reversible?: string;
  load_terms?: string;
  laytime_qualifier?: string;
  nor_clause?: string;
  freight_idea_usd_mt?: number;
  freight_basis?: string;
  despatch_basis?: string;
  commission_pct?: number;
  commission_ttl_pct?: number;
  iac_flag?: boolean;
  is_wog?: boolean;
  is_grain_cargo?: boolean;
  is_dg_cargo?: boolean;
  stowage_factor?: number;
  max_vessel_age_yr?: number;
  max_loa_m?: number;
  max_draft_m?: number;
  requires_geared?: boolean;
  notes?: string;
}

export interface ParsedVessel {
  vessel_name?: string;
  imo_number?: string;
  vessel_type?: "General Cargo" | "Bulk Carrier" | "Other";
  dwt_grain?: number;
  dwcc?: number;
  gross_tonnage?: number; // GT — strongly recommended (Q88 §1.36)
  scnrt?: number; // Suez Canal Net Tonnage — strongly recommended (Q88 §1.37)
  build_year?: number;
  flag?: string;
  class_society?: string;
  max_loa_m?: number;
  beam_m?: number;
  max_draft_m?: number;
  grain_cbm?: number;
  bale_cbm?: number;
  // cargo arrangement (Q88 §5)
  num_holds?: number;
  num_hatches?: number;
  box_shaped?: boolean;
  hatch_type?: string; // side-rolling | folding | pontoon | lift-away
  strengthened_heavy?: boolean;
  holds_may_be_empty?: string;
  log_fitted?: boolean;
  // gear (Q88 §6)
  is_geared?: boolean;
  crane_count?: number;
  crane_swl_mt?: number;
  num_grabs?: number;
  grab_capacity_mt?: number;
  kick_plate?: boolean;
  // ownership & operation chain (Q88 §1)
  registered_owner?: string;
  parent_group?: string;
  technical_operator?: string;
  commercial_operator?: string;
  disponent_owner?: string;
  charter_type?: string; // V/C | TCT | T/C short | T/C long | Bareboat
  // position
  open_port_locode?: string;
  open_port_name?: string;
  open_zone?: string;
  open_date?: string | null;
  is_spot?: boolean;
  open_date_range_days?: number;
  last_cargo?: string;
  // performance (Q88 §8)
  service_speed_kn?: number;
  vlsfo_sea_mt_day?: number;
  lsmgo_sea_mt_day?: number;
  me_cons_port_mt_day?: number;
  aux_cons_port_mt_day?: number;
  brob_mt?: number;
  fuel_type?: string;
  scrubber_fitted?: boolean;
  preferred_zones?: string[];
  freight_idea_usd_mt?: number;
  commission_pct?: number;
  notes?: string;
}

export interface CircularParseResult {
  kind: CircularKind;
  confidence: number;
  extracted: ParsedCargo & ParsedVessel;
  warnings: string[];
  raw_intent: string;
}

// ── server-side output whitelist (hard guardrail) ───────────────────────────
export type ExtractFieldKind = "string" | "number" | "boolean" | "string[]";

export const ALLOWED_EXTRACT_FIELDS: Record<string, ExtractFieldKind> = {
  // cargo
  cargo_type: "string",
  commodity_name: "string",
  qty_min_mt: "number",
  qty_max_mt: "number",
  tolerance_pct: "number",
  tolerance_holder: "string",
  volume_cbm: "number",
  packaging_type: "string",
  bag_weight_kg: "number",
  load_port_locode: "string",
  load_port_name: "string",
  disch_port_locode: "string",
  disch_port_name: "string",
  laycan_from: "string",
  laycan_to: "string",
  load_rate: "string",
  disch_rate: "string",
  rate_mechanism: "string",
  day_exceptions: "string",
  turn_time_hrs: "number",
  laytime_reversible: "string",
  load_terms: "string",
  laytime_qualifier: "string",
  nor_clause: "string",
  freight_basis: "string",
  despatch_basis: "string",
  commission_ttl_pct: "number",
  iac_flag: "boolean",
  is_wog: "boolean",
  is_grain_cargo: "boolean",
  is_dg_cargo: "boolean",
  stowage_factor: "number",
  max_vessel_age_yr: "number",
  requires_geared: "boolean",
  // vessel
  vessel_name: "string",
  imo_number: "string",
  vessel_type: "string",
  dwt_grain: "number",
  dwcc: "number",
  gross_tonnage: "number",
  scnrt: "number",
  build_year: "number",
  flag: "string",
  class_society: "string",
  max_loa_m: "number",
  beam_m: "number",
  max_draft_m: "number",
  grain_cbm: "number",
  bale_cbm: "number",
  num_holds: "number",
  num_hatches: "number",
  box_shaped: "boolean",
  hatch_type: "string",
  strengthened_heavy: "boolean",
  holds_may_be_empty: "string",
  log_fitted: "boolean",
  is_geared: "boolean",
  crane_count: "number",
  crane_swl_mt: "number",
  num_grabs: "number",
  grab_capacity_mt: "number",
  kick_plate: "boolean",
  registered_owner: "string",
  parent_group: "string",
  technical_operator: "string",
  commercial_operator: "string",
  disponent_owner: "string",
  charter_type: "string",
  open_port_locode: "string",
  open_port_name: "string",
  open_zone: "string",
  open_date: "string",
  open_date_range_days: "number",
  last_cargo: "string",
  service_speed_kn: "number",
  vlsfo_sea_mt_day: "number",
  lsmgo_sea_mt_day: "number",
  me_cons_port_mt_day: "number",
  aux_cons_port_mt_day: "number",
  brob_mt: "number",
  fuel_type: "string",
  scrubber_fitted: "boolean",
  preferred_zones: "string[]",
  // shared
  is_spot: "boolean",
  freight_idea_usd_mt: "number",
  commission_pct: "number",
  notes: "string",
};

/** Fixed off-topic marker — the prompt instructs it AND the route enforces it. */
export const OFF_TOPIC_WARNING =
  "OFF_TOPIC: I only read maritime chartering content — cargo circulars, vessel position lists and Q88 questionnaires.";
