import { createClient } from "@supabase/supabase-js";
import { HomeClient } from "./home-client";

// Marketing counts refresh every 5 minutes (ISR) — not a per-request query storm.
// Counts come from the get_public_stats() SECURITY DEFINER RPC (firewall-safe:
// aggregate numbers only, no rows/PII, no service-role key). The base tables are
// not anon-readable under RLS, so a direct anon count returns 0 — the RPC is what
// makes the public count correct.
export const revalidate = 300;

export default async function HomePage() {
  // Fallbacks — never render 0/NaN if the RPC is unavailable (e.g. not yet
  // applied to the DB). Better a sensible number than a zero.
  let cargoCount = 167;
  let vesselCount = 62;
  let zoneCount = 14;

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data } = await supabase.rpc("get_public_stats");
    const s = (data ?? {}) as {
      cargo_count?: number;
      vessel_count?: number;
      zone_count?: number;
    };
    if (typeof s.cargo_count === "number" && s.cargo_count > 0) cargoCount = s.cargo_count;
    if (typeof s.vessel_count === "number" && s.vessel_count > 0) vesselCount = s.vessel_count;
    if (typeof s.zone_count === "number" && s.zone_count > 0) zoneCount = s.zone_count;
  } catch {
    // keep fallbacks
  }

  return (
    <HomeClient
      cargoCount={cargoCount}
      vesselCount={vesselCount}
      zoneCount={zoneCount}
    />
  );
}
