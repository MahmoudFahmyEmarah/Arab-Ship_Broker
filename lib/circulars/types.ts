// Types for the AI circular parser output.

export type CircularKind = "cargo" | "vessel" | "unknown";

export interface ParsedCargo {
  cargo_type?: "Dry Bulk" | "Break Bulk";
  commodity_name?: string;
  qty_min_mt?: number;
  qty_max_mt?: number;
  load_port_locode?: string;
  load_port_name?: string;
  disch_port_locode?: string;
  disch_port_name?: string;
  laycan_from?: string | null;
  laycan_to?: string | null;
  is_spot?: boolean;
  load_rate?: string;
  disch_rate?: string;
  load_terms?: string;
  laytime_qualifier?: string;
  freight_idea_usd_mt?: number;
  commission_pct?: number;
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
  gross_tonnage?: number; // GT — strongly recommended (Q88 / tonnage certificate)
  scnrt?: number; // Suez Canal Net Registered Tonnage — strongly recommended
  build_year?: number;
  flag?: string;
  max_loa_m?: number;
  max_draft_m?: number;
  is_geared?: boolean;
  crane_count?: number;
  crane_swl_mt?: number;
  grain_cbm?: number;
  open_port_locode?: string;
  open_port_name?: string;
  open_zone?: string;
  open_date?: string | null;
  is_spot?: boolean;
  open_date_range_days?: number;
  last_cargo?: string;
  vlsfo_sea_mt_day?: number;
  lsmgo_sea_mt_day?: number;
  service_speed_kn?: number;
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
