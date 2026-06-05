import { z } from "zod";
import {
  ZoneCode,
  ReviewStatus,
  ZONE_CODES,
  validateImoCheckDigit,
  validatePhone,
} from "./cargo";

export type { ZoneCode, ReviewStatus };

export const VESSEL_TYPES = ["Bulk Carrier", "General Cargo", "Other"] as const;
export type VesselType = (typeof VESSEL_TYPES)[number];

export const VESSEL_STATUSES = [
  "OPEN",
  "FIXED",
  "ON SUBS",
  "INACTIVE",
] as const;
export type VesselStatus = (typeof VESSEL_STATUSES)[number];

export const FUEL_TYPES = [
  "VLSFO",
  "HSFO",
  "MGO",
  "MDO",
  "LNG",
  "Biofuel blend",
] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const RISK_LEVELS = ["CLEAR", "LOW", "MEDIUM", "HIGH"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const SCOPE_VALUES = ["In Scope", "Marginal", "Out of Scope"] as const;
export type ScopeValue = (typeof SCOPE_VALUES)[number];

export type VesselRecordReviewStatus = "CLEAR" | "IN_REVIEW";
export const GRAB_TYPES = [
  "Mechanical Clamshell",
  "Orange Peel",
  "None",
] as const;
export type GrabType = (typeof GRAB_TYPES)[number];

export const CBFT_PER_CBM = 35.3147;

export function computeRequiredCbm(
  qty_mt: number | null | undefined,
  stowage_factor_m3t: number | null | undefined,
): number | null {
  if (!qty_mt || !stowage_factor_m3t || qty_mt <= 0 || stowage_factor_m3t <= 0)
    return null;
  return Math.round(qty_mt * stowage_factor_m3t);
}

export type VesselRow = {
  id: string;
  vessel_name: string;
  imo_number: string | null;
  vessel_type: VesselType;
  dwt_grain: number | null;
  dwt_bale: number | null;
  grain_cbm: number | null;
  bale_cbm: number | null;
  gross_tonnage: number | null;
  net_tonnage: number | null;
  beam_m: number | null;
  dwcc: number | null;
  build_year: number | null;
  flag: string | null;
  flag_category: "FOC" | "Domestic" | null;
  scope: ScopeValue;
  risk_level: RiskLevel;
  risk_notes: string | null;
  preferred_zones: ZoneCode[] | null;
  is_geared: boolean | null;
  crane_count: number | null;
  crane_swl_mt: number | null;
  grain_certified: boolean | null;
  dg_certified: boolean | null;
  max_loa_m: number | null;
  max_draft_m: number | null;
  pi_club: string | null;
  is_sanctioned: boolean;
  owner_company: string | null;
  owner_country: string | null;
  manager_company: string | null;
  manager_country: string | null;
  commercial_manager_company: string | null;
  commercial_manager_country: string | null;
  commercial_manager_contact: string | null;
  commercial_manager_email: string | null;
  commercial_manager_phone: string | null;
  charter_status: string | null;
  tc_charterer_name: string | null;
  tc_expiry: string | null;
  bbc_charterer_name: string | null;
  bbc_expiry: string | null;
  pi_ig_member: boolean | null;
  pi_coverage_types: string[] | null;
  war_risk_trading: string | null;
  war_risk_conditions: string | null;
  preferred_trading_areas: string[] | null;
  vessel_review_status: VesselRecordReviewStatus;
  vessel_review_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type VesselContactRow = {
  id: string;
  vessel_id: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

export type VesselAvailabilityRow = {
  id: string;
  ref: string | null;
  vessel_id: string;
  open_port_locode: string | null;
  open_port_name: string | null;
  ballast_port_locode: string | null;
  ballast_port_name: string | null;
  open_zone: ZoneCode | null;
  open_date: string | null;
  open_date_range_days: number;
  last_cargo: string | null;
  service_speed_kn: number | null;
  me_consumption_mt_day: number | null;
  me_consumption_port_mt_day: number | null;
  aux_consumption_mt_day: number | null;
  aux_consumption_port_mt_day: number | null;
  fuel_type: FuelType | null;
  freight_idea_usd_mt: number | null;
  accepts_part_cargo: boolean;
  grab_type: GrabType | null;
  grab_capacity_mt: number | null;
  num_grabs: number | null;
  brob_mt: number | null;
  status: VesselStatus;
  review_status: ReviewStatus;
  goes_live_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type VesselAvailabilityWithVessel = VesselAvailabilityRow & {
  vessel: Pick<
    VesselRow,
    | "vessel_name"
    | "imo_number"
    | "vessel_type"
    | "dwt_grain"
    | "grain_cbm"
    | "bale_cbm"
    | "build_year"
    | "flag"
    | "scope"
    | "risk_level"
    | "is_sanctioned"
    | "is_geared"
    | "grain_certified"
    | "dg_certified"
    | "max_draft_m"
    | "preferred_zones"
  >;
};

export type VesselMatchResult = {
  cargo_id: string;
  ref: string | null;
  commodity_name: string;
  cargo_type: "Dry Bulk" | "Break Bulk";
  qty_min_mt: number;
  qty_max_mt: number;
  load_port_name: string;
  load_zone: ZoneCode;
  disch_port_name: string;
  disch_zone: ZoneCode;
  laycan_from: string | null;
  laycan_to: string | null;
  is_spot: boolean;
  is_grain_cargo: boolean;
  is_dg_cargo: boolean;
  load_terms: string | null;
  freight_idea_usd_mt: number | null;
  requires_geared: boolean | null;
  max_vessel_age_yr: number | null;
  max_draft_m: number | null;
  max_loa_m: number | null;
  is_rate_aligned: boolean;
  dwt_delta: number;
};

export const availabilityFormSchema = z
  .object({
    vessel_id: z.string().uuid("Please select a vessel"),
    open_port_locode: z.string().min(1, "Open port is required"),
    ballast_port_locode: z.string().optional(),

    open_date: z.string().min(1, "Open date is required"),

    open_date_range_days: z
      .number()
      .int()
      .min(0, "Flexibility must be 0–30 days")
      .max(30, "Flexibility window must be 0–30 days")
      .optional(),

    last_cargo: z.string().optional(),
    accepts_part_cargo: z.boolean().optional(),

    service_speed_kn: z
      .number()
      .min(6, "Speed must be 6–18 knots")
      .max(18, "Speed must be 6–18 knots")
      .optional(),

    me_consumption_mt_day: z
      .number()
      .min(1, "M/E consumption must be 1–40 MT/day")
      .max(40, "M/E consumption must be 1–40 MT/day")
      .optional(),

    me_consumption_port_mt_day: z.number().positive().optional(),

    aux_consumption_mt_day: z
      .number()
      .min(0.5, "Aux consumption must be 0.5–8 MT/day")
      .max(8, "Aux consumption must be 0.5–8 MT/day")
      .optional(),

    aux_consumption_port_mt_day: z.number().positive().optional(),
    fuel_type: z.enum(FUEL_TYPES).optional(),

    grab_type: z.enum(GRAB_TYPES).optional(),

    grab_capacity_mt: z
      .number()
      .min(3, "Grab capacity must be 3–20 t")
      .max(20, "Grab capacity must be 3–20 t")
      .optional(),

    num_grabs: z
      .number()
      .int()
      .min(1, "Number of grabs must be 1–4")
      .max(4, "Number of grabs must be 1–4")
      .optional(),

    brob_mt: z
      .number()
      .min(0, "BROB must be 0–2,000 MT")
      .max(2000, "BROB must be 0–2,000 MT")
      .optional(),

    notes: z.string().optional(),
  })
  .refine(
    (d) =>
      new Date(d.open_date) >= new Date(new Date().toISOString().split("T")[0]),
    { message: "Open date cannot be in the past", path: ["open_date"] },
  )
  .refine(
    (d) => {
      const max = new Date();
      max.setDate(max.getDate() + 90);
      return new Date(d.open_date) <= max;
    },
    {
      message: "Open date must be within the next 90 days",
      path: ["open_date"],
    },
  )
  .superRefine((d, ctx) => {
    if (d.grab_type && d.grab_type !== "None") {
      if (d.grab_capacity_mt === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Grab capacity is required when grab type is set",
          path: ["grab_capacity_mt"],
        });
      }
      if (d.num_grabs === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Number of grabs is required when grab type is set",
          path: ["num_grabs"],
        });
      }
    }
  });

