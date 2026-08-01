// Post Vessel — "Repost a past posting" rail: the user's most recent open
// positions mapped back into ledger state (vessel re-picked from the registry
// so arrangement/gear prefill flows exactly like a fresh fleet pick).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getMyVesselAvailability } from "@/sdk/app/vessels";
import { getVesselRegistryById } from "@/sdk/app/ledger";
import { STATUS_TO_ENUM, TRADING_ZONES, zoneDisplayName } from "../defs";
import type { LedgerRepost } from "../types";
import type { VesselState } from "./state";
import { registryHitToVessel } from "./steps/VesselStep";

const ENUM_TO_STATUS: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_TO_ENUM).map(([label, value]) => [value, label]),
);

const zoneLabels = (codes?: string[] | null): string[] =>
  (codes ?? []).map((c) => TRADING_ZONES.find((z) => z.code === c)?.label).filter((l): l is string => !!l);

export async function loadVesselReposts(supabase: SupabaseClient, limit = 3): Promise<LedgerRepost<VesselState>[]> {
  const rows = await getMyVesselAvailability(supabase).catch(() => []);
  const out: LedgerRepost<VesselState>[] = [];
  for (const row of rows.slice(0, limit)) {
    const r = row as typeof row & {
      charter_type?: string | null;
      is_wog?: boolean | null;
      next_direction?: string | null;
      trading_zones?: string[] | null;
      me_consumption_port_mt_day?: number | null;
      aux_consumption_port_mt_day?: number | null;
      fuel_type?: string | null;
      brob_mt?: number | null;
      scrubber_fitted?: boolean | null;
      eca_compliant?: boolean | null;
      num_grabs?: number | null;
      grab_capacity_mt?: number | null;
    };
    const registry = await getVesselRegistryById(supabase, row.vessel_id).catch(() => null);
    if (!registry) continue; // vessel gone/sanctioned — nothing to repost onto
    const vessel = registryHitToVessel(registry);
    const patch: Partial<VesselState> = {
      entryMode: "search",
      vessel,
      vesselImo: vessel.imo ?? null,
      arrangement: null, // re-derived from the record by the Arrangement step
      availability: {
        status: ENUM_TO_STATUS[row.status] ?? "Open",
        charterType: r.charter_type ?? null,
        openPort: row.open_port_locode
          ? {
              locode: row.open_port_locode,
              name: row.open_port_name || row.open_port_locode,
              zone: row.open_zone ?? null,
              zoneName: zoneDisplayName(row.open_zone),
            }
          : null,
        openFrom: row.open_date ?? null,
        zones: zoneLabels(r.trading_zones),
        direction: r.next_direction ?? null,
        wog: !!r.is_wog,
      },
      performance: {
        serviceSpeed: row.service_speed_kn != null ? String(row.service_speed_kn) : null,
        fuelType: r.fuel_type ?? null,
        meConsSea: row.me_consumption_mt_day != null ? String(row.me_consumption_mt_day) : null,
        meConsPort: r.me_consumption_port_mt_day != null ? String(r.me_consumption_port_mt_day) : null,
        auxConsPort: r.aux_consumption_port_mt_day != null ? String(r.aux_consumption_port_mt_day) : null,
        brob: r.brob_mt != null ? String(r.brob_mt) : null,
        scrubber: !!r.scrubber_fitted,
        eco: !!r.eca_compliant,
        _source: "user",
      },
      gear:
        vessel.isGeared != null || r.num_grabs != null
          ? {
              geared: vessel.isGeared === "Y",
              craneCount: vessel.craneCount != null ? String(vessel.craneCount) : null,
              craneSwl: vessel.craneSwl != null ? String(vessel.craneSwl) : null,
              grabs: !!r.num_grabs,
              numGrabs: r.num_grabs != null ? String(r.num_grabs) : null,
              grabCapacity: r.grab_capacity_mt != null ? String(r.grab_capacity_mt) : null,
              _source: "user",
            }
          : null,
    };
    out.push({
      label: `${vessel.name ?? "Vessel"} — ${row.open_port_name || row.open_port_locode || "?"}${row.open_date ? ", " + row.open_date : ""}`,
      patch,
    });
  }
  return out;
}
