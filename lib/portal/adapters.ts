// Adapters: Supabase row types (lib/schemas/*) → portal view models.
// These are the single boundary between the real data layer and the
// Claude-design UI, so wiring a page to live data is just:
//   const rows = await getCargos(supabase, filters);
//   const views = rows.map(toCargoView);

import {
  CargoListingRow,
  ZONE_LABELS,
  FT3LT_TO_M3T,
} from "@/lib/schemas/cargo";
import {
  MyVesselRow,
  VesselAvailabilityWithVessel,
} from "@/lib/schemas/vessel";
import { CargoView, VesselView, CargoScope, VesselStatusView } from "./types";

function portList(
  v: CargoListingRow["load_ports"],
): { locode: string; name: string; zone: string; status: string }[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const rows = v
    .filter((p) => p && p.locode)
    .map((p) => ({ locode: p.locode, name: p.name ?? "", zone: p.zone ?? "", status: p.status ?? "" }));
  return rows.length ? rows : undefined;
}

function daysFromNow(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return null;
  return Math.round((d - Date.now()) / 86_400_000);
}

function scopeFromStatus(status: CargoListingRow["status"]): CargoScope {
  switch (status) {
    case "IN":
      return "in";
    case "PARTIAL":
      return "partial";
    case "OUT":
      return "out";
    case "CLOSED":
      return "fixed";
    default:
      return "in";
  }
}

function imsbcGroup(row: CargoListingRow): string {
  if (row.is_dg_cargo) return "DG";
  if (row.is_grain_cargo) return "A";
  return "C";
}

const numFmt = new Intl.NumberFormat("en-US");

export function toCargoView(
  row: CargoListingRow,
  matches = 0,
): CargoView {
  // Stowage factor is stored in ft³/LT; the card shows m³/t.
  const sf =
    row.stowage_factor != null
      ? Math.round(row.stowage_factor * FT3LT_TO_M3T * 100) / 100
      : null;

  return {
    id: row.id,
    refId: row.ref ?? row.id.slice(0, 8).toUpperCase(),
    cargo: row.commodity_name,
    commodity: row.commodity_name,
    type: row.cargo_type,
    scope: scopeFromStatus(row.status),
    route: {
      polName: row.load_port_name,
      polCode: row.load_port_locode,
      polZone: ZONE_LABELS[row.load_zone] ? row.load_zone : row.load_zone,
      podName: row.disch_port_name,
      podCode: row.disch_port_locode,
      podZone: row.disch_zone,
    },
    loadPorts: portList(row.load_ports),
    dischPorts: portList(row.disch_ports),
    qty: { min: row.qty_min_mt, max: row.qty_max_mt },
    qtyMt: numFmt.format(row.qty_max_mt),
    vol: row.volume_cbm != null ? numFmt.format(row.volume_cbm) : "—",
    volUnit: "m³",
    sf,
    imsbcGroup: imsbcGroup(row),
    laycanFrom: row.laycan_from ?? "",
    laycanTo: row.laycan_to ?? "",
    laycanDays: daysFromNow(row.laycan_from),
    loadTerms: row.load_terms,
    loadRate: row.load_rate,
    dischRate: row.disch_rate,
    freightIdea: row.freight_idea_usd_mt,
    commission: row.commission_ttl_pct ?? row.commission_pct,
    demurrage: row.demurrage_rate,
    matches,
    spot: row.is_spot,
    forCirculation: row.review_status === "APPROVED",
    partnerSlug: row.broker,
    requiresGeared: row.requires_geared,
    maxAge: row.max_vessel_age_yr,
    maxLoa: row.max_loa_m,
    maxDraft: row.max_draft_m,
    isGrain: row.is_grain_cargo,
    isDg: row.is_dg_cargo,
  };
}

const meters = (n: number | null | undefined) => (n != null ? `${n} m` : undefined);

