"use client";

// My Company — team management for an organization's admin. Approve the
// pending seats teammates created at signup, set broker/admin, remove. Org-
// admin gated at the DB (fn_org_manage_member). If the viewer isn't an org
// admin, it shows their own membership state instead.
import * as React from "react";
import { toast } from "sonner";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  getMyAdminOrgId,
  getMyMembership,
  getOrgTeam,
  manageMember,
  type TeamMember,
  type Membership,
  type MemberAction,
} from "@/sdk/app/org";
import { IconDoc } from "./icons";

function RoleBadge({ role }: { role: string }) {
  const admin = role === "admin";
  return (
    <span className="asb-badge" style={{ background: admin ? "var(--asb-blue-light)" : "var(--asb-gray-100)", color: admin ? "var(--asb-blue)" : "var(--asb-gray-700)" }}>
      {admin ? "Admin" : role === "viewer" ? "Viewer" : "Broker"}
    </span>
  );
}

export function TeamBoard() {
  const supabase = React.useMemo(() => getSupabaseBrowserClient(), []);
  const [loading, setLoading] = React.useState(true);
  const [orgId, setOrgId] = React.useState<string | null>(null);
  const [membership, setMembership] = React.useState<Membership | null>(null);
  const [team, setTeam] = React.useState<TeamMember[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const [adminOrg, mem] = await Promise.all([getMyAdminOrgId(supabase), getMyMembership(supabase)]);
    setOrgId(adminOrg);
    setMembership(mem);
    if (adminOrg) {
      try { setTeam(await getOrgTeam(supabase, adminOrg)); } catch { setTeam([]); }
    }
    setLoading(false);
  }, [supabase]);
  React.useEffect(() => { void load(); }, [load]);

  const act = async (userId: string, action: MemberAction) => {
    if (!orgId) return;
    if (action === "remove" && !window.confirm("Remove this member from your company?")) return;
    setBusy(userId + action);
    try {
      await manageMember(supabase, orgId, userId, action);
      setTeam(await getOrgTeam(supabase, orgId));
      toast.success("Team updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: "var(--asb-gray-500)", fontSize: 13 }}>Loading…</div>;
  }

  // Not an org admin → show membership status / how to set one up.
  if (!orgId) {
    return (
      <div style={{ padding: "16px 20px" }}>
        <h1 className="page-title">My Company</h1>
        <div className="settings-card" style={{ marginTop: 14, maxWidth: 560 }}>
          <div className="head">
            <span className="icon-box" style={{ background: "var(--asb-blue-light)", color: "var(--asb-blue)" }}><IconDoc size={16} /></span>
            <span className="title">Company membership</span>
          </div>
          {membership ? (
            <>
              <div className="settings-row"><span className="k">Company</span><span className="v">{membership.org_name}</span></div>
              <div className="settings-row"><span className="k">Your seat</span><span className="v"><RoleBadge role={membership.member_role} /></span></div>
              <div className="settings-row"><span className="k">Status</span><span className="v">{membership.status === "pending" ? <span style={{ color: "var(--asb-amber)" }}>Pending your admin’s approval</span> : membership.status === "active" ? <><span className="asb-dot green" /> Active</> : membership.status}</span></div>
              <div style={{ fontSize: 11.5, color: "var(--asb-gray-500)", marginTop: 8 }}>
                You’re a member of {membership.org_name}. Team management is available to your company’s admin.
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--asb-gray-700)", lineHeight: 1.6 }}>
              You’re not part of a company yet. Register or join one when signing up, or ask Arab ShipBroker to link your account to your company.
            </div>
          )}
        </div>
      </div>
    );
  }

  const pending = team.filter((m) => m.status === "pending");
  const active = team.filter((m) => m.status === "active");

  const Row = ({ m, isPending }: { m: TeamMember; isPending?: boolean }) => (
    <div className="dp-zone" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--asb-ink)" }}>{m.full_name || "—"}</div>
        <div style={{ fontSize: 11, color: "var(--asb-gray-500)" }}>{m.email}{m.requested_email_domain ? ` · @${m.requested_email_domain}` : ""}</div>
      </div>
      {!isPending && <RoleBadge role={m.member_role} />}
      <div style={{ display: "flex", gap: 6 }}>
        {isPending ? (
          <>
            <button className="asb-btn primary" disabled={busy === m.user_id + "approve"} onClick={() => act(m.user_id, "approve")} style={{ fontSize: 11 }}>Approve</button>
            <button className="asb-btn" disabled={busy === m.user_id + "reject"} onClick={() => act(m.user_id, "reject")} style={{ fontSize: 11 }}>Reject</button>
          </>
        ) : (
          <>
            {m.member_role === "admin" ? (
              <button className="asb-btn" disabled={busy === m.user_id + "make_broker"} onClick={() => act(m.user_id, "make_broker")} style={{ fontSize: 11 }}>Make broker</button>
            ) : (
              <button className="asb-btn" disabled={busy === m.user_id + "make_admin"} onClick={() => act(m.user_id, "make_admin")} style={{ fontSize: 11 }}>Make admin</button>
            )}
            <button className="asb-btn danger" disabled={busy === m.user_id + "remove"} onClick={() => act(m.user_id, "remove")} style={{ fontSize: 11 }}>Remove</button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ padding: "16px 20px", maxWidth: 720 }}>
      <h1 className="page-title">My Company · Team</h1>
      <div style={{ fontSize: 12, color: "var(--asb-gray-500)", marginTop: 2 }}>
        Approve teammates, set their seat (admin / broker), or remove them. You’re the company admin.
      </div>

      {pending.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Pending requests ({pending.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map((m) => <Row key={m.user_id} m={m} isPending />)}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Team ({active.length})</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {active.length === 0 ? (
            <div className="dp-zone" style={{ padding: 14, fontSize: 12.5, color: "var(--asb-gray-500)" }}>No active members yet.</div>
          ) : (
            active.map((m) => <Row key={m.user_id} m={m} />)
          )}
        </div>
      </div>
    </div>
  );
}
