import { createClient } from "@supabase/supabase-js";
import { HomeClient } from "./home-client";

// Marketing counts refresh every 5 minutes (ISR) — not a per-request query storm.
// Pure anon client (no cookies) so the page stays statically revalidated.
export const revalidate = 300;

export default async function HomePage() {
  // Fallbacks — never render 0/NaN if a count fails.
  let cargoCount = 167;
  let vesselCount = 62;
  let zoneCount = 14;

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const [cargo, vessels, zones] = await Promise.all([
      supabase.from("cargo_listings").select("*", { count: "exact", head: true }),
      supabase.from("vessels").select("*", { count: "exact", head: true }),
      // Trade Zones = distinct zones that currently have listings (live product
      // meaning), derived from the data rather than hardcoded.
      supabase.from("cargo_listings").select("load_zone, disch_zone"),
    ]);
    if (typeof cargo.count === "number") cargoCount = cargo.count;
    if (typeof vessels.count === "number") vesselCount = vessels.count;
    const set = new Set<string>();
    for (const r of (zones.data ?? []) as {
      load_zone: string | null;
      disch_zone: string | null;
    }[]) {
      if (r.load_zone) set.add(r.load_zone);
      if (r.disch_zone) set.add(r.disch_zone);
    }
    if (set.size > 0) zoneCount = set.size;
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
