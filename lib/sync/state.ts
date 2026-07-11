// Per-source incremental sync watermark (sync_source_state). Email reads it to
// fetch only mail newer than the last successful sync; upload records it for
// visibility (not yet used to limit processing).

import type { SupabaseClient } from "@supabase/supabase-js";

export type SyncSourceKind = "email" | "upload";

export async function getWatermark(
  supabase: SupabaseClient,
  source: SyncSourceKind,
): Promise<Date | null> {
  const { data } = await supabase
    .from("sync_source_state")
    .select("last_sync_at")
    .eq("source", source)
    .maybeSingle();
  const iso = data?.last_sync_at as string | null | undefined;
  return iso ? new Date(iso) : null;
}

export async function setWatermark(
  supabase: SupabaseClient,
  source: SyncSourceKind,
  at: Date,
): Promise<void> {
  await supabase
    .from("sync_source_state")
    .upsert(
      { source, last_sync_at: at.toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "source" },
    );
}
