// Fixture Room · the signed-in viewer for the page gates (server only).
//
// One reading of role, tier and the market-partner flag, passed through
// canUseFixtureRoom (audit FR-M4) so the inbox and the match builder decide
// exactly as fn_fixture_tier_ok does. The market-partner column does not
// exist in the current schema: the read is attempted and answers false when
// the column is missing, which keeps the approved D3 path explicit.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAppUserRow } from "@/lib/app-user";
import { canUseFixtureRoom } from "./permissions";

export interface FixtureViewer {
  role: string | null;
  tier: string | null;
  isMarketPartner: boolean;
  canCreate: boolean;
  isAdmin: boolean;
}

export async function loadFixtureViewer(supabase: SupabaseClient, authUid: string): Promise<FixtureViewer> {
  const row = await getAppUserRow<{ role?: string | null; subscription_tier?: string | null }>(supabase, authUid, "role, subscription_tier");
  const role = row?.role ?? null;
  const tier = row?.subscription_tier ?? null;
  let isMarketPartner = false;
  if (row) {
    const { data, error } = await supabase.from("users").select("is_market_partner").eq("id", row.id).maybeSingle();
    if (!error && data && (data as { is_market_partner?: boolean | null }).is_market_partner === true) isMarketPartner = true;
  }
  const isAdmin = (role ?? "").toLowerCase() === "admin";
  return { role, tier, isMarketPartner, isAdmin, canCreate: canUseFixtureRoom({ role, tier, isMarketPartner }) };
}
