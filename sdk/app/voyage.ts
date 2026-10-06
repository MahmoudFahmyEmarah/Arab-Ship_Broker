import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_VOYAGE_SETTINGS, type SettingsSource, type VoyageSettings } from "@/lib/voyage/types";
import { parseVoyageSettings } from "@/lib/voyage/schemas";

// Voyage estimator settings live in app_settings.voyage_settings (members read,
// admins write on /admin/voyage-data). The reader never hides a failure: a
// missing row, a read error or a malformed value returns the compiled defaults
// with status "defaults" and the reason, and every estimate built on them says
// so (audit O2C-024 item 7).
export interface VoyageSettingsLoad { settings: VoyageSettings; status: SettingsSource; error: string | null }

export async function getVoyageSettings(supabase: SupabaseClient): Promise<VoyageSettingsLoad> {
  try {
    const { data, error } = await supabase.from("app_settings").select("value").eq("key", "voyage_settings").maybeSingle();
    if (error) return { settings: DEFAULT_VOYAGE_SETTINGS, status: "defaults", error: `voyage_settings read failed: ${error.message}` };
    if (!data?.value) return { settings: DEFAULT_VOYAGE_SETTINGS, status: "defaults", error: "voyage_settings row is missing" };
    const parsed = parseVoyageSettings(data.value);
    if (!parsed.ok) return { settings: DEFAULT_VOYAGE_SETTINGS, status: "defaults", error: `voyage_settings is malformed: ${parsed.error}` };
    return { settings: parsed.value, status: "governed", error: null };
  } catch (e) {
    return { settings: DEFAULT_VOYAGE_SETTINGS, status: "defaults", error: e instanceof Error ? e.message : "voyage_settings read failed" };
  }
}

// ── Saved estimates (migration 20261003204000) ─────────────────────────────

export interface VoyageEstimateSummary {
  id: string;
  label: string | null;
  createdAt: string;
  vesselId: string | null;
  cargoListingId: string | null;
  totals: Record<string, unknown>;
  algorithmVersion: string;
}

export async function listMyVoyageEstimates(supabase: SupabaseClient, limit = 20): Promise<VoyageEstimateSummary[]> {
  const { data, error } = await supabase.rpc("list_my_voyage_estimates", { p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []) as VoyageEstimateSummary[];
}

export async function getVoyageEstimate(supabase: SupabaseClient, runId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("get_voyage_estimate", { p_run_id: runId });
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

// Service-role write after the server action verified the session (p_actor = public.users.id).
/** C2O-058 #7: the member's linked cargo / position facts, authorised before anything is read. */
export interface VoyageLinkFacts {
  cargo: { loadPort: string | null; dischPort: string | null; laycanFrom: string | null; loadRate: string | null; dischRate: string | null; qtyMin: number | null; qtyMax: number | null } | null;
  position: { vesselId: string; openPort: string | null } | null;
}
export async function getVoyageLinkFacts(supabase: SupabaseClient, cargoListingId: string | null, availabilityId: string | null): Promise<VoyageLinkFacts> {
  const { data, error } = await supabase.rpc("voyage_link_facts", { p_cargo_listing_id: cargoListingId, p_availability_id: availabilityId });
  if (error) throw new Error(error.message);
  return (data ?? { cargo: null, position: null }) as VoyageLinkFacts;
}
/** C2O-058 #1: a market listing key → the member's own position id, or null (never a foreign raw id). */
export async function resolveVoyageVesselLink(supabase: SupabaseClient, key: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("resolve_voyage_vessel_link", { p_key: key });
  if (error) return null;
  return typeof data === "string" ? data : null;
}

export async function saveVoyageEstimate(adminClient: SupabaseClient, actorUserId: string, payload: Record<string, unknown>): Promise<string> {
  const { data, error } = await adminClient.rpc("save_voyage_estimate", { p_actor: actorUserId, p_payload: payload });
  if (error) throw new Error(error.message);
  return data as string;
}
