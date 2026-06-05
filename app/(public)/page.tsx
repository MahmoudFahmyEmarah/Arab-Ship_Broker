import { createClient } from "@supabase/supabase-js";
import { HomeClient } from "./home-client";

// Marketing counts refresh every 5 minutes (ISR) — not a per-request query storm.
// Counts come from the get_public_stats() SECURITY DEFINER RPC (firewall-safe:
// aggregate numbers only, no rows/PII, no service-role key). The base tables are
// not anon-readable under RLS, so a direct anon count returns 0 — the RPC is what
// makes the public count correct.
export const revalidate = 300;

export default async function HomePage() {
  // Fallbacks apply ONLY when the RPC is unreachable (preview / not yet applied).
  // When the RPC returns, its integers are used verbatim — including a genuine 0,
  // shown honestly (the old "show a static number instead of 0" masking is gone).
  let cargoCount = 167;
  let vesselCount = 62;
  let zoneCount = 14;

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data, error } = await supabase.rpc("get_public_stats");
    const s = (data ?? null) as {
      cargo_count?: number;
      vessel_count?: number;
      zone_count?: number;
    } | null;
    if (!error && s && typeof s.cargo_count === "number") {
      cargoCount = s.cargo_count;
      vesselCount = typeof s.vessel_count === "number" ? s.vessel_count : 0;
      zoneCount = typeof s.zone_count === "number" ? s.zone_count : 0;
    }
  } catch {
    // RPC unavailable — keep the sensible fallbacks (never render NaN).
  }

  return (
    <HomeClient
      cargoCount={cargoCount}
      vesselCount={vesselCount}
      zoneCount={zoneCount}
    />
  );
}
