"use client";

// Admin grouped sidebar — the design's navy rail: brand block (logo mark +
// "Arab ShipBroker / Admin console"), the 6-group taxonomy with the design
// system's icons, baby-blue active stripe. Filters by the viewer's tier/perms
// (the server requireAdmin gate on every page is the real enforcement; this is
// the UX layer), shows a "view" badge on view-only sections, count badges, and
// super-only items.
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV } from "@/lib/admin/nav";
import { canAccess, type AdminTier, type AdminPerms } from "@/lib/admin/sections";
import { AdminIcon } from "./icons";
import { ASB_LOGO_MASK } from "./logo-mask";

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

  const groups = ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.superOnly) return tier === "super";
      return canAccess(item.id, tier, perms) !== "none";
    }),
  })).filter((g) => g.items.length > 0);

  return (
    <aside className="adm-side">
      <Link href="/admin/dashboard" className="adm-side__brand">
        <span
          className="adm-side__mark"
          aria-hidden
          style={{ WebkitMaskImage: `url(${ASB_LOGO_MASK})`, maskImage: `url(${ASB_LOGO_MASK})` }}
        />
        <span className="adm-side__brandtext">
          Arab ShipBroker
          <small>Admin console</small>
        </span>
      </Link>
      {groups.map((group) => (
        <React.Fragment key={group.section}>
          <div className="adm-side__section">{group.section}</div>
          <div className="adm-side__group">
            {group.items.map((item) => {
              const access = item.superOnly ? "edit" : canAccess(item.id, tier, perms);
              const count = item.countKey ? counts?.[item.countKey] : undefined;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`adm-side__item${isActive(pathname, item.href) ? " is-on" : ""}`}
                >
                  <AdminIcon name={item.icon} />
                  <span className="adm-side__label">{item.label}</span>
                  {access === "view" && (
                    <span className="adm-side__viewbadge" title="View only">view</span>
                  )}
                  {count != null && count > 0 && <span className="adm-side__count">{count}</span>}
                </Link>
              );
            })}
          </div>
        </React.Fragment>
      ))}
    </aside>
  );
}
