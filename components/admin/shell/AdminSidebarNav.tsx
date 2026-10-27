"use client";

// Admin grouped sidebar — the design's navy console rail (Portal standalone 7): "Admin Console / Arab
// ShipBroker" header with a collapse toggle, the grouped taxonomy with the design system's icons, an amber
// count badge, and "Back to platform" at the foot. Filters by the viewer's tier/perms
// (the server requireAdmin gate on every page is the real enforcement; this is
// the UX layer), shows a "view" badge on view-only sections, count badges, and
// super-only items.
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV } from "@/lib/admin/nav";
import { canAccess, type AdminTier, type AdminPerms } from "@/lib/admin/sections";
import { AdminIcon } from "./icons";
import { IconBack, IconSidebar } from "@/components/portal/icons";

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin/dashboard") return pathname === "/admin/dashboard" || pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSidebarNav({
  tier,
  perms,
  counts,
}: {
  tier: AdminTier;
  perms: AdminPerms | null;
  counts?: Record<string, number>;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);

  const groups = ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.superOnly) return tier === "super";
      return canAccess(item.id, tier, perms) !== "none";
    }),
  })).filter((g) => g.items.length > 0);

  return (
    <aside className={`adm-side${collapsed ? " is-collapsed" : ""}`}>
      <div className="adm-side__head">
        {!collapsed && (
          <Link href="/admin/dashboard" className="adm-side__brand">
            <span className="adm-side__brandname">Admin Console</span>
            <span className="adm-side__brandsub">Arab ShipBroker</span>
          </Link>
        )}
        <button
          type="button"
          className="adm-side__toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand the admin menu" : "Collapse the admin menu"}
          aria-expanded={!collapsed}
          title="Toggle sidebar"
        >
          <IconSidebar size={16} />
        </button>
      </div>
      <nav className="adm-side__scroll" aria-label="Admin console">
        {groups.map((group) => (
          <React.Fragment key={group.section}>
            {!collapsed && <div className="adm-side__section">{group.section}</div>}
            <div className="adm-side__group">
              {group.items.map((item) => {
                const access = item.superOnly ? "edit" : canAccess(item.id, tier, perms);
                const count = item.countKey ? counts?.[item.countKey] : undefined;
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={`adm-side__item${active ? " is-on" : ""}`}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                  >
                    <AdminIcon name={item.icon} />
                    {!collapsed && <span className="adm-side__label">{item.label}</span>}
                    {!collapsed && access === "view" && (
                      <span className="adm-side__viewbadge" title="View only">view</span>
                    )}
                    {!collapsed && count != null && count > 0 && <span className="adm-side__count">{count}</span>}
                  </Link>
                );
              })}
            </div>
          </React.Fragment>
        ))}
      </nav>
      <div className="adm-side__foot">
        <Link href="/dashboard" className="adm-side__item" title={collapsed ? "Back to platform" : undefined}>
          <span className="adm-side__icon"><IconBack size={16} /></span>
          {!collapsed && <span className="adm-side__label">Back to platform</span>}
        </Link>
      </div>
    </aside>
  );
}
