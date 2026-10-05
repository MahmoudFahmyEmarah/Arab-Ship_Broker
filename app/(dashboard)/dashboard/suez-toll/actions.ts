"use server";

// Suez calculator — member-session reads and writes (Voyage Economics, Stream S).
// Every action passes the calculator entitlement first (lib/voyage/calculator-policy.ts),
// then runs as the signed-in member through the cookie client, so the
// RPCs' own allow rules apply (published tariff context for everyone; vessel
// economics only for the vessel's managers and admins).

import { resolveCalculatorAccess } from "@/lib/voyage/calculator-access";
import { calculatorDenialMessage } from "@/lib/voyage/calculator-policy";
import { getSuezTariffContext, getVesselEconomicsProfile, upsertVesselEconomicsProfile, type VesselEconomicsProfile } from "@/sdk/app/suez";
import type { SuezTariffContextResult } from "@/lib/suez/types";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function loadSuezContextAction(date: string): Promise<ActionResult<SuezTariffContextResult>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Transit date must be YYYY-MM-DD." };
  try {
    const { access, supabase } = await resolveCalculatorAccess();
    if (!access.allowed) return { ok: false, error: calculatorDenialMessage(access.reason) };
    return { ok: true, data: await getSuezTariffContext(supabase, date) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Tariff context unavailable." };
  }
}

export async function loadVesselEconomicsAction(vesselId: string): Promise<ActionResult<VesselEconomicsProfile>> {
  if (!/^[0-9a-f-]{36}$/i.test(vesselId)) return { ok: false, error: "Invalid vessel." };
  try {
    const { access, supabase } = await resolveCalculatorAccess();
    if (!access.allowed) return { ok: false, error: calculatorDenialMessage(access.reason) };
    return { ok: true, data: await getVesselEconomicsProfile(supabase, vesselId) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Profile unavailable." };
  }
}

export async function saveVesselEconomicsAction(
  vesselId: string,
  profile: Parameters<typeof upsertVesselEconomicsProfile>[2],
): Promise<ActionResult<VesselEconomicsProfile>> {
  if (!/^[0-9a-f-]{36}$/i.test(vesselId)) return { ok: false, error: "Invalid vessel." };
  try {
    const { access, supabase } = await resolveCalculatorAccess();
    if (!access.allowed) return { ok: false, error: calculatorDenialMessage(access.reason) };
    return { ok: true, data: await upsertVesselEconomicsProfile(supabase, vesselId, profile) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not save.";
    return { ok: false, error: msg.startsWith("VE_FORBIDDEN") ? "You do not manage this vessel; the facts stay in Manual mode for this estimate." : msg };
  }
}