function urgencyFromDays(days: number | null): "red" | "amber" | "green" {
  if (days == null) return "green";
  if (days < 0) return "red";
  if (days <= 7) return "amber";
  return "green";
}

const YEAR = new Date().getFullYear();

export function vesselFromAvailability(
  row: VesselAvailabilityWithVessel,
  matches = 0,
): VesselView {
  const v = row.vessel;
  const days = daysFromNow(row.open_date);
  // Prod stores explicit fuel columns (vlsfo/lsmgo sea+port), not me/aux _port.
  const pf = row as unknown as {
    vlsfo_sea_mt_day?: number | null;
    vlsfo_port_mt_day?: number | null;
    lsmgo_sea_mt_day?: number | null;
    lsmgo_port_mt_day?: number | null;
  };
  return {
    id: row.id,
    name: v.vessel_name,
    imo: v.imo_number ?? "—",
    type: v.vessel_type,
    flag: v.flag ?? "—",
    dwt: v.dwt_grain != null ? numFmt.format(v.dwt_grain) : "—",
    grainCap: v.grain_cbm != null ? numFmt.format(v.grain_cbm) : "—",
    built: v.build_year,
    age: v.build_year ? YEAR - v.build_year : null,
    geared: v.is_geared,
    grainCertified: v.grain_certified,
    dgCertified: v.dg_certified,
    openPort: row.open_port_name ?? "—",
    openPortLocode: row.open_port_locode,
    openPortZone: row.open_zone ?? "—",
    openDate: row.open_date ?? "—",
    openDateUrgency: urgencyFromDays(days),
    openDateDays: days,
    status: statusFromAvailability(row.status),
    matches,
    fuel: {
      vlsfoSea: pf.vlsfo_sea_mt_day ?? "—",
      vlsfoPort: pf.vlsfo_port_mt_day ?? "—",
      lsmgoSea: pf.lsmgo_sea_mt_day ?? "—",
      lsmgoPort: pf.lsmgo_port_mt_day ?? "—",
    },
    draft: meters(v.max_draft_m),
    preferredZones: v.preferred_zones,
    serviceSpeed: row.service_speed_kn,
    fuelType: row.fuel_type,
    openDateRangeDays: row.open_date_range_days,
    lastCargo: row.last_cargo,
    acceptsPartCargo: row.accepts_part_cargo,
  };
}

function statusFromAvailability(
  status: VesselAvailabilityWithVessel["status"],
): VesselStatusView {
  if (status === "OPEN") return "open";
  if (status === "FIXED") return "fixed";
  return "review";
}

export function vesselFromMyVessel(row: MyVesselRow): VesselView {
  return {
    id: row.id,
    name: row.vessel_name,
    imo: row.imo_number ?? "—",
    type: row.vessel_type,
    flag: row.flag ?? "—",
    dwt: row.dwt_grain != null ? numFmt.format(row.dwt_grain) : "—",
    grainCap: row.grain_cbm != null ? numFmt.format(row.grain_cbm) : "—",
    built: row.build_year,
    age: row.build_year ? YEAR - row.build_year : null,
    geared: row.is_geared,
    grainCertified: row.grain_certified,
    dgCertified: row.dg_certified,
    openPort: row.open_port_name ?? "—",
    openPortLocode: row.open_port_locode,
    openPortZone: row.open_zone ?? "—",
    openDate: row.open_date ?? "—",
    openDateUrgency: urgencyFromDays(daysFromNow(row.open_date)),
    openDateDays: daysFromNow(row.open_date),
    status: row.open_availability_count > 0 ? "open" : "review",
    matches: 0,
    fuel: { vlsfoSea: "—", vlsfoPort: "—", lsmgoSea: "—", lsmgoPort: "—" },
    dwtBale: row.dwt_bale != null ? numFmt.format(row.dwt_bale) : undefined,
    loa: meters(row.max_loa_m),
    beam: meters(row.beam_m),
    draft: meters(row.max_draft_m),
    preferredZones: row.preferred_zones,
  };
}
