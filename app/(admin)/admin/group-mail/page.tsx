import { requireAdmin } from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { GroupMailClient } from "@/components/admin/group-mail/GroupMailClient";

export const dynamic = "force-dynamic";

export default async function GroupMailPage() {
  await requireAdmin({ section: "groupmail" });
  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Group Mail"
        subtitle="Manage the Namecheap mailing lists and send branded circulars — test first, then broadcast."
        warn={
          <span>
            Broadcasts email <strong>every member</strong> of the chosen list. Always send a test to yourself first.
          </span>
        }
      />
      <GroupMailClient />
    </div>
  );
}
