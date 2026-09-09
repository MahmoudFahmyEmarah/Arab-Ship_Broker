"use server";

// Topbar run pill — deliberately a tiny module: the admin layout renders the
// pill on every page, so it must not pull the DQ engine (LangChain etc.) into
// that path. Polled every few seconds; any failure just hides the pill.
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function getActiveRunSummary(): Promise<{ id: string; code: string; status: string; pct: number; done: number; total: number } | null> {
  try {
    const u = await requireAdmin();
    if (u.tier !== "super" && u.perms?.dataquality == null) return null;
    const sb = getSupabaseAdminClient();
    const { data } = await sb.from("dq_runs").select("id, code, status, batches_done, total_batches").in("status", ["running", "paused"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!data) return null;
    const r = data as { id: string; code: string; status: string; batches_done: number; total_batches: number };
    return { id: r.id, code: r.code, status: r.status, pct: r.total_batches ? Math.round((r.batches_done / r.total_batches) * 100) : 0, done: r.batches_done, total: r.total_batches };
  } catch { return null; }
}
