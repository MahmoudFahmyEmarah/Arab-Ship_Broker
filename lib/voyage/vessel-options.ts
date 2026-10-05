// Vessel facts the Voyage estimator needs from a current position: identity,
// Suez tonnages, the open port (ballast leg origin) and whatever consumption
// the listing already declares (the economics profile wins when it exists).
import type { SuezVesselOption } from "@/lib/suez/vessel-options";
import type { VesselView } from "@/lib/portal/types";
import type { ConsumptionMap } from "./types";

export interface VoyageVesselOption extends SuezVesselOption {
  openPortLocode: string | null;
  openPortName: string | null;
  openZone: string | null;
  serviceSpeedKn: number | null;
  listingConsumption: ConsumptionMap; // derived from the availability's columns
  scrubberFitted: boolean | null;
}

export interface AdminVoyageVesselRow {
  id: string;
  vessel_id: string;
  open_port_locode: string | null;
  open_port_name: string | null;
  open_zone: string | null;
  service_speed_kn: number | null;
  vlsfo_sea_mt_day: number | null;
  vlsfo_port_mt_day: number | null;
  lsmgo_sea_mt_day: number | null;
  lsmgo_port_mt_day: number | null;
  me_consumption_mt_day: number | null;
  me_consumption_port_mt_day: number | null;
  aux_consumption_mt_day: number | null;
  aux_consumption_port_mt_day: number | null;
  scrubber_fitted: boolean | null;
  vessel: { id: string; vessel_name: string | null; imo_number: string | null; vessel_type: string | null; dwt_grain: number | null; gross_tonnage: number | null; scnrt: number | null; build_year: number | null } | null;
}

const n = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

// The listing declares at most sea/port figures; the estimator's six states
// start from them and the member refines in the profile.
export function consumptionFromListing(r: AdminVoyageVesselRow): ConsumptionMap {
  const seaRes = n(r.vlsfo_sea_mt_day) ?? n(r.me_consumption_mt_day);
  const seaDis = n(r.lsmgo_sea_mt_day) ?? n(r.aux_consumption_mt_day);
  const portRes = n(r.vlsfo_port_mt_day) ?? n(r.me_consumption_port_mt_day);
  const portDis = n(r.lsmgo_port_mt_day) ?? n(r.aux_consumption_port_mt_day);
  const out: ConsumptionMap = {};
  if (seaRes != null || seaDis != null) out.sea_laden = { residual: seaRes, distillate: seaDis };
  if (portRes != null || portDis != null) out.port_working = { residual: portRes, distillate: portDis };
  return out;
}

export function voyageOptionFromAdminRow(r: AdminVoyageVesselRow): VoyageVesselOption | null {
  const v = r.vessel;
  if (!v) return null;
  return {
    id: r.id,
    vesselId: v.id,
    name: v.vessel_name ?? "Unnamed vessel",
    imo: v.imo_number ?? "—",
    type: v.vessel_type ?? "",
    dwt: v.dwt_grain != null ? Number(v.dwt_grain).toLocaleString("en-US") : "—",
    built: v.build_year ?? null,
    gt: v.gross_tonnage ?? null,
    scnrt: v.scnrt ?? null,
    openPortLocode: r.open_port_locode,
    openPortName: r.open_port_name,
    openZone: r.open_zone,
    serviceSpeedKn: n(r.service_speed_kn),
    listingConsumption: consumptionFromListing(r),
    scrubberFitted: r.scrubber_fitted,
  };
}

// A member's own position from the governed member read: the listing id is real for an owned row, the raw vessel id
// is present only for vessels the member manages. Consumption comes from the economics profile, not the view.
export function voyageOptionFromView(v: VesselView): VoyageVesselOption {
  return {
    id: v.id, vesselId: v.vesselId, name: v.name, imo: v.imo, type: v.type, dwt: v.dwt, built: v.built, gt: v.gt ?? null, scnrt: v.scnrt ?? null,
    openPortLocode: v.openPortLocode ?? null, openPortName: v.openPort || null, openZone: v.openPortZone || null,
    serviceSpeedKn: null, listingConsumption: {}, scrubberFitted: null,
  };
}
