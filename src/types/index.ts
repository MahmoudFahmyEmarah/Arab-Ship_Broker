// ─── ENUMS (match Supabase schema exactly) ────────────────────────────────────

export type VesselType = 'Bulk Carrier' | 'General Cargo' | 'Other'
export type ScopeEnum = 'In Scope' | 'Marginal' | 'Out of Scope'
export type ZoneEnum = 'B.SEA' | 'E.MED' | 'W.MED' | 'C.MED' | 'ADRIATIC' | 'R.SEA' | 'AG' | 'A.SEA' | 'WCAF' | 'ECAF' | 'NCONT' | 'CARIB' | 'F.EAST' | 'ECI' | 'Unknown'
export type CargoType = 'Dry Bulk' | 'Break Bulk'
export type CargoStatus = 'IN' | 'PARTIAL' | 'OUT' | 'CLOSED'
export type VesselStatus = 'OPEN' | 'FIXED' | 'ON SUBS' | 'INACTIVE'
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'FLAGGED'
export type TrustTier = 'NEW' | 'VERIFIED' | 'FLAGGED'
export type SubscriptionTier = 'T1' | 'T2' | 'T3' | 'T4'
export type ImbscCategory = 'Cat_A' | 'Cat_B' | 'Cat_C' | 'DG' | 'Non_DG'
export type LoadTerms = 'FIO' | 'FIOT' | 'FIOST' | 'FIOS' | 'FIOS LSD' | 'Liner Terms'

// ─── CARGO ────────────────────────────────────────────────────────────────────

export interface CargoListing {
  id: string
  ref: string
  batch_id?: string
  batch_date?: string
  status: CargoStatus
  priority?: string
  cargo_type: CargoType
  commodity_id?: string
  commodity_name: string
  commodity_category?: string
  is_dg_cargo: boolean
  is_grain_cargo: boolean
  is_wog: boolean
  for_circulation: boolean
  market_partner_id?: string
  market_partner_name?: string
  qty_min_mt: number
  qty_max_mt: number
  stowage_factor?: number
  volume_m3?: number
  load_port_locode?: string
  load_port_name?: string
  load_zone?: ZoneEnum
  load_country?: string
  load_port_2_locode?: string
  load_port_2_name?: string
  load_port_3_locode?: string
  load_port_3_name?: string
  disch_port_locode?: string
  disch_port_name?: string
  disch_zone?: ZoneEnum
  disch_country?: string
  disch_port_2_locode?: string
  disch_port_2_name?: string
  disch_port_3_locode?: string
  disch_port_3_name?: string
  laycan_from?: string
  laycan_to?: string
  is_spot: boolean
  load_rate?: string
  disch_rate?: string
  load_terms?: LoadTerms
  laytime_qualifier?: string
  laytime_structure?: string
  nor_clause?: string
  freight_idea_usd_mt?: number
  commission_pct?: number
  demurrage_rate?: number
  despatch_rate?: number
  requires_geared?: boolean
  max_vessel_age_yr?: number
  max_loa_m?: number
  max_draft_m?: number
  broker?: string
  notes?: string
  review_status: ReviewStatus
  goes_live_at?: string
  created_at: string
  updated_at: string
  // Computed / joined
  match_count?: number
  imsbc_category?: ImbscCategory
}

// ─── VESSEL ───────────────────────────────────────────────────────────────────

export interface Vessel {
  id: string
  vessel_name: string
  imo_number?: string
  vessel_type: VesselType
  dwt_grain?: number
  dwt_bale?: number
  dwcc?: number
  build_year?: number
  flag?: string
  scope: ScopeEnum
  is_geared?: boolean
  crane_count?: number
  crane_swl_mt?: number
  grain_certified?: boolean
  dg_certified?: boolean
  max_loa_m?: number
  max_draft_m?: number
  grain_cbm?: number
  bale_cbm?: number
  is_sanctioned: boolean
  preferred_zones?: ZoneEnum[]
  created_at: string
  updated_at: string
}

