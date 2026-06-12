"use client";

// Portal sidebar, ported from the Claude design (asb/sidebar.jsx) to TS and
// wired to the app's real route shape + roles. `basePath` lets the same
// sidebar drive the /portal preview now and the real /dashboard later.
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { logout } from "@/sdk/auth";
import { useViewerTier, isCalculatorLocked } from "@/lib/portal/tier";
import {
  IconDashboard,
  IconCargo,
  IconVessel,
  IconVoyage,
  IconSettings,
  IconDoc,
  IconSidebar,
  IconBell,
  IconSignOut,
} from "./icons";

export type PortalRole = "cargo_owner" | "vessel_owner" | "broker" | "admin";

type Glyph = (active: boolean) => React.ReactNode;

interface NavDef {
  href: string;
  label: string;
  glyph: Glyph;
  action?: boolean;
  section?: string;
  disabled?: boolean;
}

// Module-scope (stable) nav item — `activeHref`/`collapsed` are passed in so the
// component is never re-created during render.
function NavItem({
  href,
  label,
  glyph,
  action,
  disabled,
  activeHref,
  collapsed,
}: NavDef & { activeHref?: string; collapsed: boolean }) {
  const active = href === activeHref;
  if (disabled) {
    // Tier-gated (T3+) — shown but not navigable, with an explanatory tooltip.
    return (
      <div
        className="nav-item"
        title="Available from Subscriber tier (T3+)"
        style={{ opacity: 0.45, cursor: "not-allowed", ...(collapsed ? { justifyContent: "center", padding: "10px 0" } : null) }}
        aria-disabled="true"
      >
        {glyph(false)}
        {!collapsed && (
          <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
            {label}
            <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.06em", color: "var(--asb-gray-500)", border: "0.5px solid var(--asb-gray-300, #cdd5e0)", borderRadius: 3, padding: "0 3px" }}>T3+</span>
          </span>
        )}
      </div>
    );
  }
  return (
    <Link
      href={href}
      className={`nav-item ${action ? "action" : ""} ${active ? "is-active" : ""}`}
      title={collapsed ? label : undefined}
      style={collapsed ? { justifyContent: "center", padding: "10px 0" } : undefined}
    >
      {glyph(active)}
      {!collapsed && <span style={{ flex: 1 }}>{label}</span>}
    </Link>
  );
}

export function PortalSidebar({
  role = "broker",
  userName = "John Smith",
  basePath = "/dashboard",
}: {
  role?: PortalRole;
  userName?: string;
  basePath?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout(getSupabaseBrowserClient());
      router.push("/auth/login");
      router.refresh();
    } catch {
      toast.error("Couldn't sign out — please try again.");
      setSigningOut(false);
    }
  };
  const tier = useViewerTier();
  const econLocked = isCalculatorLocked(tier);
  const limitedTier = tier === "T1" || tier === "T2";

  const isCargo = role === "broker" || role === "cargo_owner" || role === "admin";
  const isVessel = role === "broker" || role === "vessel_owner" || role === "admin";
  const c = (a: boolean) => (a ? "var(--asb-blue)" : "var(--asb-gray-500)");

  const nav: (NavDef | { section: string })[] = [
    { section: "Overview" },
    { href: `${basePath}`, label: "Dashboard", glyph: (a) => <IconDashboard className="nav-icon" size={16} color={c(a)} /> },
    ...(isCargo || isVessel ? [{ section: "Workspace" } as const] : []),
    ...(isCargo
      ? [
          { href: `${basePath}/cargo/my`, label: "My Cargo", glyph: (a: boolean) => <IconCargo className="nav-icon" size={16} color={c(a)} /> },
          { href: `${basePath}/cargo/create`, label: "Post Cargo", action: true, glyph: () => <IconCargo className="nav-icon" size={16} color="var(--asb-blue)" plus /> },
        ]
      : []),
    ...(isVessel
      ? [
          { href: `${basePath}/vessels`, label: "My Vessels", glyph: (a: boolean) => <IconVessel className="nav-icon" size={16} color={c(a)} /> },
          { href: `${basePath}/vessels/register`, label: "Post Position", action: true, glyph: () => <IconVessel className="nav-icon" size={16} color="var(--asb-blue)" plus /> },
        ]
      : []),
    { section: "Discover" },
    ...(isCargo ? [{ href: `${basePath}/cargo`, label: "Cargo Market", glyph: (a: boolean) => <IconCargo className="nav-icon" size={16} color={c(a)} /> }] : []),
    ...(isVessel ? [{ href: `${basePath}/vessels/browse`, label: "Tonnage Market", glyph: (a: boolean) => <IconVessel className="nav-icon" size={16} color={c(a)} /> }] : []),
    { section: "Economic Calculators" },
    { href: `${basePath}/voyage-estimator`, label: "Voyage Cost Estimator", disabled: econLocked, glyph: (a: boolean) => <IconVoyage className="nav-icon" size={16} color={c(a)} /> },
    { href: `${basePath}/ports-da`, label: "Ports DA Calculator", disabled: econLocked, glyph: (a: boolean) => <IconVoyage className="nav-icon" size={16} color={c(a)} /> },
    { href: `${basePath}/suez-toll`, label: "Suez Canal Toll", disabled: econLocked, glyph: (a: boolean) => <IconVoyage className="nav-icon" size={16} color={c(a)} /> },
    ...(role === "admin"
      ? [
          { section: "Admin" } as const,
          { href: `/admin/dashboard`, label: "Admin Console", glyph: (a: boolean) => <IconSettings className="nav-icon" size={16} color={c(a)} /> },
        ]
      : []),
  ];

  // Longest-prefix match so e.g. /portal/cargo/my doesn't also light Cargo Market.
  const hrefs = nav.filter((n): n is NavDef => "href" in n).map((n) => n.href);
  const activeHref = hrefs
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0];


  return (
    <aside
      className="asb-sidebar"
      style={{
        width: collapsed ? "var(--sidebar-w-collapsed)" : "var(--sidebar-w)",
        flexShrink: 0,
        background: "var(--asb-white)",
        borderRight: "var(--bd)",
        display: "flex",
        flexDirection: "column",
        transition: "width var(--t-base)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          gap: 8,
          padding: collapsed ? "12px 0" : "14px 16px",
          borderBottom: "var(--bd)",
          height: 56,
        }}
      >
        {!collapsed && (
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--asb-navy)", lineHeight: 1.1 }}>Arab ShipBroker</span>
              <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.08em", color: "var(--asb-blue)", background: "var(--asb-blue-light)", border: "0.5px solid var(--asb-blue)", borderRadius: 3, padding: "1px 4px", lineHeight: 1.2 }}>BETA</span>
            </div>
            <div style={{ fontSize: 9, color: "var(--asb-gray-500)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 2 }}>Portal</div>
          </div>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          style={{ background: "transparent", border: "none", padding: 4, color: "var(--asb-gray-500)", display: "flex", alignItems: "center", borderRadius: 3, cursor: "pointer" }}
          title="Toggle sidebar"
        >
          <IconSidebar size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column" }}>
        {nav.map((n, i) =>
          "section" in n ? (
            !collapsed ? (
              <div className="nav-section" key={`s-${i}`}>
                {n.section}
              </div>
            ) : null
          ) : (
            <NavItem key={n.href} {...n} activeHref={activeHref} collapsed={collapsed} />
          ),
        )}
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ borderTop: "var(--bd)" }}>
        {!collapsed && <div className="nav-section">Account</div>}
        <NavItem href={`${basePath}/alerts`} label="My Alerts" activeHref={activeHref} collapsed={collapsed} glyph={(a) => <IconBell className="nav-icon" size={16} color={c(a)} />} />
        <NavItem href={`${basePath}/team`} label="My Company" activeHref={activeHref} collapsed={collapsed} glyph={(a) => <IconDoc className="nav-icon" size={16} color={c(a)} />} />
        {/* Billing is a tab inside Settings (not a separate page). */}
        <NavItem href={`${basePath}/account`} label="Settings" activeHref={activeHref} collapsed={collapsed} glyph={(a) => <IconSettings className="nav-icon" size={16} color={c(a)} />} />

        <div
          style={{
            borderTop: "var(--bd)",
            padding: collapsed ? "10px 0" : "12px 14px",
            display: "flex",
            alignItems: "center",
            gap: 9,
            justifyContent: collapsed ? "center" : "flex-start",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 99,
              background: "var(--asb-blue-light)",
              color: "var(--asb-blue)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            {userName.split(" ").map((p) => p[0]).join("").slice(0, 2)}
          </div>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--asb-ink)", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {userName}
              </div>
              <div style={{ fontSize: 10, color: "var(--asb-gray-500)", letterSpacing: "0.07em", textTransform: "uppercase", marginTop: 2 }}>
                {role.replace("_", " ")}
              </div>
            </div>
          )}
        </div>

        {/* Slim upgrade pill — replaces the old full-width dashboard banner
            (which ate ~10% of the screen). Contextual lock CTAs elsewhere
            still market the tiers; this is the persistent, unobtrusive entry. */}
        {limitedTier && !collapsed && (
          <Link
            href="/dashboard/account?tab=billing"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              margin: "6px 10px 2px", padding: "6px 10px",
              background: "var(--asb-blue-light)", border: "0.5px solid var(--asb-blue)",
              borderRadius: 6, color: "var(--asb-blue)",
              fontSize: 11, fontWeight: 600, textDecoration: "none",
            }}
          >
            {tier} plan · Upgrade →
          </Link>
        )}

        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            border: "none",
            padding: collapsed ? "0 0 12px" : "0 14px 12px",
            fontSize: 11,
            color: "var(--asb-gray-500)",
            justifyContent: collapsed ? "center" : "flex-start",
            width: "100%",
            cursor: signingOut ? "default" : "pointer",
            opacity: signingOut ? 0.6 : 1,
          }}
          title={collapsed ? "Sign out" : undefined}
        >
          <IconSignOut size={12} />
          {!collapsed && (signingOut ? "Signing out…" : "Sign out")}
        </button>
      </div>
    </aside>
  );
}
