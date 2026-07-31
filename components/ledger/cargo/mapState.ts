// Post Cargo — ledger state → create_cargo_listing_v2 payload.
// Zod validates at the submit boundary (the RPC re-validates server-side).

import { z } from "zod";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { LOCODE_REGEX } from "@/lib/schemas/cargo";
import { submitCargoLedgerRpc, type CargoLedgerPayload, type CargoParcelPayload } from "@/sdk/app/ledger";
import { LAYCAN_CAP_DAYS } from "../defs";
import type { CargoState, ExtraParcel } from "./state";

const CBFT_PER_CBM = 35.3147;

const num = (v: string | number | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

const payloadSchema = z
  .object({
    commodity_name: z.string().min(2, "Pick a commodity"),
    cargo_type: z.enum(["Dry Bulk", "Break Bulk"]),
    qty_mt: z.number().int().positive("Quantity is required"),
    tolerance_pct: z.number().min(0).max(25).nullable(),
    tolerance_holder: z.string().nullable(),
    volume_cbm: z.number().positive("Volume is required"),
    packaging_type: z.string().nullable(),
    load_port_locode: z.string().regex(LOCODE_REGEX, "Invalid load port LOCODE"),
    disch_port_locode: z.string().regex(LOCODE_REGEX, "Invalid discharge port LOCODE"),
    laycan_from: z.string().min(10, "Laycan from is required"),
    laycan_to: z.string().nullable(),
  })
  .refine((p) => p.load_port_locode !== p.disch_port_locode, {
    message: "Discharge port must differ from the load port",
  })
  .refine(
    (p) => {
      if (!p.laycan_to) return true;
      const days = Math.round((new Date(p.laycan_to).getTime() - new Date(p.laycan_from).getTime()) / 86400000);
      return days >= 0 && days <= LAYCAN_CAP_DAYS;
    },
    { message: `Laycan window must be within ${LAYCAN_CAP_DAYS} days` },
  );

const parcelSchema = z.object({
  commodity_name: z.string().min(2, "Pick a commodity for every parcel"),
  cargo_type: z.enum(["Dry Bulk", "Break Bulk"]),
  qty_mt: z.number().int().positive("Every parcel needs a quantity"),
  tolerance_pct: z.number().min(0).max(25).nullable(),
  volume_cbm: z.number().positive("Every parcel needs a volume"),
});

function mapParcel(p: ExtraParcel, index: number): CargoParcelPayload {
  const c = p.commodity;
  if (!c?.name || !c.form) throw new Error(`Parcel ${index + 1}: pick a commodity and its cargo type`);
  const volume = num(p.volume);
  const volumeCbm = volume != null ? (p.unit === "CbFT" ? volume / CBFT_PER_CBM : volume) : null;
  const core = {
    commodity_name: c.name,
    cargo_type: (c.form === "break-bulk" ? "Break Bulk" : "Dry Bulk") as "Dry Bulk" | "Break Bulk",
    qty_mt: num(p.qtyMt) ?? 0,
    tolerance_pct: num(p.molooPct),
    volume_cbm: volumeCbm != null ? Math.round(volumeCbm * 100) / 100 : 0,
  };
  const parsed = parcelSchema.safeParse(core);
  if (!parsed.success) {
    throw new Error(`Parcel ${index + 1}: ${parsed.error.issues[0]?.message ?? "incomplete"}`);
  }
  return {
    ...parsed.data,
    tolerance_holder: p.molooPct ? (p.optionHolder ?? "MOLOO") : null,
    packaging_type: c.packaging ?? null,
  };
}

export function mapCargoState(state: CargoState): CargoLedgerPayload {
  const c = state.commodity;
  const q = state.quantity;
  const p = state.ports;
  const t = state.terms;
  if (!c?.name || !c.form) throw new Error("Pick a commodity and its cargo type first");

  const volume = num(q?.volume);
  const volumeCbm = volume != null ? (q?.unit === "CbFT" ? volume / CBFT_PER_CBM : volume) : null;

  const core = {
    commodity_name: c.name,
    cargo_type: (c.form === "break-bulk" ? "Break Bulk" : "Dry Bulk") as "Dry Bulk" | "Break Bulk",
    qty_mt: num(q?.qtyMt) ?? 0,
    tolerance_pct: num(q?.molooPct),
    tolerance_holder: q?.molooPct ? (q?.optionHolder ?? "MOLOO") : null,
    volume_cbm: volumeCbm != null ? Math.round(volumeCbm * 100) / 100 : 0,
    packaging_type: c.packaging ?? null,
    load_port_locode: (p?.pol?.locode ?? "").replace(/\s+/g, "").toUpperCase(),
    disch_port_locode: (p?.pod?.locode ?? "").replace(/\s+/g, "").toUpperCase(),
    laycan_from: t?.laycanFrom ?? "",
    laycan_to: t?.laycanTo || null,
  };
  const parsed = payloadSchema.safeParse(core);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Please complete the required fields");
  }

  // Multi-parcel: parcel 1 = the legacy commodity/quantity slots, then the
  // extras. Each posts as its own listing, grouped by the RPC.
  const extras = state.extraParcels ?? [];
  const parcels: CargoParcelPayload[] | undefined = extras.length
    ? [
        mapParcel({ commodity: c, qtyMt: q?.qtyMt, molooPct: q?.molooPct, optionHolder: q?.optionHolder, volume: q?.volume, unit: q?.unit }, 0),
        ...extras.map((p, i) => mapParcel(p, i + 1)),
      ]
    : undefined;

  return {
    ...parsed.data,
    ...(parcels ? { parcels } : {}),
    load_rate: p?.loadRate || null,
    disch_rate: p?.dischRate || null,
    rate_mechanism: p?.rateMechanism || null,
    day_exceptions: p?.dayExceptions || null,
    turn_time_hrs: num(p?.turnTime),
    laytime_reversible: p?.loadRate && p?.dischRate ? p?.reversible || null : null,
    is_spot: !!t?.spot,
    nor_clause: t?.norClause || null,
    freight_idea_usd_mt: num(t?.freight),
    freight_basis: t?.freightBasis || null,
    despatch_basis: t?.despatch || null,
    commission_ttl_pct: num(t?.commissionPct),
    iac_flag: !!t?.iac,
    notes: c.marketName && c.marketName !== c.name ? `Market name: ${c.marketName}` : null,
  };
}

export async function submitCargoLedger(state: CargoState) {
  const supabase = getSupabaseBrowserClient();
  return submitCargoLedgerRpc(supabase, mapCargoState(state));
}
