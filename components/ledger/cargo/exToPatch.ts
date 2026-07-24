// Post Cargo — map a real parser extract (/api/circulars/parse) into ledger
// state. Replaces the prototype's mock regex extractor with the same field
// mapping contract (exToPatch + display rows for the confirm card).

import type { ParsedCargo, ParsedVessel } from "@/lib/circulars/types";
import type { CargoState } from "./state";

type Extract = ParsedCargo & ParsedVessel;

const fmtNum = (n?: number | null) => (n == null ? null : n.toLocaleString("en-US"));

/** Rows shown in the assistant's extract card before the user applies. */
export function cargoExRows(ex: Extract): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (ex.commodity_name) rows.push({ label: "Commodity", value: ex.commodity_name + (ex.cargo_type ? " · " + ex.cargo_type : "") });
  if (ex.qty_min_mt || ex.qty_max_mt) {
    const min = fmtNum(ex.qty_min_mt);
    const max = fmtNum(ex.qty_max_mt);
    rows.push({ label: "Quantity", value: (min && max && min !== max ? `${min} – ${max}` : (max ?? min ?? "")) + " MT" });
  }
  if (ex.load_port_name || ex.load_port_locode) rows.push({ label: "Load", value: ex.load_port_name || ex.load_port_locode || "" });
  if (ex.disch_port_name || ex.disch_port_locode) rows.push({ label: "Discharge", value: ex.disch_port_name || ex.disch_port_locode || "" });
  if (ex.laycan_from) rows.push({ label: "Laycan", value: ex.laycan_from + (ex.laycan_to ? " → " + ex.laycan_to : "") });
  if (ex.load_rate) rows.push({ label: "Load rate", value: ex.load_rate });
  if (ex.disch_rate) rows.push({ label: "Disch rate", value: ex.disch_rate });
  if (ex.freight_idea_usd_mt) rows.push({ label: "Freight idea", value: "USD " + ex.freight_idea_usd_mt + "/MT" });
  if (ex.commission_pct) rows.push({ label: "Commission", value: ex.commission_pct + "%" });
  return rows;
}

export function cargoExToPatch(ex: Extract, state: CargoState): Partial<CargoState> {
  const patch: Partial<CargoState> = {};

  if (ex.commodity_name) {
    patch.commodity = {
      ...(state.commodity ?? {}),
      name: ex.commodity_name,
      form: ex.cargo_type === "Break Bulk" ? "break-bulk" : "dry-bulk",
    };
  }

  if (ex.qty_min_mt || ex.qty_max_mt) {
    const min = ex.qty_min_mt ?? ex.qty_max_mt ?? 0;
    const max = ex.qty_max_mt ?? ex.qty_min_mt ?? 0;
    const mid = Math.round((min + max) / 2);
    const tol = max > min && mid > 0 ? Math.round(((max - min) / 2 / mid) * 100) : null;
    patch.quantity = {
      ...(state.quantity ?? { unit: "CbM" }),
      qtyMt: mid || null,
      ...(tol ? { molooPct: String(tol), optionHolder: state.quantity?.optionHolder ?? "MOLOO" } : {}),
    };
  }

  const portSel = (locode?: string, name?: string) =>
    locode || name ? { locode: (locode ?? "").replace(/\s+/g, "").toUpperCase(), name: name || locode || "" } : null;
  const pol = portSel(ex.load_port_locode, ex.load_port_name);
  const pod = portSel(ex.disch_port_locode, ex.disch_port_name);
  if (pol || pod || ex.load_rate || ex.disch_rate) {
    patch.ports = {
      ...(state.ports ?? {}),
      ...(pol ? { pol } : {}),
      ...(pod ? { pod } : {}),
      ...(ex.load_rate ? { loadRate: ex.load_rate.replace(/[^\d]/g, "") || null } : {}),
      ...(ex.disch_rate ? { dischRate: ex.disch_rate.replace(/[^\d]/g, "") || null } : {}),
    };
  }

  if (ex.laycan_from || ex.freight_idea_usd_mt || ex.commission_pct || ex.is_spot != null) {
    patch.terms = {
      ...(state.terms ?? { freightBasis: "Per MT" }),
      ...(ex.laycan_from ? { laycanFrom: ex.laycan_from } : {}),
      ...(ex.laycan_to ? { laycanTo: ex.laycan_to } : {}),
      ...(ex.freight_idea_usd_mt ? { freight: String(ex.freight_idea_usd_mt) } : {}),
      ...(ex.commission_pct ? { commissionPct: String(ex.commission_pct) } : {}),
      ...(ex.is_spot != null ? { spot: !!ex.is_spot } : {}),
    };
  }

  return patch;
}
