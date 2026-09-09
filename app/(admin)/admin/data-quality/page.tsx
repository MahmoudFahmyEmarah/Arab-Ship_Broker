// Admin → Data quality. Access: section "dataquality" (owner and the IT preset
// edit; broker views and runs). Write levels are enforced in actions.ts.
import { requireAdmin } from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataQualityConsole } from "@/components/admin/data-quality/DataQualityConsole";
import { getDqBootstrap } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data quality · Admin" };

export default async function DataQualityPage() {
  await requireAdmin({ section: "dataquality" });
  const boot = await getDqBootstrap();
  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Data quality"
        subtitle="One rule engine, three surfaces: form-time messages, the write-time gate, and batch audits. Every fix is audited and undoable."
      />
      {!boot.success ? <div className="adm-empty">{boot.error}</div> : <DataQualityConsole boot={boot.data} />}
    </div>
  );
}
