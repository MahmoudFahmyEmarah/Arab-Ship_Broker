import { requireAdmin, getAdminSupabaseClient } from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ADMIN_PRESETS, OWNER_ONLY, ADMIN_SECTIONS, type AdminPerms } from "@/lib/admin/sections";
import { PromoteControl, DemoteControl } from "./AdminControls";

export const metadata = { title: "Admins — Arab ShipBroker" };
export const dynamic = "force-dynamic";

type Row = {
  id: string; full_name: string | null; email: string;
  role: string; admin_tier: string | null; admin_perms: AdminPerms | null;
};

function presetLabel(perms: AdminPerms | null): string {
  if (!perms) return "Custom";
  for (const [, p] of Object.entries(ADMIN_PRESETS)) {
    if (JSON.stringify(p.perms) === JSON.stringify(perms)) return p.label;
  }
  return "Custom";
}

export default async function AdminsPage() {
  // Owner-only: manages other admins.
  await requireAdmin({ section: "admins" });
  const supabase = await getAdminSupabaseClient();

  const { data: adminRows } = await supabase
    .from("users")
    .select("id, full_name, email, role, admin_tier, admin_perms")
    .eq("role", "admin")
    .order("admin_tier", { ascending: true });
  const admins = (adminRows ?? []) as Row[];

  const { data: memberRows } = await supabase
    .from("users")
    .select("id, full_name, email, role, admin_tier, admin_perms")
    .neq("role", "admin")
    .eq("is_active", true)
    .order("full_name")
    .limit(200);
  const members = (memberRows ?? []) as Row[];

  const sectionLabel = (id: string) =>
    ADMIN_SECTIONS.find((s) => s.id === id) ? id : id;

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Admins"
        subtitle="Superior Admin has every section. Sub-admins get a permission preset; ETA and this page stay owner-only."
      />

      <div className="dp-card p-5 mb-6">
        <p className="text-xs font-bold text-asb-gray-400 uppercase tracking-wider mb-3">Current admins</p>
        <div className="divide-y divide-slate-100">
          {admins.map((a) => (
            <div key={a.id} className="flex items-center gap-3 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-asb-navy truncate">{a.full_name ?? "—"}</p>
                <p className="text-xs text-asb-gray-500 truncate">{a.email}</p>
              </div>
              {(a.admin_tier ?? "super") === "super" ? (
                <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-asb-blue-light text-asb-blue border border-asb-blue/30">Superior Admin</span>
              ) : (
                <>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-asb-gray-100 text-asb-gray-700 border border-asb-gray-200" title={Object.entries(a.admin_perms ?? {}).map(([k, v]) => `${sectionLabel(k)}: ${v}`).join(" · ")}>
                    {presetLabel(a.admin_perms)}
                  </span>
                  <DemoteControl userId={a.id} />
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="dp-card p-5 mb-6">
        <p className="text-xs font-bold text-asb-gray-400 uppercase tracking-wider mb-1">Promote an existing member</p>
        <p className="text-xs text-asb-gray-500 mb-3">
          Pick a permission preset and promote. (New admins are always promoted from existing accounts — there is no email-invite flow.)
        </p>
        <div className="divide-y divide-slate-100">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-asb-navy truncate">{m.full_name ?? "—"}</p>
                <p className="text-xs text-asb-gray-500 truncate">{m.email} · {m.role.replace("_", " ")}</p>
              </div>
              <PromoteControl userId={m.id} />
            </div>
          ))}
          {members.length === 0 && (
            <p className="text-sm text-asb-gray-500 py-3">No active members to promote.</p>
          )}
        </div>
      </div>

      <div className="dp-card p-5">
        <p className="text-xs font-bold text-asb-gray-400 uppercase tracking-wider mb-3">Presets</p>
        <div className="grid grid-cols-2 max-[900px]:grid-cols-1 gap-3">
          {Object.entries(ADMIN_PRESETS).map(([k, p]) => (
            <div key={k} className="dp-zone p-3">
              <p className="text-sm font-semibold text-asb-navy">{p.label}</p>
              <p className="text-xs text-asb-gray-500 mt-0.5">{p.blurb}</p>
              <p className="text-[11px] text-asb-gray-400 mt-1.5">
                {Object.entries(p.perms).map(([s, v]) => `${s}: ${v}`).join(" · ")}
              </p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-asb-gray-400 mt-3">
          Owner-only (never granted to subs): {Object.keys(OWNER_ONLY).join(", ")}.
        </p>
      </div>
    </div>
  );
}
