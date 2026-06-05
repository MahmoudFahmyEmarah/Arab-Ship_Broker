"use server";

// Server actions for on-demand match lists in the detail panels. Called from
// the client detail panels when a card is opened. Runs the real match RPCs via
// a server Supabase client; falls back to sample matches in the preview.
import { getMatchesForCargo } from "@/sdk/app/cargos";
import { getMatchesForAvailability } from "@/sdk/app/vessels";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { toMatchVessel, toMatchCargo, MatchVesselView, MatchCargoView } from "./match-views";
import { sampleCargoMatches, sampleAvailabilityMatches } from "./mock-matches";

function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return !!url && !url.includes("placeholder");
}

export async function fetchCargoMatches(cargoId: string): Promise<MatchVesselView[]> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await getSupabaseServerClient();
      const rows = await getMatchesForCargo(supabase, cargoId);
      return rows.map(toMatchVessel);
    } catch (err) {
      console.error("[portal] live cargo matches failed, using sample:", err);
    }
  }
  return sampleCargoMatches(cargoId);
}

export async function fetchAvailabilityMatches(availabilityId: string): Promise<MatchCargoView[]> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await getSupabaseServerClient();
      const rows = await getMatchesForAvailability(supabase, availabilityId);
      return rows.map(toMatchCargo);
    } catch (err) {
      console.error("[portal] live availability matches failed, using sample:", err);
    }
  }
  return sampleAvailabilityMatches(availabilityId);
}
