// Preview data, typed as the REAL Supabase row type (CargoListingRow) so the
// adapter + card are validated against the production schema at compile time.
// In live wiring this array is replaced by `await getCargos(supabase, filters)`.
import { CargoListingRow } from "@/lib/schemas/cargo";

function makeCargo(p: Partial<CargoListingRow> & Pick<CargoListingRow, "id">): CargoListingRow {
  return {
    ref: null,
    status: "IN",
    review_status: "APPROVED",
    goes_live_at: null,
    cargo_type: "Dry Bulk",
    commodity_id: "00000000-0000-0000-0000-000000000000",
    commodity_name: "Wheat",
    is_dg_cargo: false,
    is_grain_cargo: false,
    qty_min_mt: 3000,
    qty_max_mt: 3000,
    stowage_factor: 44,
    volume_cbm: 3750,
    load_port_locode: "EGALY",
    load_port_name: "Alexandria",
    load_zone: "E.MED",
    load_country: "Egypt",
    disch_port_locode: "SAJED",
    disch_port_name: "Jeddah",
    disch_zone: "R.SEA",
    disch_country: "Saudi Arabia",
    laycan_from: null,
    laycan_to: null,
    is_spot: false,
    nor_clause: null,
    load_rate: 1200,
    disch_rate: 1200,
    load_terms: "FIOST",
    laytime_basis: null,
    freight_basis: null,
    freight_idea_usd_mt: 45,
    commission_pct: null,
    commission_ttl_pct: 2.5,
    iac_flag: null,
    demurrage_rate: 18000,
    despatch_rate: null,
    despatch_basis: null,
    tolerance_pct: null,
    tolerance_holder: null,
    disport_status: null,
    packaging_type: null,
    bag_weight_kg: null,
    requires_geared: null,
    max_vessel_age_yr: null,
    max_loa_m: null,
    max_draft_m: null,
    broker: null,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...p,
  };
}

const today = new Date();
const plus = (d: number) => {
  const x = new Date(today);
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
};

export const MOCK_CARGOS: CargoListingRow[] = [
  makeCargo({
    id: "CK-001", ref: "CK-001", commodity_name: "Wheat (Bulk)", is_grain_cargo: true, broker: "navigrains",
    laycan_from: plus(13), laycan_to: plus(18),
  }),
  makeCargo({
    id: "CK-002", ref: "CK-002", commodity_name: "Steel Coils", cargo_type: "Break Bulk", broker: "satirbroke",
    status: "PARTIAL", qty_min_mt: 5000, qty_max_mt: 5000, stowage_factor: 12,
    load_port_locode: "ROCND", load_port_name: "Constanta", load_zone: "B.SEA", load_country: "Romania",
    disch_port_locode: "JOAQJ", disch_port_name: "Aqaba", disch_zone: "R.SEA", disch_country: "Jordan",
    load_terms: "FIO", load_rate: 850, disch_rate: 900, freight_idea_usd_mt: 65, commission_ttl_pct: 3.75,
    laycan_from: plus(20), laycan_to: plus(26),
  }),
  makeCargo({
    id: "CK-003", ref: "CK-003", commodity_name: "Phosphate Rock", is_dg_cargo: true,
    qty_min_mt: 9000, qty_max_mt: 9000, stowage_factor: 33,
    load_port_locode: "JOAQJ", load_port_name: "Aqaba", load_zone: "R.SEA", load_country: "Jordan",
    disch_port_locode: "INMUM", disch_port_name: "Mumbai", disch_zone: "A.SEA", disch_country: "India",
    load_terms: "FIOST", load_rate: 2500, disch_rate: 2200, freight_idea_usd_mt: 38, commission_ttl_pct: 2.5,
    laycan_from: plus(1), laycan_to: plus(10),
  }),
  makeCargo({
    id: "CK-004", ref: "CK-004", commodity_name: "Urea (Bagged)", cargo_type: "Break Bulk", status: "OUT",
    qty_min_mt: 3500, qty_max_mt: 3500, stowage_factor: 55, packaging_type: "Bagged",
    load_port_locode: "AEJEA", load_port_name: "Jebel Ali", load_zone: "AG", load_country: "UAE",
    disch_port_locode: "TZDAR", disch_port_name: "Dar es Salaam", disch_zone: "ECAF", disch_country: "Tanzania",
    load_terms: "Liner Terms", load_rate: 450, disch_rate: 400, freight_idea_usd_mt: 52, commission_ttl_pct: 5,
    laycan_from: plus(2), laycan_to: plus(5),
  }),
  makeCargo({
    id: "CK-005", ref: "CK-005", commodity_name: "Clinker", broker: "medshipping", qty_min_mt: 6000, qty_max_mt: 6000, stowage_factor: 30,
    load_port_locode: "TRIST", load_port_name: "Istanbul", load_zone: "B.SEA", load_country: "Turkey",
    disch_port_locode: "EGALY", disch_port_name: "Alexandria", disch_zone: "E.MED", disch_country: "Egypt",
    load_terms: "FIOST", load_rate: 1800, disch_rate: 1600, freight_idea_usd_mt: 28, commission_ttl_pct: 2.5,
    laycan_from: plus(5), laycan_to: plus(15),
  }),
  makeCargo({
    id: "CK-006", ref: "CK-006", commodity_name: "Marble Blocks", cargo_type: "Break Bulk", broker: "gulfsea",
    qty_min_mt: 1750, qty_max_mt: 1750, stowage_factor: 15,
    load_port_locode: "TRIZM", load_port_name: "Izmir", load_zone: "E.MED", load_country: "Turkey",
    disch_port_locode: "SAJED", disch_port_name: "Jeddah", disch_zone: "R.SEA", disch_country: "Saudi Arabia",
    load_terms: "FIO", load_rate: 300, disch_rate: 280, freight_idea_usd_mt: 72, commission_ttl_pct: 2.5,
    laycan_from: plus(1), laycan_to: plus(3),
  }),
];

