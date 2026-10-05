import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { IntelligenceRulesConsole } from "@/components/admin/intelligence-rules/IntelligenceRulesConsole";
import { requireAdmin } from "@/lib/admin/require-admin";
import { canAccess } from "@/lib/admin/sections";

import { getIntelligenceBootstrap } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Intelligence rules · Admin" };

export default async function IntelligenceRulesPage() {
  const admin = await requireAdmin({ section: "intelligence" });
  const canEdit = canAccess("intelligence", admin.tier, admin.perms) === "edit";
  const bootstrap = await getIntelligenceBootstrap();

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Intelligence rules"
        subtitle="Govern the cargo and vessel signals shown across the platform. Published versions are immutable, attributable and safe to roll back."
        warn="Create a new version for every change. Activation is a separate compare-and-swap release step; existing versions are never edited in place."
      />
      {!bootstrap.success ? (
        <div className="adm-empty" role="alert">{bootstrap.error}</div>
      ) : (
        <IntelligenceRulesConsole initial={bootstrap.data} canEdit={canEdit} />
      )}
    </div>
  );
}
