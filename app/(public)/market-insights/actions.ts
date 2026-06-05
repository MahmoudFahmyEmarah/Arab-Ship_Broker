"use server";

import { createClient } from "@supabase/supabase-js";

// Public weekly-edition opt-in. Writes via the anon SECURITY DEFINER RPC
// (no service key, no direct table write from the browser).
export async function subscribeInsights(
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || url.includes("placeholder")) {
    // Preview / unconfigured — accept optimistically so the UX still demos.
    return { ok: true };
  }
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await supabase.rpc("fn_market_insights_subscribe", { p_email: email });
    if (error) return { ok: false, error: error.message };
    const r = (data ?? { ok: false }) as { ok: boolean; error?: string };
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  } catch {
    return { ok: false, error: "subscribe_failed" };
  }
}