// ── Vessels (typed as the real VesselAvailabilityWithVessel) ───────────────
import { VesselAvailabilityWithVessel } from "@/lib/schemas/vessel";

type VesselSeed = {
  id: string;
  name: string;
  imo: string;
  type: VesselAvailabilityWithVessel["vessel"]["vessel_type"];
  flag: string;
  dwt: number;
  grainCbm: number;
  built: number;
  geared: boolean;
  grainCert: boolean;
  dgCert: boolean;
  openPort: string;
  locode: string;
  zone: VesselAvailabilityWithVessel["open_zone"];
  openDate: string;
  status: VesselAvailabilityWithVessel["status"];
  me: number;
  mePort: number;
  aux: number;
  auxPort: number;
  matches?: number;
};

function makeVessel(s: VesselSeed): VesselAvailabilityWithVessel {
  return {
    id: s.id,
    ref: s.id,
    vessel_id: `vsl-${s.id}`,
    open_port_locode: s.locode,
    open_port_name: s.openPort,
    ballast_port_locode: null,
    ballast_port_name: null,
    open_zone: s.zone,
    open_date: s.openDate,
    open_date_range_days: 7,
    last_cargo: null,
    service_speed_kn: 12,
    me_consumption_mt_day: s.me,
    me_consumption_port_mt_day: s.mePort,
    aux_consumption_mt_day: s.aux,
    aux_consumption_port_mt_day: s.auxPort,
    fuel_type: "VLSFO",
    freight_idea_usd_mt: null,
    accepts_part_cargo: false,
    grab_type: null,
    grab_capacity_mt: null,
    num_grabs: null,
    brob_mt: null,
    status: s.status,
    review_status: "APPROVED",
    goes_live_at: null,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    vessel: {
      vessel_name: s.name,
      imo_number: s.imo,
      vessel_type: s.type,
      dwt_grain: s.dwt,
      grain_cbm: s.grainCbm,
      bale_cbm: Math.round(s.grainCbm * 0.96),
      build_year: s.built,
      flag: s.flag,
      scope: "In Scope",
      risk_level: "CLEAR",
      is_sanctioned: false,
      is_geared: s.geared,
      grain_certified: s.grainCert,
      dg_certified: s.dgCert,
      max_draft_m: 10.2,
      preferred_zones: [s.zone].filter(Boolean) as VesselAvailabilityWithVessel["vessel"]["preferred_zones"],
    },
  };
}

export const MOCK_VESSELS: VesselAvailabilityWithVessel[] = [
  makeVessel({ id: "V001", name: "MV OCEAN PRIDE", imo: "9200001", type: "Bulk Carrier", flag: "Malta", dwt: 32500, grainCbm: 41000, built: 2010, geared: true, grainCert: true, dgCert: false, openPort: "Novorossiysk", locode: "RUNVS", zone: "B.SEA", openDate: plus(22), status: "OPEN", me: 18.5, mePort: 2.8, aux: 0.5, auxPort: 0.3, matches: 7 }),
  makeVessel({ id: "V002", name: "MV SEA NAVIGATOR", imo: "9200002", type: "Bulk Carrier", flag: "Liberia", dwt: 56800, grainCbm: 68500, built: 2015, geared: false, grainCert: true, dgCert: false, openPort: "Damietta", locode: "EGDAM", zone: "E.MED", openDate: plus(8), status: "OPEN", me: 24.2, mePort: 3.5, aux: 0.6, auxPort: 0.4, matches: 12 }),
  makeVessel({ id: "V003", name: "MV TRADE WINDS", imo: "9200003", type: "Bulk Carrier", flag: "Panama", dwt: 45000, grainCbm: 52000, built: 2012, geared: false, grainCert: true, dgCert: false, openPort: "Alexandria", locode: "EGALY", zone: "E.MED", openDate: plus(5), status: "OPEN", me: 21.0, mePort: 3.2, aux: 0.6, auxPort: 0.4, matches: 9 }),
  makeVessel({ id: "V004", name: "MV BALTIC STAR", imo: "9200004", type: "Bulk Carrier", flag: "Marshall Is.", dwt: 35000, grainCbm: 35800, built: 2003, geared: true, grainCert: false, dgCert: false, openPort: "Constanta", locode: "ROCND", zone: "B.SEA", openDate: plus(-10), status: "FIXED", me: 19.5, mePort: 3.0, aux: 0.5, auxPort: 0.3, matches: 5 }),
  makeVessel({ id: "V005", name: "MV LEVANT PEARL", imo: "9200005", type: "General Cargo", flag: "Cyprus", dwt: 8500, grainCbm: 9200, built: 2008, geared: true, grainCert: false, dgCert: false, openPort: "Beirut", locode: "LBBEY", zone: "E.MED", openDate: plus(12), status: "OPEN", me: 12.0, mePort: 2.0, aux: 0.4, auxPort: 0.2, matches: 3 }),
  makeVessel({ id: "V006", name: "MV EASTERN VENTURE", imo: "9200006", type: "Bulk Carrier", flag: "Singapore", dwt: 58000, grainCbm: 70000, built: 2018, geared: false, grainCert: true, dgCert: true, openPort: "Port Said", locode: "EGPSD", zone: "E.MED", openDate: plus(17), status: "OPEN", me: 23.5, mePort: 3.5, aux: 0.45, auxPort: 0.3, matches: 8 }),
];
