import { requireAdmin } from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { OrgMemberRequests } from "@/components/admin/OrgMemberRequests";
import { listContacts, listPendingRequests } from "./actions";
import { ContactsRegistry } from "@/components/admin/ContactsRegistry";
import { canAccess } from "@/lib/admin/sections";

export const metadata = { title: "Company Members Admin" };

export default async function AdminOrgMembersPage() {
  const admin = await requireAdmin({ section: "orgmembers" });
  const [pending, contacts] = await Promise.all([listPendingRequests(), listContacts()]);
  const canErase = canAccess("orgmembers", admin.tier, admin.perms) === "edit";

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Company Members"
        subtitle="Confirm people who requested to join a pre-boarded company. Approving grants access to that firm's confidential vessel records, so review before confirming."
      />
      <OrgMemberRequests initial={pending} />
      <ContactsRegistry initial={contacts.ok ? contacts.rows : []} canErase={canErase} />
    </div>
  );
}
