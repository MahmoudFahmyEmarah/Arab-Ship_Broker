// Server-side resolution of the calculator entitlement (see ./calculator-policy).
// Every calculator page and server action calls this before any read or write.
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppUserRow } from "@/lib/app-user";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { decideCalculatorAccess, type CalculatorAccess, type CalculatorProfileRow } from "./calculator-policy";

export async function resolveCalculatorAccess(): Promise<{ access: CalculatorAccess; supabase: SupabaseClient }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { access: decideCalculatorAccess({ authenticated: false, row: null, claimRole: null }), supabase };
  const row = await getAppUserRow<CalculatorProfileRow>(supabase, user.id, "id, role, is_active, subscription_tier, is_market_partner");
  const claimRole = (user.app_metadata as { role?: string } | undefined)?.role ?? null;
  return { access: decideCalculatorAccess({ authenticated: true, row, claimRole }), supabase };
}
