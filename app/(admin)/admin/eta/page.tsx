import { requireAdmin } from "@/lib/admin/require-admin";
import { EtaConsole } from "@/components/portal/EtaConsole";

export const metadata = { title: "ETA e-invoicing — Admin" };

export default async function AdminEtaPage() {
  // Owner-only (tax credentials) — sub-admins are bounced regardless of perms.
  await requireAdmin({ section: "eta" });
  return <EtaConsole />;
}
