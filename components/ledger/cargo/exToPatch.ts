// Post Cargo — map a real parser extract (/api/circulars/parse) into ledger
// state. Replaces the prototype's mock regex extractor with the same field
// mapping contract (exToPatch + display rows for the confirm card), now
// covering the full terms depth: packaging, tolerance, volume, rate
// mechanics, NOR, freight/despatch basis and commission.

import type { ParsedCargo, ParsedVessel } from "@/lib/circulars/types";
import { LEDGER_ENUMS } from "../defs";
import type { CargoState } from "./state";

type Extract = ParsedCargo & ParsedVessel;

const fmtNum = (n?: number | null) => (n == null ? null : n.toLocaleString("en-US"));

const normPackaging = (v?: string | null): string | null => {
  const s = (v ?? "").toLowerCase();
  if (!s) return null;
  if (/big ?bag|fibc|jumbo/.test(s)) return "Big bags (1-1.5 t)";
  if (/bag/.test(s)) return "Bagged (50 kg)";
  if (/pallet/.test(s)) return "Palletised";
  if (/break/.test(s)) return "Break-bulk";
  if (/bulk|loose/.test(s)) return "Bulk";
  return null;
};

const normEnum = (v: string | null | undefined, options: readonly string[]): string | null => {
  const s = (v ?? "").toLowerCase().trim();
  if (!s) return null;
  return options.find((o) => o.toLowerCase() === s) ?? options.find((o) => s.includes(o.toLowerCase()) || o.toLowerCase().includes(s)) ?? null;
};

const normNor = (v?: string | null): string | null => {
  const s = (v ?? "").toUpperCase();
  if (!s) return null;
  if (/WIPON|WIBON|WIFPON|WICCON/.test(s)) return "WIPON WIBON WIFPON WICCON";
  if (/ATDN|ARRIVAL/.test(s)) return "On arrival / ATDN";
  if (/TURN ?TIME/.test(s)) return "Turn time 12h once NOR tendered";
  return null;
};

/** Rows shown in the assistant's extract card before the user applies. */
export function cargoExRows(ex: Extract): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (ex.commodity_name)
    rows.push({
      label: "Commodity",
      value: ex.commodity_name + (ex.cargo_type ? " · " + ex.cargo_type : "") + (normPackaging(ex.packaging_type) ? " · " + normPackaging(ex.packaging_type) : ""),
    });
  if (ex.qty_min_mt || ex.qty_max_mt) {
    const min = fmtNum(ex.qty_min_mt);
    const max = fmtNum(ex.qty_max_mt);
    const tol = ex.tolerance_pct ? ` ±${ex.tolerance_pct}% ${ex.tolerance_holder ?? "MOLOO"}` : "";
    rows.push({ label: "Quantity", value: (min && max && min !== max ? `${min} – ${max}` : (max ?? min ?? "")) + " MT" + tol });
  }
  if (ex.volume_cbm) rows.push({ label: "Volume", value: fmtNum(ex.volume_cbm) + " CbM" });
  if (ex.load_port_name || ex.load_port_locode) rows.push({ label: "Load", value: ex.load_port_name || ex.load_port_locode || "" });
  if (ex.disch_port_name || ex.disch_port_locode) rows.push({ label: "Discharge", value: ex.disch_port_name || ex.disch_port_locode || "" });
  if (ex.laycan_from) rows.push({ label: "Laycan", value: ex.laycan_from + (ex.laycan_to ? " → " + ex.laycan_to : "") });
  if (ex.load_rate) rows.push({ label: "Load rate", value: ex.load_rate });
  if (ex.disch_rate) rows.push({ label: "Disch rate", value: ex.disch_rate });
  if (ex.rate_mechanism || ex.day_exceptions)
    rows.push({ label: "Laytime", value: [ex.rate_mechanism, ex.day_exceptions, ex.turn_time_hrs ? ex.turn_time_hrs + "h TT" : null].filter(Boolean).join(" · ") });
  if (ex.freight_idea_usd_mt)
    rows.push({ label: "Freight idea", value: "USD " + ex.freight_idea_usd_mt + (ex.freight_basis === "Lumpsum" ? " LS" : "/MT") + (ex.iac_flag ? " IAC" : "") });
  if (ex.commission_ttl_pct || ex.commission_pct) rows.push({ label: "Commission", value: (ex.commission_ttl_pct ?? ex.commission_pct) + "%" + (ex.commission_ttl_pct ? " TTL" : "") });
  if (ex.is_wog) rows.push({ label: "Terms", value: "WOG" });
  return rows;
}

