// View models for the detail-panel match list, mapped from the match RPC
// result rows (CargoMatchResult / VesselMatchResult).
import type { CargoMatchResult } from "@/sdk/app/cargos";
import type { VesselMatchResult } from "@/lib/schemas/vessel";

// A vessel that matches a cargo (shown in the cargo detail panel).
export interface MatchVesselView {
  id: string;
  name: string;
  type: string;
  dwt: number | null;
  flag: string | null;
  built: number | null;
  openPort: string;
  openZone: string;
  openDate: string | null;
  freight: number | null;
  rateAligned: boolean;
  geared: boolean | null;
}

// A cargo that matches a vessel position (shown in the vessel detail panel).
export interface MatchCargoView {
  id: string;
  commodity: string;
  type: string;
  qtyMin: number;
  qtyMax: number;
  loadPort: string;
  loadZone: string;
  dischPort: string;
  dischZone: string;
  laycanFrom: string | null;
  laycanTo: string | null;
  isSpot: boolean;
  freight: number | null;
  rateAligned: boolean;
}

export function toMatchVessel(r: CargoMatchResult): MatchVesselView {
  return {
    id: r.availability_id,
    name: r.vessel_name,
    type: r.vessel_type,
    dwt: r.dwt_grain,
    flag: r.flag,
    built: r.build_year,
    openPort: r.open_port_name,
    openZone: r.open_zone,
    openDate: r.open_date,
    freight: r.freight_idea_usd_mt,
    rateAligned: r.is_rate_aligned,
    geared: r.is_geared,
  };
}

export function toMatchCargo(r: VesselMatchResult): MatchCargoView {
  return {
    id: r.cargo_id,
    commodity: r.commodity_name,
    type: r.cargo_type,
    qtyMin: r.qty_min_mt,
    qtyMax: r.qty_max_mt,
    loadPort: r.load_port_name,
    loadZone: r.load_zone,
    dischPort: r.disch_port_name,
    dischZone: r.disch_zone,
    laycanFrom: r.laycan_from,
    laycanTo: r.laycan_to,
    isSpot: r.is_spot,
    freight: r.freight_idea_usd_mt,
    rateAligned: r.is_rate_aligned,
  };
}
