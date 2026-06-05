import { z } from "zod";

export const CARGO_TYPES = ["Dry Bulk", "Break Bulk"] as const;
export type CargoType = (typeof CARGO_TYPES)[number];

export const IMSBC_CATEGORIES = [
  "Cat_A",
  "Cat_B",
  "Cat_C",
  "DG",
  "Non_DG",
] as const;
export type ImsbcCategory = (typeof IMSBC_CATEGORIES)[number];

export const LOAD_TERMS = [
  "FIO",
  "FIOT",
  "FIOST",
  "FIOS",
  "FIOS LSD",
  "Liner Terms",
] as const;
export type LoadTerms = (typeof LOAD_TERMS)[number];

export const NOR_CLAUSES = ["WIBON", "WIPON", "WCCON", "EIU", "EIUU"] as const;
export type NorClause = (typeof NOR_CLAUSES)[number];

export const LAYTIME_BASIS_OPTIONS = [
  "PWWD SHINC",
  "PWWD SHEX",
  "PWWD FHEX",
  "PDPR",
] as const;
export type LaytimeBasis = (typeof LAYTIME_BASIS_OPTIONS)[number];

export const FREIGHT_BASIS_OPTIONS = [
  "Per MT",
  "Per Revenue Tonne",
  "Lumpsum",
  "BSS 1/1",
  "To be agreed",
] as const;
export type FreightBasis = (typeof FREIGHT_BASIS_OPTIONS)[number];

export const DESPATCH_BASIS_OPTIONS = [
  "DHDATSBE",
  "DHWTSBE",
  "FDA",
  "FDATE",
] as const;
export type DespatchBasis = (typeof DESPATCH_BASIS_OPTIONS)[number];

export const DISPORT_STATUS_OPTIONS = [
  "Confirmed",
  "Indicated",
  "TBA",
] as const;
export type DisportStatus = (typeof DISPORT_STATUS_OPTIONS)[number];

export const PACKAGING_TYPES = [
  "Bulk",
  "Bagged",
  "Breakbulk",
  "Containerised",
  "Other",
] as const;
export type PackagingType = (typeof PACKAGING_TYPES)[number];

// Break-bulk packing = the 12 official CSS Code categories (IMO CSS Code annexes),
// from the ArabShipBroker_CSS_BreakBulk sheet. Used when cargo_type = Break Bulk;
// bulk cargo keeps the simple PACKAGING_TYPES above.
export const CSS_CATEGORIES = [
  { id: "CSS-01", label: "Containers on non-cellular ships" },
  { id: "CSS-02", label: "Portable tanks (tank-containers)" },
  { id: "CSS-03", label: "Portable receptacles" },
  { id: "CSS-04", label: "Wheel-based (rolling) cargoes" },
  { id: "CSS-05", label: "Heavy cargo items" },
  { id: "CSS-06", label: "Coiled sheet steel" },
  { id: "CSS-07", label: "Heavy metal products" },
  { id: "CSS-08", label: "Anchor chains" },
  { id: "CSS-09", label: "Metal scrap in bulk" },
  { id: "CSS-10", label: "Flexible intermediate bulk containers (FIBC)" },
  { id: "CSS-11", label: "Logs (under-deck stow)" },
  { id: "CSS-12", label: "Unit loads" },
] as const;

export const TOLERANCE_HOLDERS = ["MOLOO", "MOLCHOPT"] as const;
export type ToleranceHolder = (typeof TOLERANCE_HOLDERS)[number];

export const CARGO_STATUSES = ["IN", "PARTIAL", "OUT", "CLOSED"] as const;
export type CargoStatus = (typeof CARGO_STATUSES)[number];

export const REVIEW_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "FLAGGED",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const ZONE_CODES = [
  "B.SEA",
  "E.MED",
  "W.MED",
  "C.MED",
  "ADRIATIC",
  "R.SEA",
  "AG",
  "A.SEA",
  "WCAF",
  "ECAF",
  "NCONT",
  "CARIB",
  "F.EAST",
  "ECI",
  "Unknown",
] as const;
export type ZoneCode = (typeof ZONE_CODES)[number];

