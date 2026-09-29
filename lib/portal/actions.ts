"use server";

// Server actions for on-demand match lists in the detail panels. Every market
// lookup crosses the governed opaque-key API; raw listing ids are management
// data and are never accepted here.
import {
  getMarketListingDetail,
  isMarketCargoRow,
  isMarketVesselRow,
  listMarketCargo,
  listMarketMatches,
  listMarketVessels,
  marketBoardKey,
} from "@/sdk/app/market";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { toMatchVessel, toMatchCargo, MatchVesselView, MatchCargoView } from "./match-views";
import { sampleCargoMatches, sampleAvailabilityMatches } from "./mock-matches";
import { VesselOwnershipView } from "./types";

function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return !!url && !url.includes("placeholder");
}

export async function fetchCargoMatches(listingKey: string): Promise<MatchVesselView[]> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await getSupabaseServerClient();
      const rows = await listMarketMatches(supabase, listingKey);
      return rows.filter(isMarketVesselRow).map(toMatchVessel);
    } catch (err) {
      console.error("[portal] governed cargo matches failed:", err);
      return [];
    }
  }
  return sampleCargoMatches(listingKey);
}

export async function fetchAvailabilityMatches(listingKey: string): Promise<MatchCargoView[]> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await getSupabaseServerClient();
      const rows = await listMarketMatches(supabase, listingKey);
      return rows.filter(isMarketCargoRow).map(toMatchCargo);
    } catch (err) {
      console.error("[portal] governed vessel matches failed:", err);
      return [];
    }
  }
  return sampleAvailabilityMatches(listingKey);
}

// Vessel ownership / commercial-management for the detail panel comes from
// the governed detail RPC. It is absent for a non-owner and never contains
// contact PII.
export async function fetchVesselOwnership(listingKey: string): Promise<VesselOwnershipView | null> {
  if (!listingKey || !isSupabaseConfigured()) return null;
  try {
    const supabase = await getSupabaseServerClient();
    const detail = await getMarketListingDetail(supabase, listingKey);
    if (!detail || !isMarketVesselRow(detail)) return null;
    const data = detail.ownership as {
      owner_company?: string | null;
      owner_org_name?: string | null;
      owner_org_imo?: string | null;
      owner_org_country?: string | null;
      owner_org_fleet?: number | null;
      owner_org_desk?: string | null;
      manager_company?: string | null;
      manager_org_name?: string | null;
      manager_org_fleet?: number | null;
      manager_org_desk?: string | null;
    } | null | undefined;
    if (!data) return { entitled: false, ownerName: null, ownerImo: null, ownerCountry: null, ownerFleet: null, ownerDesk: null, managerName: null, managerFleet: null, managerDesk: null };
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

// ── "My matches only" (market boards) ──
// The ids of market counterparts that match MY listings, computed from the
// SAME governed match RPC the detail panels use (one source of truth, no parallel
// logic). Cargo market: cargo ids matching any of my open positions. Tonnage
// market: availability ids matching any of my live cargo.
export async function fetchMyMatchedCargoIds(): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await getSupabaseServerClient();
    const open = (await listMarketVessels(supabase)).filter(
      (row) => row.is_owned && row.status === "OPEN" && row.review_status === "APPROVED",
    );
    const ids = new Set<string>();
    for (const av of open.slice(0, 10)) {
      const rows = await listMarketMatches(supabase, av.listing_key);
      rows.filter(isMarketCargoRow).forEach((row) => ids.add(marketBoardKey(row)));
    }
    return [...ids];
  } catch (err) {
    console.error("[portal] my matched cargo ids failed:", err);
    return [];
  }
}

export async function fetchMyMatchedAvailabilityIds(): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await getSupabaseServerClient();
    const live = (await listMarketCargo(supabase)).filter(
      (row) => row.is_owned && ["IN", "PARTIAL"].includes(row.status) && row.review_status === "APPROVED",
    );
    const ids = new Set<string>();
    for (const c of live.slice(0, 10)) {
      const rows = await listMarketMatches(supabase, c.listing_key);
      rows.filter(isMarketVesselRow).forEach((row) => ids.add(marketBoardKey(row)));
    }
    return [...ids];
  } catch (err) {
    console.error("[portal] my matched availability ids failed:", err);
    return [];
  }
}
