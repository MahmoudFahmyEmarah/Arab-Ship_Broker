// View models for the detail-panel match list, mapped from governed market
// rows. Their ids are opaque listing keys, never listing/vessel primary keys.
import {
  marketBoardKey,
  type MarketCargoRow,
  type MarketVesselRow,
} from "@/sdk/app/market";
import { stripVesselNamePrefix } from "@/lib/schemas/vessel";

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

function rateAligned(fit: unknown): boolean {
  return Boolean(
    fit &&
      typeof fit === "object" &&
      (fit as { rate_aligned?: unknown }).rate_aligned,
  );
}

export function toMatchVessel(r: MarketVesselRow): MatchVesselView {
  return {
    id: marketBoardKey(r),
    name: stripVesselNamePrefix(r.vessel.vessel_name),
    type: r.vessel.vessel_type,
    dwt: r.vessel.dwt_grain,
    flag: r.vessel.flag,
    built: r.vessel.build_year,
    openPort: r.open_port_name ?? "—",
    openZone: r.open_zone ?? "—",
    openDate: r.open_date,
    freight: r.freight_idea_usd_mt,
    rateAligned: rateAligned(r.fit),
    geared: r.vessel.is_geared,
  };
}

export function toMatchCargo(r: MarketCargoRow): MatchCargoView {
  return {
    id: marketBoardKey(r),
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
    rateAligned: rateAligned(r.fit),
  };
}
