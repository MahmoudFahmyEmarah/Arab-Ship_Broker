// Post Cargo — "Repost a past posting" rail: the user's most recent cargo
// listings mapped back into ledger state (design behaviour: loads all fields,
// the broker edits — typically the laycan — then reposts).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getMyCargoListings } from "@/sdk/app/cargos";
import { zoneDisplayName } from "../defs";
import type { LedgerRepost } from "../types";
import type { CargoState, LedgerPortSel } from "./state";

const portSel = (locode?: string | null, name?: string | null, zone?: string | null): LedgerPortSel | null =>
  locode ? { locode, name: name || locode, zone: zone ?? null, zoneName: zoneDisplayName(zone) } : null;

export async function loadCargoReposts(supabase: SupabaseClient, limit = 3): Promise<LedgerRepost<CargoState>[]> {
  const rows = await getMyCargoListings(supabase).catch(() => []);
  return rows.slice(0, limit).map((row) => {
    // Newer ledger columns may be absent from the legacy row type.
    const r = row as typeof row & {
      packaging_type?: string | null;
      tolerance_pct?: number | null;
      tolerance_holder?: string | null;
      volume_cbm?: number | null;
      rate_mechanism?: string | null;
      day_exceptions?: string | null;
      turn_time_hrs?: number | null;
      laytime_reversible?: string | null;
      freight_basis?: string | null;
      despatch_basis?: string | null;
      commission_ttl_pct?: number | null;
      iac_flag?: boolean | null;
    };
    const qtyMid = Math.round(((r.qty_min_mt ?? 0) + (r.qty_max_mt ?? 0)) / 2) || null;
    const patch: Partial<CargoState> = {
      commodity: {
        name: r.commodity_name,
        form: r.cargo_type === "Break Bulk" ? "break-bulk" : "dry-bulk",
        packaging: r.packaging_type ?? null,
      },
      quantity: {
        qtyMt: qtyMid,
        molooPct: r.tolerance_pct != null ? String(r.tolerance_pct) : null,
        optionHolder: r.tolerance_holder ?? (r.tolerance_pct != null ? "MOLOO" : null),
        volume: r.volume_cbm != null ? Math.round(Number(r.volume_cbm)) : null,
        unit: "CbM",
      },
      ports: {
        pol: portSel(r.load_port_locode, r.load_port_name, r.load_zone),
        pod: portSel(r.disch_port_locode, r.disch_port_name, r.disch_zone),
        loadRate: r.load_rate ? String(r.load_rate).replace(/[^\d]/g, "") || null : null,
        dischRate: r.disch_rate ? String(r.disch_rate).replace(/[^\d]/g, "") || null : null,
        rateMechanism: r.rate_mechanism ?? null,
        dayExceptions: r.day_exceptions ?? null,
        turnTime: r.turn_time_hrs != null ? String(r.turn_time_hrs) : null,
        reversible: r.laytime_reversible ?? null,
      },
      terms: {
        laycanFrom: r.laycan_from ?? null,
        laycanTo: r.laycan_to ?? null,
        norClause: r.nor_clause ?? null,
        freight: r.freight_idea_usd_mt != null ? String(r.freight_idea_usd_mt) : null,
        freightBasis: r.freight_basis ?? "Per MT",
        despatch: r.despatch_basis ?? null,
        commissionPct: (r.commission_ttl_pct ?? r.commission_pct) != null ? String(r.commission_ttl_pct ?? r.commission_pct) : null,
        iac: !!r.iac_flag,
        spot: !!r.is_spot,
      },
    };
    return {
      label: `${r.commodity_name} — ${r.load_port_name || r.load_port_locode || "?"} → ${r.disch_port_name || r.disch_port_locode || "?"}`,
      patch,
    };
  });
}
