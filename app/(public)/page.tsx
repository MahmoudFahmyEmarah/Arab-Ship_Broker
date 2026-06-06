import { createClient } from "@supabase/supabase-js";
import { HomeClient } from "./home-client";

// Marketing counts refresh every 5 minutes (ISR) — not a per-request query storm.
// Counts come from the get_public_stats() SECURITY DEFINER RPC (firewall-safe:
// aggregate numbers only, no rows/PII, no service-role key). The base tables are
// not anon-readable under RLS, so a direct anon count returns 0 — the RPC is what
// makes the public count correct.
export const revalidate = 300;

export default async function HomePage() {
  // Real platform figures from the unified master dataset (731 cargo · 88
  // vessels · 16 trade zones). These are the floor: live RPC counts override
  // them when there's real DB activity, but a live 0 must NOT render a dead "0"
  // on the marketing hero — it falls back to these real figures.
  const BASE = { cargo: 731, vessel: 88, zone: 16 };
  let cargoCount = BASE.cargo;
  let vesselCount = BASE.vessel;
  let zoneCount = BASE.zone;

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
      // Use live counts when they're non-zero; otherwise keep the baseline so
      // cargo/vessel/zone never show 0 on the public hero.
      if (s.cargo_count > 0) cargoCount = s.cargo_count;
      if (typeof s.vessel_count === "number" && s.vessel_count > 0) vesselCount = s.vessel_count;
      if (typeof s.zone_count === "number" && s.zone_count > 0) zoneCount = s.zone_count;
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
