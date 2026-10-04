import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAppUserRow } from "@/lib/app-user";
import { loadViewerContext, loadVesselViews } from "@/lib/portal/data";
import { ComingSoon } from "@/components/portal/ComingSoon";
import { isCalculatorLocked } from "@/lib/portal/tier-gate";
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
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { tier, role } = await loadViewerContext();
  // Admin-only until a published SCA toll table and SDR rate exist in
  // production (PLAN-voyage-economics §5); then T3+ through the tier gate.
  if (role !== "admin") return <ComingSoon variant="compass" />;
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Suez Canal Transit Cost" />;

  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  let context: SuezTariffContextResult = { found: false, date: today };
  try { context = await getSuezTariffContext(supabase, today); } catch { /* the calculator shows the unavailable state */ }
  const [vessels, viewer] = await Promise.all([
    role === "admin" ? loadAdminVesselOptions() : loadVesselViews({ mine: true }).then((r) => r.views.map(suezOptionFromView)),
    getAppUserRow(supabase, user.id, "id"),
  ]);

  return (
    <SuezCalculator
      vessels={vessels}
      initialContext={context}
      viewerUserId={viewer?.id ?? null}
      initialVesselId={typeof params.vessel === "string" ? params.vessel : undefined}
    />
  );
}
