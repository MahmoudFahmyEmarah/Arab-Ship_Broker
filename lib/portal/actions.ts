"use server";

// Server actions for on-demand match lists in the detail panels. Called from
// the client detail panels when a card is opened. Runs the real match RPCs via
// a server Supabase client; falls back to sample matches in the preview.
import { getMatchesForCargo } from "@/sdk/app/cargos";
import { getMatchesForAvailability } from "@/sdk/app/vessels";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { toMatchVessel, toMatchCargo, MatchVesselView, MatchCargoView } from "./match-views";
import { sampleCargoMatches, sampleAvailabilityMatches } from "./mock-matches";
import { VesselOwnershipView } from "./types";

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

// Vessel ownership / commercial-management for the detail panel. Reads the
// firewalled v_vessel_detail: the DB NULLs every identity field unless the
// caller is admin or the vessel's own owner, so a non-owner market viewer gets
// `entitled: false` and the panel renders the brokered/masked card. No contact
// PII (email/phone) is selected — only registry facts + the desk label.
export async function fetchVesselOwnership(
  vesselId: string,
): Promise<VesselOwnershipView | null> {
  if (!vesselId || !isSupabaseConfigured()) return null;
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("v_vessel_detail")
      .select(
        "owner_company, owner_org_name, owner_org_imo, owner_org_country, owner_org_fleet, owner_org_desk, manager_company, manager_org_name, manager_org_fleet, manager_org_desk",
      )
      .eq("id", vesselId)
      .maybeSingle();
    if (error || !data) return null;

    const ownerName = data.owner_org_name ?? data.owner_company ?? null;
    const managerName = data.manager_org_name ?? data.manager_company ?? null;
    const entitled = ownerName != null || managerName != null;
    return {
      entitled,
      ownerName,
      ownerImo: data.owner_org_imo ?? null,
      ownerCountry: data.owner_org_country ?? null,
      ownerFleet: data.owner_org_fleet ?? null,
      ownerDesk: data.owner_org_desk ?? null,
      managerName,
      managerFleet: data.manager_org_fleet ?? null,
      managerDesk: data.manager_org_desk ?? null,
    };
  } catch (err) {
    console.error("[portal] vessel ownership lookup failed:", err);
    return null;
  }
}
