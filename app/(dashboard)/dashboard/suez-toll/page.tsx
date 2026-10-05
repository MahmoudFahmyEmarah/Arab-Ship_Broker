import { redirect } from "next/navigation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadVesselViews } from "@/lib/portal/data";
import { ComingSoon } from "@/components/portal/ComingSoon";
import { resolveCalculatorAccess } from "@/lib/voyage/calculator-access";
import { CalculatorLocked } from "@/components/portal/calculators";
import { SuezCalculator } from "@/components/suez/SuezCalculator";
import { getSuezTariffContext } from "@/sdk/app/suez";
import type { SuezTariffContextResult } from "@/lib/suez/types";
import { suezOptionFromAdminRow, suezOptionFromView, type AdminVesselRow, type SuezVesselOption } from "@/lib/suez/vessel-options";

export const metadata = { title: "Suez Canal Transit Cost Arab ShipBroker" };
export const dynamic = "force-dynamic";

// Admins pick from every current position with its hull facts. The vessel
// master is closed to the authenticated role by the market firewall, so this
// read uses the service role on the server, after the admin gate above.
async function loadAdminVesselOptions(): Promise<SuezVesselOption[]> {
  const db = getSupabaseAdminClient();
  const { data } = await db
    .from("vessel_availability")
    .select("id, vessel_id, vessel:vessels(id, vessel_name, imo_number, vessel_type, dwt_grain, gross_tonnage, scnrt, build_year)")
    .order("open_date", { ascending: false })
    .limit(300);
  const seen = new Set<string>();
  const out: SuezVesselOption[] = [];
  for (const row of (data ?? []) as unknown as AdminVesselRow[]) {
    const opt = suezOptionFromAdminRow(row);
    if (!opt || !opt.vesselId || seen.has(opt.vesselId)) continue;
    seen.add(opt.vesselId);
    out.push(opt);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export default async function SuezTollPage({ searchParams }: { searchParams: Promise<{ vessel?: string | string[] }> }) {
  // One entitlement rule for this page and every calculator action (lib/voyage/calculator-policy.ts):
  // active profile; admin (row + Auth claim) or, once the member rollout opens, T3/T4.
  const { access, supabase } = await resolveCalculatorAccess();
  if (!access.allowed) {
    if (access.reason === "signed_out" || access.reason === "no_profile" || access.reason === "inactive") redirect("/auth/login");
    if (access.reason === "tier_locked") return <CalculatorLocked title="Suez Canal Transit Cost" />;
    return <ComingSoon variant="compass" />;
  }

  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  let context: SuezTariffContextResult = { found: false, date: today };
  try { context = await getSuezTariffContext(supabase, today); } catch { /* the calculator shows the unavailable state */ }
  const vessels = access.kind === "admin" ? await loadAdminVesselOptions() : await loadVesselViews({ mine: true }).then((r) => r.views.map(suezOptionFromView));

  return (
    <SuezCalculator
      vessels={vessels}
      initialContext={context}
      viewerUserId={access.actorId}
      initialVesselId={typeof params.vessel === "string" ? params.vessel : undefined}
    />
  );
}
