import { createClient } from "@supabase/supabase-js";
import { HomeClient } from "./home-client";

// Marketing counts refresh every 5 minutes (ISR) — not a per-request query storm.
// Counts come from the get_public_stats() SECURITY DEFINER RPC (firewall-safe:
// aggregate numbers only, no rows/PII, no service-role key). The base tables are
// not anon-readable under RLS, so a direct anon count returns 0 — the RPC is what
// makes the public count correct.
export const revalidate = 300;

export default async function HomePage() {
  // The hero shows ONLY what is genuinely available this week (the RPC mirrors
  // the portal boards' status filters + a ±7-day window). These are real
  // figures, so a live 0 is the TRUTH and must render as 0 — no inflated
  // baseline. The browser re-fetches and lands on the current count.
  let cargoCount = 0;
  let vesselCount = 0;
  let zoneCount = 0;

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
    if (!error && s) {
      if (typeof s.cargo_count === "number") cargoCount = s.cargo_count;
      if (typeof s.vessel_count === "number") vesselCount = s.vessel_count;
      if (typeof s.zone_count === "number") zoneCount = s.zone_count;
    }
  } catch {
    // RPC unavailable — leave at 0 (honest) rather than render a fabricated
    // figure; the browser refresh in HomeClient will fill it in.
  }

  return (
    <HomeClient
      cargoCount={cargoCount}
      vesselCount={vesselCount}
      zoneCount={zoneCount}
    />
  );
}
