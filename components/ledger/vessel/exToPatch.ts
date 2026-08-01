// Post Vessel — map a real parser extract (/api/circulars/parse, circular text
// or Q88 PDF/Excel) into ledger state. Same contract as the prototype's
// PP2exToPatch, now covering the full Q88 depth: identity, arrangement, gear,
// ownership chain, performance and the open position.

import type { ParsedCargo, ParsedVessel } from "@/lib/circulars/types";
import { LEDGER_ENUMS } from "../defs";
import type { VesselState } from "./state";

type Extract = ParsedCargo & ParsedVessel;

const fmtNum = (n?: number | null) => (n == null ? null : n.toLocaleString("en-US"));
const ynStr = (v?: boolean | null): string | null => (v == null ? null : v ? "Y" : "N");

const normHatchType = (v?: string | null): string | null => {
  const s = (v ?? "").toLowerCase();
  return LEDGER_ENUMS.hatchType.find((h) => s.includes(h.replace("-", " ")) || s.includes(h)) ?? null;
};

const normCharterType = (v?: string | null): string | null => {
  const s = (v ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/BARE ?BOAT|\bBB\b/.test(s)) return "Bareboat";
  if (/TCT|TC TRIP|TIME CHARTER TRIP/.test(s)) return "TCT";
  if (/T\/?C LONG|LONG/.test(s)) return "T/C long";
  if (/T\/?C|TIME CHARTER/.test(s)) return "T/C short";
  if (/V\/?C|VOYAGE/.test(s)) return "V/C";
  return null;
};

const normFuelType = (v?: string | null): string | null => {
  const s = (v ?? "").toUpperCase();
  return LEDGER_ENUMS.fuelType.find((f) => s.includes(f.toUpperCase())) ?? null;
};

