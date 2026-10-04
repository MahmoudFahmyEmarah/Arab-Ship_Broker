import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { MatchingRulesConsole } from "@/components/admin/matching-rules/MatchingRulesConsole";
import { requireAdmin } from "@/lib/admin/require-admin";
import { canAccess } from "@/lib/admin/sections";

import { getMatchingRulesBootstrap } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Matching rules · Admin" };

export default async function MatchingRulesPage() {
  const admin = await requireAdmin({ section: "matching" });
  const canEdit = canAccess("matching", admin.tier, admin.perms) === "edit";
  const bootstrap = await getMatchingRulesBootstrap();

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Matching rules"
        subtitle="Govern cargo-to-vessel eligibility, scoring and ranking through deterministic, versioned parameters."
        warn={(
          <span>
            Publishing rebuilds the live match cache. Preview the candidate impact, create an immutable version,
            then activate it in a separate compare-and-swap step.
          </span>
        )}
      />
      {!bootstrap.success ? (
        <div className="adm-empty" role="alert">{bootstrap.error}</div>
      ) : (
        <MatchingRulesConsole initial={bootstrap.data} canEdit={canEdit} />
      )}
    </div>
  );
}
