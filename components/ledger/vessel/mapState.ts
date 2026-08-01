// Post Vessel — ledger state → create_vessel_position payload.
// Zod validates at the submit boundary (the RPC re-validates server-side,
// including the 66k DWT gate, IMO check digit and Q88 crane/grab caps).

import { z } from "zod";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { validateImoCheckDigit } from "@/lib/schemas/cargo";
import { submitVesselPositionRpc, type VesselPositionPayload } from "@/sdk/app/ledger";
import { SIZE_GATE_DWT, STATUS_TO_ENUM, tradingZoneCode } from "../defs";
import type { VesselState } from "./state";

const yn = (v: string | null | undefined): boolean | null => (v === "Y" ? true : v === "N" ? false : null);
const num = (v: string | number | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

const availabilitySchema = z.object({
  status: z.string().min(1, "Availability status is required"),
  open_port_locode: z.string().min(5, "Open port is required"),
  open_from: z.string().min(10, "Open-from date is required"),
});

export function mapVesselState(state: VesselState): VesselPositionPayload {
  const av = state.availability;
  const availability = availabilitySchema.parse({
    status: STATUS_TO_ENUM[av?.status ?? ""] ?? "",
    open_port_locode: (av?.openPort?.locode ?? "").replace(/\s+/g, "").toUpperCase(),
    open_from: av?.openFrom ?? "",
  });

  const arr = state.arrangement;
  const gear = state.gear;
  const perf = state.performance;
  const v = state.vessel;

  const base: VesselPositionPayload = {
    entry_mode: "fleet",
    availability: {
      ...availability,
      charter_type: av?.charterType || null,
      trading_zones: (av?.zones ?? []).map(tradingZoneCode).filter((z): z is NonNullable<ReturnType<typeof tradingZoneCode>> => !!z),
      next_direction: av?.direction || null,
      wog: !!av?.wog,
    },
    arrangement: arr
      ? {
          _source: arr._source ?? "user",
          config: arr.config || null,
          num_holds: num(arr.numHolds),
          num_hatches: num(arr.numHatches),
          box_shaped: yn(arr.boxShaped),
          hatch_type: arr.hatchType || null,
          strengthened_heavy: yn(arr.strengthenedHeavy),
          holds_may_be_empty: arr.holdsMayBeEmpty || null,
          log_fitted: yn(arr.logFitted),
        }
      : null,
    performance: perf
      ? {
          service_speed_kn: num(perf.serviceSpeed),
          fuel_type: perf.fuelType || null,
          me_cons_sea: num(perf.meConsSea),
          me_cons_port: num(perf.meConsPort),
          aux_cons_port: num(perf.auxConsPort),
          brob_mt: num(perf.brob),
          scrubber: !!perf.scrubber,
          eca: !!perf.eco,
        }
      : null,
    gear: gear
      ? {
          _source: gear._source ?? "user",
          geared: gear.geared ?? null,
          crane_count: gear.geared ? num(gear.craneCount) : null,
          crane_swl: gear.geared ? num(gear.craneSwl) : null,
          num_grabs: gear.geared && gear.grabs ? num(gear.numGrabs) : null,
          grab_capacity: gear.geared && gear.grabs ? num(gear.grabCapacity) : null,
          kick_plate: !!gear.kickPlate,
        }
      : null,
    ownership: v
      ? {
          registered_owner: v.regOwner || null,
          parent_group: v.parentGroup || null,
          technical_operator: v.ismManager || null,
          commercial_operator: v.manager || null,
          disponent_owner: v.disponentOwner || null,
        }
      : null,
  };

  if (state.entryMode === "tbn") {
    const t = state.tbn;
    if (!t?.type || !num(t.dwt) || !t.flag?.trim()) throw new Error("TBN needs vessel type, DWT and flag");
    if ((num(t.dwt) ?? 0) > SIZE_GATE_DWT) throw new Error(`DWT is over the ${SIZE_GATE_DWT.toLocaleString()} niche gate`);
    return {
      ...base,
      entry_mode: "tbn",
      tbn: {
        type: t.type,
        dwt: num(t.dwt)!,
        flag: t.flag.trim(),
        built: num(t.built),
        loa_m: num(t.loa),
        beam_m: num(t.beam),
        draft_m: num(t.draft),
        grt: num(t.grt),
        class_society: t.classSociety || null,
      },
    };
  }

  if (!v) throw new Error("Pick or add a vessel first");
  const dwt = num(v.dwt) ?? 0;
  if (dwt > SIZE_GATE_DWT) throw new Error(`DWT is over the ${SIZE_GATE_DWT.toLocaleString()} niche gate`);

  if (v.id) {
    // dwt travels along so a registry record missing DWT is back-filled
    // (the RPC only writes it when the stored value is NULL).
    return { ...base, entry_mode: "fleet", vessel_id: v.id, dwt_backfill_mt: dwt || null };
  }

  const imo = (v.imo ?? "").trim();
  if (!validateImoCheckDigit(imo)) throw new Error("A valid 7-digit IMO number is required");
  if (!v.name?.trim()) throw new Error("Vessel name is required");
  return {
    ...base,
    entry_mode: "new",
    vessel: {
      imo,
      name: v.name.trim().toUpperCase(),
      type: v.type || "General Cargo",
      dwt,
      built: num(v.built),
      flag: v.flag || null,
      loa_m: num(v.loa),
      grt: num(v.grt),
      class_society: v.classSociety || null,
    },
  };
}

export async function submitVesselPosition(state: VesselState) {
  const supabase = getSupabaseBrowserClient();
  return submitVesselPositionRpc(supabase, mapVesselState(state));
}
