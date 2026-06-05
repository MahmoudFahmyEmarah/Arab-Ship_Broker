"use client";

// Admin sidebar (amber zone), ported from the design (asb/sidebar.jsx admin
// zone + admin/admin-roles.js). Role-gated via admCanAccess; "view" sections
// get a view-only badge. Links to the app's real /admin/* routes.
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminCtx, admCanAccess, ADMIN_PROFILES } from "@/lib/portal/admin-roles";
import { IconSidebar, IconSignOut } from "./icons";

const I = {
  dash: "M3.5 3.5h7v7h-7zM13.5 3.5h7v7h-7zM3.5 13.5h7v7h-7zM13.5 13.5h7v7h-7z",
  queue: "M3 5h12M3 9h12M3 13h8",
  list: "M4 5h12M4 9h12M4 13h12",
  users: "M8 8a3 3 0 100-5 3 3 0 000 5zM3 19c0-3 2.5-5 5-5s5 2 5 5",
  ship: "M3 14h14l-2 4H5zM7 14V7h6v7",
  port: "M10 4v14M5 18h10M7 9h6",
  box: "M4 7l6-3 6 3v8l-6 3-6-3z",
  msg: "M4 5h12v8H8l-4 3z",
  shield: "M10 3l6 2v5c0 4-3 6-6 7-3-1-6-3-6-7V5z",
  doc: "M6 3h6l3 3v11H6z",
  gear: "M10 7a3 3 0 100 6 3 3 0 000-6zM10 2v2M10 16v2M2 10h2M16 10h2",
};
function Glyph({ d, color }: { d: string; color: string }) {
  return (
    <svg className="nav-icon" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      {d.split("M").filter(Boolean).map((seg, i) => <path key={i} d={"M" + seg} />)}
    </svg>
  );
}

interface AdmNav { id: string; href: string; label: string; icon: string; count?: number }
const NAV: AdmNav[] = [
  { id: "dashboard", href: "/admin/dashboard", label: "Dashboard", icon: I.dash },
  { id: "review", href: "/admin/queue", label: "Review queue", icon: I.queue, count: 7 },
  { id: "listings", href: "/admin/cargo", label: "Cargo listings", icon: I.list },
  { id: "listings", href: "/admin/vessels", label: "Vessels", icon: I.ship },
  { id: "listings", href: "/admin/vessel-availability", label: "Vessel availability", icon: I.ship },
  { id: "users", href: "/admin/users", label: "All users", icon: I.users },
  { id: "commod", href: "/admin/commodities", label: "Commodities", icon: I.box },
  { id: "ports", href: "/admin/ports", label: "Ports", icon: I.port },
  { id: "rules", href: "/admin/safety-questions", label: "Safety questions", icon: I.shield },
  { id: "announ", href: "/admin/messages", label: "Messages", icon: I.msg },
  { id: "eta", href: "/admin/eta", label: "ETA e-invoicing", icon: I.doc },
];

export function AdminSidebar({ ctx, userName = "Admin" }: { ctx: AdminCtx; userName?: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const profile = ctx.role === "super" ? ADMIN_PROFILES.super : null;

  const items = NAV.map((n) => ({ n, access: admCanAccess(n.id, ctx) })).filter((x) => x.access !== "none");
  const activeHref = items.map((x) => x.n.href).filter((h) => pathname === h || pathname.startsWith(h + "/")).sort((a, b) => b.length - a.length)[0];

  return (
    <aside style={{ width: collapsed ? "var(--sidebar-w-collapsed)" : "var(--sidebar-w)", flexShrink: 0, background: "var(--asb-white)", borderRight: "var(--bd)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", gap: 8, padding: collapsed ? "12px 0" : "14px 16px", borderBottom: "var(--bd)", height: 56 }}>
        {!collapsed && (
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--asb-navy)", lineHeight: 1.1 }}>Arab ShipBroker</div>
              <span style={{ background: "#EF9F27", color: "#1B3A5C", fontSize: 8, fontWeight: 700, letterSpacing: "0.12em", padding: "1.5px 6px", borderRadius: 99, textTransform: "uppercase" }}>Admin</span>
            </div>
            <div style={{ fontSize: 9, color: "var(--asb-gray-500)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 2 }}>Console</div>
          </div>
        )}
        <button onClick={() => setCollapsed((v) => !v)} style={{ background: "transparent", border: "none", padding: 4, color: "var(--asb-gray-500)", cursor: "pointer" }} title="Toggle"><IconSidebar size={16} /></button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {!collapsed && (
          <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: "#854F0B", fontWeight: 600, padding: "10px 14px 4px", display: "flex", alignItems: "center", gap: 6 }}>
            <span>Admin</span>
            {profile && <span style={{ marginLeft: "auto", fontSize: 8.5, fontWeight: 700, color: "#854F0B", background: "#FAEEDA", border: "0.5px solid #EF9F27", padding: "1px 5px", borderRadius: 3 }}>{profile.short}</span>}
          </div>
        )}
        {items.map(({ n, access }) => {
          const active = n.href === activeHref;
          return (
            <Link key={n.href} href={n.href} className={`nav-item admin ${active ? "is-active" : ""}`} title={collapsed ? n.label : undefined} style={collapsed ? { justifyContent: "center", padding: "10px 0" } : undefined}>
              <span className="nav-icon" style={{ display: "inline-flex", color: active ? "#854F0B" : "#B17311" }}><Glyph d={n.icon} color="currentColor" /></span>
              {!collapsed && <span style={{ flex: 1 }}>{n.label}</span>}
              {!collapsed && access === "view" && <span style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", color: "#8B95A3", background: "#F0F2F5", border: "0.5px solid #DDE2EA", padding: "1px 4px", borderRadius: 3 }}>view</span>}
              {!collapsed && access !== "view" && n.count ? <span style={{ background: active ? "#854F0B" : "#EF9F27", color: "#fff", fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 99, minWidth: 16, textAlign: "center" }}>{n.count}</span> : null}
            </Link>
          );
        })}
      </div>

      <div style={{ borderTop: "var(--bd)" }}>
        <Link href="/dashboard" className="nav-item">
          <IconSignOut size={14} />
          {!collapsed && <span style={{ flex: 1 }}>Exit to portal</span>}
        </Link>
        <div style={{ padding: collapsed ? "10px 0" : "12px 14px", display: "flex", alignItems: "center", gap: 9, borderTop: "var(--bd)", justifyContent: collapsed ? "center" : "flex-start" }}>
          <div style={{ width: 32, height: 32, borderRadius: 99, background: "#FAEEDA", color: "#854F0B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>{userName.split(" ").map((p) => p[0]).join("").slice(0, 2)}</div>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--asb-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{userName}</div>
              <div style={{ fontSize: 10, color: "#854F0B", letterSpacing: "0.07em", textTransform: "uppercase", marginTop: 2 }}>{profile?.label ?? "Admin"}</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