export interface VesselAvailability {
  id: string
  vessel_id: string
  vessel?: Vessel
  open_port_locode?: string
  open_port_name?: string
  open_zone?: ZoneEnum
  open_date?: string
  open_date_range_days?: number
  last_cargo?: string
  vlsfo_sea_mt_day?: number
  lsmgo_sea_mt_day?: number
  vlsfo_port_mt_day?: number
  lsmgo_port_mt_day?: number
  freight_idea_usd_mt?: number
  accepts_part_cargo?: boolean
  status: VesselStatus
  review_status: ReviewStatus
  goes_live_at?: string
  broker?: string
  commission_pct?: number
  notes?: string
  // Computed
  match_count?: number
  lat?: number
  lng?: number
  created_at: string
  updated_at: string
}

// ─── PORT ─────────────────────────────────────────────────────────────────────

export interface Port {
  locode: string
  trade_name: string
  country: string
  zone: ZoneEnum
  port_type: string
  latitude?: number
  longitude?: number
  is_active: boolean
  is_verified: boolean
}

// ─── COMMODITY ────────────────────────────────────────────────────────────────

export interface Commodity {
  id: string
  canonical_name: string
  display_aliases?: string[]
  cargo_type: CargoType
  imsbc_category: ImbscCategory
  is_dg: boolean
  is_grain: boolean
  default_sf_m3t?: number
  category_label?: string
  is_active: boolean
}

// ─── USER ─────────────────────────────────────────────────────────────────────

export interface AppUser {
  id: string
  full_name?: string
  company?: string
  role?: string
  email?: string
  trust_tier: TrustTier
  subscription_tier: SubscriptionTier
  clean_posts: number
  strike_count: number
  is_active: boolean
  notes?: string
  created_at: string
  updated_at: string
}

// ─── FUEL PRICES ──────────────────────────────────────────────────────────────

export interface FuelPrice {
  id: string
  sponsor_name: string
  port_area: string
  vlsfo_usd_mt?: number
  lsmgo_usd_mt?: number
  mgo_usd_mt?: number
  ifo380_usd_mt?: number
  vlsfo_direction?: 'up' | 'down' | 'flat'
  lsmgo_direction?: 'up' | 'down' | 'flat'
  mgo_direction?: 'up' | 'down' | 'flat'
  updated_at: string
  is_active: boolean
  freshness_state?: 'current' | 'stale' | 'expired'
}

// ─── ANNOUNCEMENT ─────────────────────────────────────────────────────────────

export interface Announcement {
  id: string
  title: string
  category: 'general' | 'port_da' | 'bunker' | 'version' | 'security' | 'notice'
  link_url?: string
  link_label?: string
  active: boolean
  target_tiers: SubscriptionTier[]
  created_at: string
  expires_at?: string
}

// ─── VOYAGE ESTIMATE ──────────────────────────────────────────────────────────

export interface VoyageEstimate {
  id: string
  vessel_id?: string
  cargo_id?: string
  vessel_name?: string
  cargo_name?: string
  pol_locode?: string
  pod_locode?: string
  // Port DAs
  pol_port_dues?: number
  pol_agency_fee?: number
  pol_pilotage?: number
  pod_port_dues?: number
  pod_agency_fee?: number
  pod_pilotage?: number
  // Bunker
  vlsfo_sea_rate?: number
  lsmgo_port_rate?: number
  vlsfo_price?: number
  lsmgo_price?: number
  sea_days?: number
  port_days?: number
  // Load/Disch
  load_rate_mt_day?: number
  disch_rate_mt_day?: number
  quantity_mt?: number
  load_terms?: string
  // Suez
  suez_direction?: string
  sca_dues?: number
  suez_mooring?: number
  transit_days?: number
  // Totals
  total_port_das?: number
  total_bunker_cost?: number
  total_suez_cost?: number
  total_opex?: number
  created_by?: string
  created_at: string
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────

export interface CargoCardProps {
  cargo: CargoListing
  viewerTier: SubscriptionTier
  onSelect?: (cargo: CargoListing) => void
  selected?: boolean
}

export interface VesselCardProps {
  availability: VesselAvailability
  viewerTier: SubscriptionTier
  onSelect?: (va: VesselAvailability) => void
  selected?: boolean
}
