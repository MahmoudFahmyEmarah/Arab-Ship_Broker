export type UserRole = "admin" | "cargo_owner" | "vessel_owner" | "broker";
export type TrustTier = "NEW" | "VERIFIED" | "FLAGGED";

export type AdminUserRow = {
  id: string;
  name: string;
  full_name: string;
  email: string;
  role: UserRole;
  trust_tier: TrustTier;
  is_active: boolean;
  clean_posts: number;
  strike_count: number;
  company: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED" | "FLAGGED";
export type ListingType = "cargo" | "vessel_availability";
export type ActionTaken = "approved" | "rejected" | "amended" | "flagged";

export type QueueItem = {
  id: string;
  listing_type: ListingType;
  listing_id: string;
  submitted_by: string;
  trust_tier_at_submit: TrustTier | null;
  is_random_sample: boolean;
  review_reason: string | null;
  status: ReviewStatus;
  action_taken: ActionTaken | null;
  amendment_detail: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields from v_admin_queue_detail
  submitter_name: string | null;
  submitter_email: string | null;
  submitter_trust_tier: TrustTier | null;
  submitter_clean_posts: number | null;
  submitter_strike_count: number | null;
  // Cargo listing preview
  cargo_ref: string | null;
  commodity_name: string | null;
  cargo_type: "Dry Bulk" | "Break Bulk" | null;
  qty_min_mt: number | null;
  qty_max_mt: number | null;
  load_port_name: string | null;
  load_zone: string | null;
  disch_port_name: string | null;
  disch_zone: string | null;
  laycan_from: string | null;
  laycan_to: string | null;
  is_spot: boolean | null;
  cargo_status: string | null;
  cargo_review_status: ReviewStatus | null;
  // Vessel availability preview
  vessel_id: string | null;
  vessel_name: string | null;
  vessel_type: string | null;
  dwt_grain: number | null;
  risk_level: string | null;
  is_sanctioned: boolean | null;
  open_port_name: string | null;
  open_zone: string | null;
  open_date: string | null;
  vessel_status: string | null;
  vessel_review_status: ReviewStatus | null;
};

export type AdminStats = {
  // Queue
  queue_pending: number;
  queue_oldest_minutes: number | null;
  // Cargo
  cargo_live: number;
  cargo_pending: number;
  cargo_total_30d: number;
  // Vessels
  vessel_open: number;
  vessel_pending: number;
  // Users
  users_total: number;
  users_active: number;
  users_new_tier: number;
  users_verified_tier: number;
  users_flagged_tier: number;
  users_new_30d: number;
  // Vessel register
  vessels_total: number;
  vessels_sanctioned: number;
  vessels_high_risk: number;
  // Ports
  ports_unverified: number;
  // Messages
  messages_unread: number;
};

export type ActivityDay = {
  day: string; // ISO date string
  cargo_submitted: number;
  vessel_submitted: number;
  approved: number;
  rejected: number;
};

export type CargoStatus = "IN" | "PARTIAL" | "OUT" | "CLOSED";

export type AdminCargoRow = {
  id: string;
  ref: string | null;
  status: CargoStatus;
  review_status: ReviewStatus;
  cargo_type: "Dry Bulk" | "Break Bulk";
  commodity_name: string;
  is_dg_cargo: boolean;
  is_grain_cargo: boolean;
  qty_min_mt: number;
  qty_max_mt: number;
  stowage_factor: number | null;
  load_port_name: string | null;
  load_zone: string | null;
  disch_port_name: string | null;
  disch_zone: string | null;
  laycan_from: string | null;
  laycan_to: string | null;
  is_spot: boolean;
  freight_idea_usd_mt: number | null;
  broker: string | null;
  notes: string | null;
  goes_live_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RiskLevel = "CLEAR" | "LOW" | "MEDIUM" | "HIGH";
export type VesselScope = "In Scope" | "Marginal" | "Out of Scope";
export type VesselType = "Bulk Carrier" | "General Cargo" | "Other";

export type VesselRecordReviewStatus = "CLEAR" | "IN_REVIEW";

export type AdminVesselRow = {
  id: string;
  vessel_name: string;
  imo_number: string | null;
  vessel_type: VesselType;
  dwt_grain: number | null;
  dwt_bale: number | null;
  build_year: number | null;
  flag: string | null;
  flag_category: "FOC" | "Domestic" | null;
  scope: VesselScope;
  risk_level: RiskLevel;
  risk_notes: string | null;
  is_geared: boolean | null;
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
  vessel_review_status: VesselRecordReviewStatus;
  vessel_review_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminPortRow = {
  locode: string;
  trade_name: string;
  country: string;
  zone: string;
  port_type: "Sea Port" | "River Port" | "Sea/River";
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
};

export type AdminCommodityRow = {
  id: string;
  canonical_name: string;
  display_aliases: string[] | null;
  cargo_type: "Dry Bulk" | "Break Bulk";
  imsbc_category: "Cat_A" | "Cat_B" | "Cat_C" | "DG" | "Non_DG";
  is_dg: boolean;
  is_grain: boolean;
  default_sf_m3t: number | null;
  un_number: string | null;
  imo_class: string | null;
  is_active: boolean;
  sort_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminMessageRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  how_did_you_find_us: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
};
