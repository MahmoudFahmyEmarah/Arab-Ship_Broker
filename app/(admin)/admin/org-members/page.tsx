import { requireAdmin } from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { OrgMemberRequests } from "@/components/admin/OrgMemberRequests";
import { listPendingRequests } from "./actions";

export const metadata = { title: "Company Members — Admin" };

export default async function AdminOrgMembersPage() {
  await requireAdmin();
  const pending = await listPendingRequests();

  return (
    <div>
      <AdminPageHeader
        title="Company Members"
        subtitle="Confirm people who requested to join a pre-boarded company. Approving grants access to that firm's confidential vessel records — review before confirming."
      />
      <OrgMemberRequests initial={pending} />
    </div>
  );
}
