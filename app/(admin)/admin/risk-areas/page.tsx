import { requireAdmin } from "@/lib/admin/require-admin";
import { canAccess } from "@/lib/admin/sections";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { RiskAreasClient } from "@/components/admin/risk/RiskAreasClient";
import { listRiskAreas } from "./actions";

export const dynamic = "force-dynamic";

export default async function RiskAreasPage() {
  const admin = await requireAdmin({ section: "risk" });
  const canEdit = canAccess("risk", admin.tier, admin.perms) === "edit";
  const areas = await listRiskAreas();

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Risk areas"
        subtitle="War zones, high-risk and advisory areas drawn on the chart. Any route on the market map that crosses an active area shows an insurance-premium alert."
        warn="Shapes are approximations of the JWC listed areas — refine them here as the market changes. Changes are live for all users immediately."
      />
      <RiskAreasClient initial={areas} canEdit={canEdit} />
    </div>
  );
}