export type AvailabilityFormValues = z.infer<typeof availabilityFormSchema>;

export type VesselAvailabilityFilters = {
  zone?: ZoneCode | null;
  vessel_type?: VesselType | null;
  sort?: "newest" | "open_date_asc";
};

export const vesselCreateSchema = z
  .object({
    vessel_name: z
      .string()
      .min(2, "Vessel name is required")
      .max(80, "Vessel name must be 80 characters or fewer"),

    imo_number: z
      .string()
      .regex(/^\d{7}$/, "IMO must be exactly 7 digits")
      .optional()
      .or(z.literal("")),

    vessel_type: z.enum(["Bulk Carrier", "General Cargo", "Other"]),

    dwt_grain: z.coerce
      .number()
      .int()
      .min(500, "DWT must be 500–15,000 MT")
      .max(15000, "DWT must be 500–15,000 MT")
      .optional(),
    dwt_bale: z.coerce
      .number()
      .int()
      .min(500, "DWT bale must be 500–15,000 MT")
      .max(15000, "DWT bale must be 500–15,000 MT")
      .optional(),

    dwcc: z.coerce
      .number()
      .int()
      .min(100, "DWCC must be a positive value")
      .optional(),

    grain_cbm: z.coerce
      .number()
      .int()
      .min(500, "Grain capacity must be 500–20,000 CBM")
      .max(20000, "Grain capacity must be 500–20,000 CBM")
      .optional(),
    bale_cbm: z.coerce
      .number()
      .int()
      .min(500, "Bale capacity must be 500–20,000 CBM")
      .max(20000, "Bale capacity must be 500–20,000 CBM")
      .optional(),

    gross_tonnage: z.coerce
      .number()
      .int()
      .min(200, "Gross tonnage must be 200–15,000")
      .max(15000, "Gross tonnage must be 200–15,000")
      .optional(),
    net_tonnage: z.coerce.number().int().positive().optional(),

    beam_m: z.coerce
      .number()
      .min(6, "Beam must be 6–40 m")
      .max(40, "Beam must be 6–40 m")
      .optional(),

    build_year: z.coerce
      .number()
      .int()
      .min(1970, "Build year must be 1970 or later")
      .max(new Date().getFullYear() + 1, "Build year cannot be in the future")
      .optional(),

    flag: z.string().optional(),
    flag_category: z.enum(["FOC", "Domestic"]).optional(),
    is_geared: z.boolean().optional(),

    crane_count: z.coerce
      .number()
      .int()
      .min(1, "Crane count must be 1–6")
      .max(6, "Crane count must be 1–6")
      .optional(),

    crane_swl_mt: z.coerce
      .number()
      .min(5, "Crane SWL must be 5–50 t")
      .max(50, "Crane SWL must be 5–50 t")
      .optional(),

    grain_certified: z.boolean().optional(),
    dg_certified: z.boolean().optional(),

    max_loa_m: z.coerce
      .number()
      .min(40, "LOA must be 40–200 m")
      .max(200, "LOA must be 40–200 m")
      .optional(),

    max_draft_m: z.coerce
      .number()
      .min(2, "Draft must be 2–14 m")
      .max(14, "Draft must be 2–14 m")
      .optional(),

    pi_club: z.string().optional(),
    owner_company: z
      .string()
      .min(2, "Company name must be at least 2 characters")
      .max(120, "Company name must be 120 characters or fewer")
      .optional(),
    owner_country: z.string().optional(),

    owner_phone: z.string().optional(),

    manager_company: z.string().min(2).max(120).optional(),
    manager_country: z.string().optional(),
    owner_contact_name: z.string().optional(),
    owner_email: z.string().email("Invalid email").optional().or(z.literal("")),
    commercial_manager_company: z.string().optional(),
    commercial_manager_country: z.string().optional(),
    commercial_manager_contact: z.string().optional(),
    commercial_manager_email: z
      .string()
      .email("Invalid email")
      .optional()
      .or(z.literal("")),
    commercial_manager_phone: z.string().optional(),
    charter_status: z.string().optional(),
    tc_charterer_name: z.string().optional(),
    tc_expiry: z.string().optional(),
    bbc_charterer_name: z.string().optional(),
    bbc_expiry: z.string().optional(),
    persons_in_charge: z
      .array(
        z.object({
          name: z.string().min(1, "Name is required"),
          role: z.string(),
          email: z.string().email("Invalid email").optional().or(z.literal("")),
          phone: z.string().optional(),
        }),
      )
      .optional(),
    pi_ig_member: z.boolean().optional(),
    pi_coverage_types: z.array(z.string()).optional(),
    war_risk_trading: z.string().optional(),
    war_risk_conditions: z.string().optional(),
    preferred_trading_areas: z.array(z.string()).optional(),
    preferred_zones: z.array(z.enum(ZONE_CODES)).optional(),
    notes: z.string().optional(),
  })
  .refine((d) => !d.dwcc || !d.dwt_grain || d.dwcc < d.dwt_grain, {
    message: "DWCC must be less than DWT Grain",
    path: ["dwcc"],
  })
  .superRefine((d, ctx) => {
    if (d.imo_number && d.imo_number.length === 7) {
      if (!validateImoCheckDigit(d.imo_number)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "IMO check digit is invalid — please verify the IMO number",
          path: ["imo_number"],
        });
      }
    }
  })
  .superRefine((d, ctx) => {
    if (d.owner_phone && d.owner_phone.trim().length > 0) {
      if (!validatePhone(d.owner_phone)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Phone number format is invalid (e.g. +971 4 000 0000)",
          path: ["owner_phone"],
        });
      }
    }
  });

export type VesselCreateValues = z.infer<typeof vesselCreateSchema>;

export type VesselClaimRow = {
  id: string;
  vessel_id: string;
  user_id: string;
  role: "owner" | "operator" | "manager";
  created_at: string;
};

export type MyVesselRow = VesselRow & {
  claim_role: "owner" | "operator" | "manager";
  claimed_at: string;
  open_availability_count: number;
  open_port_name: string | null;
  open_port_locode: string | null;
  open_zone: ZoneCode | null;
  open_date: string | null;
};