export function cargoExToPatch(ex: Extract, state: CargoState): Partial<CargoState> {
  const patch: Partial<CargoState> = {};

  if (ex.commodity_name) {
    patch.commodity = {
      ...(state.commodity ?? {}),
      name: ex.commodity_name,
      form: ex.cargo_type === "Break Bulk" ? "break-bulk" : "dry-bulk",
      ...(normPackaging(ex.packaging_type) ? { packaging: normPackaging(ex.packaging_type) } : {}),
    };
  }

  if (ex.qty_min_mt || ex.qty_max_mt || ex.volume_cbm || ex.tolerance_pct) {
    const min = ex.qty_min_mt ?? ex.qty_max_mt ?? 0;
    const max = ex.qty_max_mt ?? ex.qty_min_mt ?? 0;
    const mid = Math.round((min + max) / 2);
    const tol = ex.tolerance_pct ?? (max > min && mid > 0 ? Math.round(((max - min) / 2 / mid) * 100) : null);
    patch.quantity = {
      ...(state.quantity ?? { unit: "CbM" }),
      ...(mid ? { qtyMt: mid } : {}),
      ...(tol ? { molooPct: String(tol), optionHolder: ex.tolerance_holder === "MOLCHOPT" ? "MOLCHOPT" : (state.quantity?.optionHolder ?? "MOLOO") } : {}),
      ...(ex.volume_cbm ? { volume: ex.volume_cbm, unit: "CbM" as const } : {}),
    };
  }

  const portSel = (locode?: string, name?: string) =>
    locode || name ? { locode: (locode ?? "").replace(/\s+/g, "").toUpperCase(), name: name || locode || "" } : null;
  const pol = portSel(ex.load_port_locode, ex.load_port_name);
  const pod = portSel(ex.disch_port_locode, ex.disch_port_name);
  if (pol || pod || ex.load_rate || ex.disch_rate || ex.rate_mechanism || ex.day_exceptions || ex.turn_time_hrs || ex.laytime_reversible) {
    patch.ports = {
      ...(state.ports ?? {}),
      ...(pol ? { pol } : {}),
      ...(pod ? { pod } : {}),
      ...(ex.load_rate ? { loadRate: ex.load_rate.replace(/[^\d]/g, "") || null } : {}),
      ...(ex.disch_rate ? { dischRate: ex.disch_rate.replace(/[^\d]/g, "") || null } : {}),
      ...(normEnum(ex.rate_mechanism, LEDGER_ENUMS.rateMechanism) ? { rateMechanism: normEnum(ex.rate_mechanism, LEDGER_ENUMS.rateMechanism) } : {}),
      ...(normEnum(ex.day_exceptions, LEDGER_ENUMS.dayExceptions) ? { dayExceptions: normEnum(ex.day_exceptions, LEDGER_ENUMS.dayExceptions) } : {}),
      ...(ex.turn_time_hrs ? { turnTime: String(ex.turn_time_hrs) } : {}),
      ...(normEnum(ex.laytime_reversible, LEDGER_ENUMS.reversible) ? { reversible: normEnum(ex.laytime_reversible, LEDGER_ENUMS.reversible) } : {}),
    };
  }

  if (
    ex.laycan_from ||
    ex.freight_idea_usd_mt ||
    ex.commission_pct ||
    ex.commission_ttl_pct ||
    ex.is_spot != null ||
    ex.nor_clause ||
    ex.freight_basis ||
    ex.despatch_basis ||
    ex.iac_flag != null
  ) {
    patch.terms = {
      ...(state.terms ?? { freightBasis: "Per MT" }),
      ...(ex.laycan_from ? { laycanFrom: ex.laycan_from } : {}),
      ...(ex.laycan_to ? { laycanTo: ex.laycan_to } : {}),
      ...(normNor(ex.nor_clause) ? { norClause: normNor(ex.nor_clause) } : {}),
      ...(ex.freight_idea_usd_mt ? { freight: String(ex.freight_idea_usd_mt) } : {}),
      ...(normEnum(ex.freight_basis, LEDGER_ENUMS.freightBasis) ? { freightBasis: normEnum(ex.freight_basis, LEDGER_ENUMS.freightBasis) } : {}),
      ...(normEnum(ex.despatch_basis, LEDGER_ENUMS.despatch) ? { despatch: normEnum(ex.despatch_basis, LEDGER_ENUMS.despatch) } : {}),
      ...(ex.commission_ttl_pct || ex.commission_pct ? { commissionPct: String(ex.commission_ttl_pct ?? ex.commission_pct) } : {}),
      ...(ex.iac_flag != null ? { iac: !!ex.iac_flag } : {}),
      ...(ex.is_spot != null ? { spot: !!ex.is_spot } : {}),
    };
  }

  return patch;
}
