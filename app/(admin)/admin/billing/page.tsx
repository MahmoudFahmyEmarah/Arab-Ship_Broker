// Admin → Billing: the ledger console. Access: section "billing" (owner and
// the billing / accountant presets); write levels are enforced in actions.ts.
import { requireAdmin } from "@/lib/admin/require-admin";
import { canAccess } from "@/lib/admin/sections";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BillingConsole } from "@/components/admin/billing/BillingConsole";
import { getBillingOverview, getBillingSecretStatus } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Admin" };

export default async function AdminBillingPage() {
  const admin = await requireAdmin({ section: "billing" });
  const canEdit = canAccess("billing", admin.tier, admin.perms) === "edit";
  const [overview, secrets] = await Promise.all([getBillingOverview(), getBillingSecretStatus()]);

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Billing"
        subtitle="Subscriptions, invoices, payments and the Egyptian e-invoice trail. The database is the ledger; issued invoices never change."
      />
      {!overview.success ? (
        <div className="adm-empty">{overview.error}</div>
      ) : (
        <BillingConsole data={overview.data} secrets={secrets.success ? secrets.data : {}} canEdit={canEdit} />
      )}
    </div>
  );
}