export function vesselExRows(ex: Extract): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (ex.vessel_name) rows.push({ label: "Vessel", value: ex.vessel_name + (ex.imo_number ? " · IMO " + ex.imo_number : "") });
  if (ex.vessel_type) rows.push({ label: "Type", value: ex.vessel_type });
  if (ex.dwt_grain) rows.push({ label: "DWT", value: fmtNum(ex.dwt_grain) + " MT" });
  if (ex.build_year) rows.push({ label: "Built", value: String(ex.build_year) });
  if (ex.flag) rows.push({ label: "Flag", value: ex.flag + (ex.class_society ? " · class " + ex.class_society : "") });
  if (ex.max_loa_m || ex.beam_m || ex.max_draft_m)
    rows.push({
      label: "Dims",
      value: [ex.max_loa_m ? "LOA " + ex.max_loa_m + "m" : null, ex.beam_m ? "beam " + ex.beam_m + "m" : null, ex.max_draft_m ? "draft " + ex.max_draft_m + "m" : null]
        .filter(Boolean)
        .join(" · "),
    });
  if (ex.gross_tonnage || ex.scnrt)
    rows.push({ label: "Tonnage", value: [ex.gross_tonnage ? "GT " + fmtNum(ex.gross_tonnage) : null, ex.scnrt ? "SCNT " + fmtNum(ex.scnrt) : null].filter(Boolean).join(" · ") });
  if (ex.num_holds || ex.hatch_type || ex.box_shaped != null)
    rows.push({
      label: "Arrangement",
      value: [
        ex.num_holds ? ex.num_holds + "HO" + (ex.num_hatches ? "/" + ex.num_hatches + "HA" : "") : null,
        ex.box_shaped != null ? (ex.box_shaped ? "box-shaped" : "not box-shaped") : null,
        ex.hatch_type || null,
        ex.strengthened_heavy ? "heavy-strengthened" : null,
        ex.log_fitted ? "log-fitted" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  if (ex.is_geared != null)
    rows.push({
      label: "Gear",
      value: ex.is_geared
        ? [(ex.crane_count ? ex.crane_count + " cranes" : "Geared") + (ex.crane_swl_mt ? " × " + ex.crane_swl_mt + " MT" : ""), ex.num_grabs ? ex.num_grabs + " grabs" : null]
            .filter(Boolean)
            .join(" · ")
        : "Gearless",
    });
  if (ex.grain_cbm || ex.bale_cbm)
    rows.push({ label: "Capacity", value: [ex.grain_cbm ? "grain " + fmtNum(ex.grain_cbm) + " m³" : null, ex.bale_cbm ? "bale " + fmtNum(ex.bale_cbm) + " m³" : null].filter(Boolean).join(" · ") });
  if (ex.registered_owner || ex.commercial_operator)
    rows.push({ label: "Ownership", value: [ex.registered_owner, ex.commercial_operator].filter(Boolean).join(" / ") });
  if (ex.open_port_name || ex.open_port_locode) rows.push({ label: "Open", value: (ex.open_port_name || ex.open_port_locode || "") + (ex.open_date ? " from " + ex.open_date : "") });
  if (ex.charter_type) rows.push({ label: "Charter", value: ex.charter_type });
  if (ex.service_speed_kn || ex.vlsfo_sea_mt_day)
    rows.push({
      label: "Performance",
      value: [ex.service_speed_kn ? ex.service_speed_kn + " kn" : null, ex.vlsfo_sea_mt_day ? ex.vlsfo_sea_mt_day + " MT/d sea" : null, ex.brob_mt ? "BROB " + ex.brob_mt + " MT" : null]
        .filter(Boolean)
        .join(" · "),
    });
  if (ex.last_cargo) rows.push({ label: "Last cargo", value: ex.last_cargo });
  return rows;
}

export function vesselExToPatch(ex: Extract, state: VesselState): Partial<VesselState> {
  const patch: Partial<VesselState> = {};

  if (ex.vessel_name || ex.imo_number || ex.dwt_grain) {
    patch.entryMode = "search";
    patch.vessel = {
      ...(state.vessel ?? {}),
      ...(ex.vessel_name ? { name: ex.vessel_name.replace(/^M\/?V\s+/i, "").toUpperCase() } : {}),
      ...(ex.imo_number ? { imo: ex.imo_number } : {}),
      ...(ex.vessel_type ? { type: ex.vessel_type === "Other" ? "General Cargo" : ex.vessel_type } : {}),
      ...(ex.dwt_grain ? { dwt: ex.dwt_grain } : {}),
      ...(ex.build_year ? { built: String(ex.build_year) } : {}),
      ...(ex.flag ? { flag: ex.flag } : {}),
      ...(ex.class_society ? { classSociety: ex.class_society } : {}),
      ...(ex.gross_tonnage ? { grt: ex.gross_tonnage } : {}),
      ...(ex.max_loa_m ? { loa: ex.max_loa_m } : {}),
      ...(ex.beam_m ? { beam: ex.beam_m } : {}),
      ...(ex.max_draft_m ? { draft: ex.max_draft_m } : {}),
      // ownership & operation chain (Q88 §1)
      ...(ex.registered_owner ? { regOwner: ex.registered_owner } : {}),
      ...(ex.parent_group ? { parentGroup: ex.parent_group } : {}),
      ...(ex.technical_operator ? { ismManager: ex.technical_operator } : {}),
      ...(ex.commercial_operator ? { manager: ex.commercial_operator } : {}),
      ...(ex.disponent_owner ? { disponentOwner: ex.disponent_owner } : {}),
      verified: state.vessel?.verified ?? false,
      source: "Circular / Q88 via Bosun",
    };
    if (ex.imo_number) patch.vesselImo = ex.imo_number;
  }

  if (ex.num_holds || ex.num_hatches || ex.box_shaped != null || ex.hatch_type || ex.strengthened_heavy != null || ex.holds_may_be_empty || ex.log_fitted != null) {
    patch.arrangement = {
      ...(state.arrangement ?? {}),
      ...(ex.num_holds ? { numHolds: String(ex.num_holds) } : {}),
      ...(ex.num_hatches ? { numHatches: String(ex.num_hatches) } : {}),
      ...(ex.box_shaped != null ? { boxShaped: ynStr(ex.box_shaped) } : {}),
      ...(normHatchType(ex.hatch_type) ? { hatchType: normHatchType(ex.hatch_type) } : {}),
      ...(ex.strengthened_heavy != null ? { strengthenedHeavy: ynStr(ex.strengthened_heavy) } : {}),
      ...(ex.holds_may_be_empty ? { holdsMayBeEmpty: "Y" } : {}),
      ...(ex.log_fitted != null ? { logFitted: ynStr(ex.log_fitted) } : {}),
      _source: "user",
    };
  }

  if (ex.is_geared != null || ex.crane_count || ex.crane_swl_mt || ex.num_grabs || ex.grab_capacity_mt || ex.kick_plate != null) {
    patch.gear = {
      ...(state.gear ?? {}),
      ...(ex.is_geared != null ? { geared: !!ex.is_geared } : {}),
      ...(ex.crane_count ? { craneCount: String(ex.crane_count), geared: true } : {}),
      ...(ex.crane_swl_mt ? { craneSwl: String(ex.crane_swl_mt) } : {}),
      ...(ex.num_grabs ? { grabs: true, numGrabs: String(ex.num_grabs) } : {}),
      ...(ex.grab_capacity_mt ? { grabCapacity: String(ex.grab_capacity_mt) } : {}),
      ...(ex.kick_plate != null ? { kickPlate: !!ex.kick_plate } : {}),
      _source: "user",
    };
  }

  if (ex.open_port_locode || ex.open_port_name || ex.open_date || ex.charter_type) {
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
      ...(normCharterType(ex.charter_type) ? { charterType: normCharterType(ex.charter_type) } : {}),
      status: state.availability?.status ?? "Open",
    };
  }

  if (ex.service_speed_kn || ex.vlsfo_sea_mt_day || ex.lsmgo_sea_mt_day || ex.me_cons_port_mt_day || ex.aux_cons_port_mt_day || ex.brob_mt || ex.fuel_type || ex.scrubber_fitted != null) {
    patch.performance = {
      ...(state.performance ?? {}),
      ...(ex.service_speed_kn ? { serviceSpeed: String(ex.service_speed_kn) } : {}),
      ...(ex.vlsfo_sea_mt_day ? { meConsSea: String(ex.vlsfo_sea_mt_day) } : {}),
      ...(ex.me_cons_port_mt_day ? { meConsPort: String(ex.me_cons_port_mt_day) } : {}),
      ...(ex.aux_cons_port_mt_day ? { auxConsPort: String(ex.aux_cons_port_mt_day) } : {}),
      ...(ex.brob_mt ? { brob: String(ex.brob_mt) } : {}),
      ...(normFuelType(ex.fuel_type) ? { fuelType: normFuelType(ex.fuel_type) } : ex.vlsfo_sea_mt_day ? { fuelType: state.performance?.fuelType ?? "VLSFO" } : {}),
      ...(ex.scrubber_fitted != null ? { scrubber: !!ex.scrubber_fitted } : {}),
      _source: "user",
    };
  }

  return patch;
}