export const ZONE_LABELS: Record<ZoneCode, string> = {
  "B.SEA": "Black Sea",
  "E.MED": "East Mediterranean",
  "W.MED": "West Mediterranean",
  "C.MED": "Central Mediterranean",
  ADRIATIC: "Adriatic Sea",
  "R.SEA": "Red Sea",
  AG: "Arabian Gulf",
  "A.SEA": "Arabian Sea",
  WCAF: "West Coast Africa",
  ECAF: "East Coast Africa",
  NCONT: "North Continent",
  CARIB: "Caribbean",
  "F.EAST": "Far East",
  ECI: "East Coast India",
  Unknown: "Unknown",
};

export type CommodityOption = {
  id: string;
  canonical_name: string;
  cargo_type: CargoType;
  imsbc_category: ImsbcCategory;
  is_dg: boolean;
  is_grain: boolean;
  default_sf_m3t: number | null;
};

export type PortOption = {
  locode: string;
  trade_name: string;
  country: string;
  zone: ZoneCode;
  port_type: string;
};

export type SafetyQuestion = {
  id: string;
  question_key: string;
  question_text: string;
  answer_type: "boolean" | "number" | "text" | "select" | "multi_select";
  select_options: string[] | null;
  is_required: boolean;
  is_matchmaking_field: boolean;
  matchmaking_column: string | null;
  section_label: string | null;
  help_text: string | null;
  sort_order: number;
};

export const LOCODE_REGEX = /^[A-Z]{2}[A-Z0-9]{3}$/;
export function validateLocode(value: string): boolean {
  return LOCODE_REGEX.test(value.trim().toUpperCase());
}

export function validateImoCheckDigit(imo: string): boolean {
  if (!/^\d{7}$/.test(imo)) return false;
  const weights = [7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(imo[i]), 0);
  return sum % 10 === Number(imo[6]);
}

export const PHONE_REGEX = /^\+?[0-9\s\-()]{7,20}$/;
export function validatePhone(value: string): boolean {
  return PHONE_REGEX.test(value.trim());
}

export const VOLUME_UNITS = ["cbm", "cbft"] as const;
export type VolumeUnit = (typeof VOLUME_UNITS)[number];

export const SF_UNITS = ["ft3_lt", "m3_t"] as const;
export type SfUnit = (typeof SF_UNITS)[number];

export const SF_LIMITS = {
  ft3_lt: { min: 10, max: 90 },
  m3_t: { min: 0.28, max: 2.55 },
} as const;

export const SF_VOLUME_CHECK_THRESHOLD_FT3LT = 50;
export const FT3LT_TO_M3T = 1 / 35.315;
export const M3T_TO_FT3LT = 35.315;
export const CBM_PER_CBFT = 0.0283168;

export function sfToFt3Lt(value: number, unit: SfUnit): number {
  return unit === "m3_t" ? value * M3T_TO_FT3LT : value;
}

export function computeCargoVolumeCbm(
  qty_mt: number | undefined | null,
  stowage_factor_m3t: number | undefined | null,
): number | null {
  if (!qty_mt || !stowage_factor_m3t || qty_mt <= 0 || stowage_factor_m3t <= 0)
    return null;
  return Math.round(qty_mt * stowage_factor_m3t);
}

