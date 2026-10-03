// The handful of vessel facts the Suez calculator needs, and the two ways to
// get them: members from their own governed listings (VesselView carries the
// raw vessel id only for vessels they manage), admins from the master tables
// through the service role on the server (the page is admin-gated).
import type { VesselView } from "@/lib/portal/types";

export interface SuezVesselOption {
  /** listing / availability id — the picker value and the voyage-estimator hand-off */
  id: string;
  /** raw vessels.id when known; undefined → Manual facts only */
  vesselId?: string;
  name: string;
  imo: string;
  type: string;
  dwt: string;
  built: number | null;
  gt: number | null;
  scnrt: number | null;
}

export function suezOptionFromView(v: VesselView): SuezVesselOption {
  return { id: v.id, vesselId: v.vesselId, name: v.name, imo: v.imo, type: v.type, dwt: v.dwt, built: v.built, gt: v.gt ?? null, scnrt: v.scnrt ?? null };
}

export interface AdminVesselRow {
  id: string;
  vessel_id: string;
  vessel: { id: string; vessel_name: string | null; imo_number: string | null; vessel_type: string | null; dwt_grain: number | null; gross_tonnage: number | null; scnrt: number | null; build_year: number | null } | null;
}

export function suezOptionFromAdminRow(r: AdminVesselRow): SuezVesselOption | null {
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
  };
}
