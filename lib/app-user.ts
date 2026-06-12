import type { SupabaseClient } from "@supabase/supabase-js";

// Canonical app-user lookup. public.users has id = gen_random_uuid() with
// supabase_user_id = auth.uid() (create_account_with_profiles inserts that
// way), so NEVER query users by .eq("id", authUid) — for real accounts that
// finds nothing (the root cause of the login bounces / stuck tier). Resolve
// via supabase_user_id first, fall back to id for legacy rows created equal.
export async function getAppUserRow<T = Record<string, unknown>>(
  supabase: SupabaseClient,
  authUid: string,
  select: string,
): Promise<(T & { id: string }) | null> {
  const sel = select.includes("id") ? select : `id, ${select}`;
  const bySupabase = await supabase
    .from("users")
    .select(sel)
    .eq("supabase_user_id", authUid)
    .maybeSingle();
  if (bySupabase.data) return bySupabase.data as unknown as T & { id: string };
  const byId = await supabase
    .from("users")
    .select(sel)
    .eq("id", authUid)
    .maybeSingle();
  return (byId.data as unknown as (T & { id: string }) | null) ?? null;
}