export const cargoFormSchema = z
  .object({
    commodity_id: z.string().uuid("Please select a commodity"),
    commodity_name: z.string(),
    cargo_type: z.enum(CARGO_TYPES),
    imsbc_category: z.enum(IMSBC_CATEGORIES),
    is_dg_cargo: z.boolean(),
    is_grain_cargo: z.boolean(),

    stowage_factor_unit: z.enum(SF_UNITS).optional(),
    stowage_factor: z
      .number()
      .positive("Stowage factor must be positive")
      .optional(),

    qty_min_mt: z
      .number()
      .int()
      .min(100, "Minimum quantity is 100 MT")
      .max(250000, "Maximum quantity is 250,000 MT"),
    qty_max_mt: z
      .number()
      .int()
      .min(100, "Maximum quantity required (min 100 MT)")
      .max(250000, "Maximum quantity is 250,000 MT"),

    volume_cbm: z
      .number()
      .int()
      .min(100, "Volume must be at least 100 CBM")
      .max(150000, "Volume must be 100–150,000 CBM")
      .optional(),

    load_port_locode: z.string().min(1, "Load port is required"),
    disch_port_locode: z.string().min(1, "Discharge port is required"),

    packaging_type: z.enum(PACKAGING_TYPES).optional(),
    css_category: z.string().optional(), // CSS-01…12 when cargo_type = Break Bulk

    // Multi-port: full ordered range (index 0 = primary load/disch port above).
    load_ports: z
      .array(z.object({ locode: z.string(), name: z.string(), country: z.string(), zone: z.string(), status: z.string() }))
      .optional(),
    disch_ports: z
      .array(z.object({ locode: z.string(), name: z.string(), country: z.string(), zone: z.string(), status: z.string() }))
      .optional(),
    bag_weight_kg: z
      .number()
      .min(10, "Bag weight must be 10–1,500 kg")
      .max(1500, "Bag weight must be 10–1,500 kg")
      .optional(),

    laycan_from: z.string().optional(),
    laycan_to: z.string().optional(),

    nor_clause: z.enum(NOR_CLAUSES).optional(),

    load_rate: z
      .number()
      .int()
      .min(200, "Load rate must be at least 200 MT/day")
      .max(8000, "Load rate must be 200–8,000 MT/day")
      .optional(),
    disch_rate: z
      .number()
      .int()
      .min(200, "Discharge rate must be at least 200 MT/day")
      .max(8000, "Discharge rate must be 200–8,000 MT/day")
      .optional(),

    load_terms: z.enum(LOAD_TERMS).optional(),
    laytime_basis: z.enum(LAYTIME_BASIS_OPTIONS).optional(),
    laytime_structure: z.string().optional(),

    freight_basis: z.enum(FREIGHT_BASIS_OPTIONS).optional(),

    freight_idea_usd_mt: z
      .number()
      .min(1, "Freight idea must be at least $1/MT")
      .max(500, "Freight idea must be 1–500 USD/MT")
      .optional(),

    commission_pct: z.number().min(0).max(100).optional(),

    commission_ttl_pct: z
      .number()
      .min(0, "Commission must be 0–5%")
      .max(5, "Total commission must be 0–5%")
      .optional(),

    iac_flag: z.boolean().optional(),

    disport_status: z.enum(DISPORT_STATUS_OPTIONS).optional(),

    demurrage_rate: z.number().positive().optional(),

    despatch_rate: z
      .number()
      .min(0, "Despatch rate cannot be negative")
      .max(10000, "Despatch rate must be 0–10,000 USD/day")
      .optional(),

    despatch_basis: z.enum(DESPATCH_BASIS_OPTIONS).optional(),

    tolerance_pct: z
      .number()
      .int()
      .min(0, "Tolerance must be 0–10%")
      .max(10, "Tolerance must be 0–10%")
      .optional(),
    tolerance_holder: z.enum(TOLERANCE_HOLDERS).optional(),

    broker: z.string().optional(),
    notes: z.string().optional(),

    safety_answers: z.record(z.string(), z.string()).optional(),
  })
  .refine((d) => d.qty_max_mt >= d.qty_min_mt, {
    message: "Maximum quantity must be ≥ minimum",
    path: ["qty_max_mt"],
  })
  .refine(
    (d) =>
      !d.laycan_from ||
      !d.laycan_to ||
      new Date(d.laycan_to) >= new Date(d.laycan_from),
    { message: "Laycan end must be after laycan start", path: ["laycan_to"] },
  )
  .refine(
    (d) => {
      if (!d.laycan_from || !d.laycan_to) return true;
      const diff =
        (new Date(d.laycan_to).getTime() - new Date(d.laycan_from).getTime()) /
        86400000;
      return diff <= 45;
    },
    { message: "Laycan window cannot exceed 45 days", path: ["laycan_to"] },
  )
  .refine(
    (d) => {
      if (!d.laycan_from) return true;
      return d.laycan_from >= new Date().toISOString().split("T")[0];
    },
    { message: "Laycan date cannot be in the past", path: ["laycan_from"] },
  )
  .refine(
    (d) =>
      !d.load_port_locode ||
      !d.disch_port_locode ||
      d.load_port_locode !== d.disch_port_locode,
    {
      message: "Discharge port must differ from load port",
      path: ["disch_port_locode"],
    },
  )
  .superRefine((d, ctx) => {
    if (d.stowage_factor) {
      const { min, max } = SF_LIMITS[d.stowage_factor_unit ?? "ft3_lt"];
      if (d.stowage_factor < min || d.stowage_factor > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            d.stowage_factor_unit === "m3_t"
              ? "Stowage factor must be 0.28–2.55 m³/t"
              : "Stowage factor must be 10–90 ft³/LT",
          path: ["stowage_factor"],
        });
      }
    }
    if (d.load_port_locode && !validateLocode(d.load_port_locode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Load port LOCODE must be 5 uppercase characters (e.g. AEJEA)",
        path: ["load_port_locode"],
      });
    }
    if (d.disch_port_locode && !validateLocode(d.disch_port_locode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Discharge port LOCODE must be 5 uppercase characters",
        path: ["disch_port_locode"],
      });
    }
  })
  .refine(
    (d) => d.packaging_type !== "Bagged" || d.bag_weight_kg !== undefined,
    {
      message: "Bag weight is required for bagged cargo",
      path: ["bag_weight_kg"],
    },
  )
  .refine(
    (d) =>
      !d.tolerance_pct ||
      d.tolerance_pct === 0 ||
      d.tolerance_holder !== undefined,
    {
      message: "Please select MOLOO or MOLCHOPT when tolerance % is set",
      path: ["tolerance_holder"],
    },
  );

