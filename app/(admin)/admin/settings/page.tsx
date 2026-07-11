import { requireAdmin } from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getPlatformMode, getComingSoonDesign, getPlatformSettings } from "@/lib/app-settings";
import { canAccess } from "@/lib/admin/sections";
import { PlatformSettings } from "@/components/admin/settings/PlatformSettings";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const admin = await requireAdmin({ section: "settings" });
  const canEdit = canAccess("settings", admin.tier, admin.perms) === "edit";

  const [mode, design, settings] = await Promise.all([
    getPlatformMode(),
    getComingSoonDesign(),
    getPlatformSettings(),
  ]);

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Administration"
        subtitle="Global application settings, AI provider, and marketplace defaults."
        warn="Changes here affect the live platform for all users."
      />

      <PlatformSettings
        initialMode={mode}
        initialDesign={design}
        initialSettings={settings}
        canEdit={canEdit}
      />
    </div>
  );
}
