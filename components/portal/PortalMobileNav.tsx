"use client";

// Mobile-only bottom tab bar (MarineTraffic-style). Hidden on desktop via CSS
// (.portal-mobilenav { display:none } until the max-width:900px breakpoint).
// The desktop PortalSidebar stays the source of truth for the full nav; this is
// the thumb-reachable subset for phones, role-aware and active-by-pathname.
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconDashboard, IconCargo, IconVessel, IconMap, IconUser } from "./icons";
import type { PortalRole } from "./PortalSidebar";

type Tab = { href: string; label: string; icon: (active: boolean) => React.ReactNode };

export function PortalMobileNav({
  role,
  basePath = "/dashboard",
  showCargo,
  showVessel,
}: {
  role: PortalRole;
  basePath?: string;
  showCargo?: boolean;
  showVessel?: boolean;
}) {
  const pathname = usePathname();
  const isCargo = showCargo ?? (role === "broker" || role === "cargo_owner" || role === "admin");
  const isVessel = showVessel ?? (role === "broker" || role === "vessel_owner" || role === "admin");
  const c = (a: boolean) => (a ? "var(--asb-blue)" : "var(--asb-gray-500)");

  // Map-first default: the market boards (which carry the chart) are the
  // primary phone surface, so they sit center.
  const tabs: Tab[] = [
    { href: `${basePath}`, label: "Dashboard", icon: (a) => <IconDashboard size={20} color={c(a)} /> },
    ...(isCargo
      ? [{ href: `${basePath}/cargo`, label: "Cargo", icon: (a: boolean) => <IconCargo size={20} color={c(a)} /> }]
      : []),
    ...(isVessel
      ? [{ href: `${basePath}/vessels/browse`, label: "Tonnage", icon: (a: boolean) => <IconVessel size={20} color={c(a)} /> }]
      : []),
    {
      href: isVessel && !isCargo ? `${basePath}/vessels` : `${basePath}/cargo/my`,
      label: "Mine",
      icon: (a) => <IconMap size={20} color={c(a)} />,
    },
    { href: `${basePath}/account`, label: "Account", icon: (a) => <IconUser size={20} color={c(a)} /> },
  ];

  const isActive = (href: string) =>
    href === basePath ? pathname === basePath : pathname === href || pathname.startsWith(href + "/");

  return (
    <nav className="portal-mobilenav" aria-label="Primary">
      {tabs.map((t) => {
        const active = isActive(t.href);
        return (
          <Link key={t.href} href={t.href} className={`pmn-tab${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined}>
            <span className="pmn-ico">{t.icon(active)}</span>
            <span className="pmn-lab">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