export type CargoFormValues = z.infer<typeof cargoFormSchema>;

export type CargoListingRow = {
  id: string;
  ref: string | null;
  status: CargoStatus;
  review_status: ReviewStatus;
  goes_live_at: string | null;
  cargo_type: CargoType;
  commodity_id: string;
  commodity_name: string;
  is_dg_cargo: boolean;
  is_grain_cargo: boolean;
  qty_min_mt: number;
  qty_max_mt: number;
  stowage_factor: number | null;
  volume_cbm: number | null;
  load_port_locode: string;
  load_port_name: string;
  load_zone: ZoneCode;
  load_country: string;
  disch_port_locode: string;
  disch_port_name: string;
  disch_zone: ZoneCode;
  disch_country: string;
  load_ports?: { locode: string; name: string; zone: string; country: string; status: string }[] | null;
  disch_ports?: { locode: string; name: string; zone: string; country: string; status: string }[] | null;
  laycan_from: string | null;
  laycan_to: string | null;
  is_spot: boolean;
  nor_clause: NorClause | null;
  load_rate: number | null;
  disch_rate: number | null;
  load_terms: LoadTerms | null;
  laytime_basis: LaytimeBasis | null;
  freight_basis: FreightBasis | null;
  freight_idea_usd_mt: number | null;
  commission_pct: number | null;
  commission_ttl_pct: number | null;
  iac_flag: boolean | null;
  demurrage_rate: number | null;
  despatch_rate: number | null;
  despatch_basis: DespatchBasis | null;
  tolerance_pct: number | null;
  tolerance_holder: ToleranceHolder | null;
  disport_status: DisportStatus | null;
  packaging_type: PackagingType | null;
  bag_weight_kg: number | null;
  requires_geared: boolean | null;
  max_vessel_age_yr: number | null;
  max_loa_m: number | null;
  max_draft_m: number | null;
  broker: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CargoSafetyAnswer = {
  id: string;
  cargo_listing_id: string;
  question_id: string | null;
  question_key: string;
  answer_value: string | null;
  answered_by: string | null;
};

export type CargoListingFilters = {
  zone?: ZoneCode | null;
  cargo_type?: CargoType | null;
  min_qty?: number | null;
  max_qty?: number | null;
  is_dg_only?: boolean;
  laycan_from?: string | null;
  laycan_to?: string | null;
  sort?: "newest" | "qty_asc" | "qty_desc" | "laycan_asc";
  archiveCutoff?: string | null;
};
