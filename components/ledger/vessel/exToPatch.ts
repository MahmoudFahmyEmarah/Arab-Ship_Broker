// Post Vessel — map a real parser extract (/api/circulars/parse, circular text
// or Q88) into ledger state. Same contract as the prototype's PP2exToPatch.

import type { ParsedCargo, ParsedVessel } from "@/lib/circulars/types";
import type { VesselState } from "./state";

type Extract = ParsedCargo & ParsedVessel;

const fmtNum = (n?: number | null) => (n == null ? null : n.toLocaleString("en-US"));

export function vesselExRows(ex: Extract): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (ex.vessel_name) rows.push({ label: "Vessel", value: ex.vessel_name + (ex.imo_number ? " · IMO " + ex.imo_number : "") });
  if (ex.vessel_type) rows.push({ label: "Type", value: ex.vessel_type });
  if (ex.dwt_grain) rows.push({ label: "DWT", value: fmtNum(ex.dwt_grain) + " MT" });
  if (ex.build_year) rows.push({ label: "Built", value: String(ex.build_year) });
  if (ex.flag) rows.push({ label: "Flag", value: ex.flag });
  if (ex.is_geared != null) rows.push({ label: "Gear", value: ex.is_geared ? (ex.crane_count ? ex.crane_count + " cranes" : "Geared") + (ex.crane_swl_mt ? " × " + ex.crane_swl_mt + " MT" : "") : "Gearless" });
  if (ex.open_port_name || ex.open_port_locode) rows.push({ label: "Open", value: (ex.open_port_name || ex.open_port_locode || "") + (ex.open_date ? " from " + ex.open_date : "") });
  if (ex.service_speed_kn) rows.push({ label: "Speed", value: ex.service_speed_kn + " kn" });
  if (ex.last_cargo) rows.push({ label: "Last cargo", value: ex.last_cargo });
  return rows;
}

export function vesselExToPatch(ex: Extract, state: VesselState): Partial<VesselState> {
  const patch: Partial<VesselState> = {};

  if (ex.vessel_name || ex.imo_number || ex.dwt_grain) {
    patch.entryMode = "search";
    patch.vessel = {
      ...(state.vessel ?? {}),
      ...(ex.vessel_name ? { name: ex.vessel_name.toUpperCase() } : {}),
      ...(ex.imo_number ? { imo: ex.imo_number } : {}),
      ...(ex.vessel_type ? { type: ex.vessel_type === "Other" ? "General Cargo" : ex.vessel_type } : {}),
      ...(ex.dwt_grain ? { dwt: ex.dwt_grain } : {}),
      ...(ex.build_year ? { built: String(ex.build_year) } : {}),
      ...(ex.flag ? { flag: ex.flag } : {}),
      ...(ex.gross_tonnage ? { grt: ex.gross_tonnage } : {}),
      ...(ex.max_loa_m ? { loa: ex.max_loa_m } : {}),
      ...(ex.max_draft_m ? { draft: ex.max_draft_m } : {}),
      verified: state.vessel?.verified ?? false,
      source: "Circular / Q88 via Bosun",
    };
    if (ex.imo_number) patch.vesselImo = ex.imo_number;
  }

  if (ex.is_geared != null || ex.crane_count || ex.crane_swl_mt) {
    patch.gear = {
      ...(state.gear ?? {}),
      ...(ex.is_geared != null ? { geared: !!ex.is_geared } : {}),
      ...(ex.crane_count ? { craneCount: String(ex.crane_count) } : {}),
      ...(ex.crane_swl_mt ? { craneSwl: String(ex.crane_swl_mt) } : {}),
      _source: "user",
    };
  }

  if (ex.open_port_locode || ex.open_port_name || ex.open_date) {
    patch.availability = {
      ...(state.availability ?? {}),
      ...(ex.open_port_locode || ex.open_port_name
        ? {
            openPort: {
              locode: (ex.open_port_locode ?? "").replace(/\s+/g, "").toUpperCase(),
              name: ex.open_port_name || ex.open_port_locode || "",
              zone: ex.open_zone ?? null,
            },
          }
        : {}),
      ...(ex.open_date ? { openFrom: ex.open_date } : {}),
      status: state.availability?.status ?? "Open",
    };
  }

  if (ex.service_speed_kn || ex.vlsfo_sea_mt_day) {
    patch.performance = {
      ...(state.performance ?? {}),
      ...(ex.service_speed_kn ? { serviceSpeed: String(ex.service_speed_kn) } : {}),
      ...(ex.vlsfo_sea_mt_day ? { meConsSea: String(ex.vlsfo_sea_mt_day), fuelType: state.performance?.fuelType ?? "VLSFO" } : {}),
      _source: "user",
    };
  }

  return patch;
}
