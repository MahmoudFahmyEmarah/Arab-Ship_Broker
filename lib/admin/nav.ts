// Admin navigation taxonomy — the grouped sidebar IA from the design handoff
// (14_admin_rebuild), mapped onto this app's REAL admin routes. Import-free so
// both the server layout and the client sidebar consume one definition.
//
// `section` ids match the authorization ids in sections.ts (canAccess). Icon
// keys are the design system's Icon names (components/admin/shell/icons.tsx).

export type AdminNavItem = {
  id: string; // authorization id (canAccess) — also used for the active match
  label: string;
  href: string;
  icon: string; // key into ADMIN_ICONS
  superOnly?: boolean;
  countKey?: string; // optional dynamic count (e.g. "review")
};

export type AdminNavGroup = { section: string; items: AdminNavItem[] };

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    section: "Overview",
    items: [{ id: "dashboard", label: "Dashboard", href: "/admin/dashboard", icon: "Dashboard" }],
  },
  {
    section: "Listings",
    items: [
      { id: "review", label: "Review queue", href: "/admin/queue", icon: "DocAudit", countKey: "review" },
      { id: "cargo", label: "Cargo listings", href: "/admin/cargo", icon: "Cargo" },
      { id: "vesselavail", label: "Vessel availability", href: "/admin/vessel-availability", icon: "Vessel" },
    ],
  },
  {
    section: "Users",
    items: [
      { id: "users", label: "All users", href: "/admin/users", icon: "User" },
      { id: "orgmembers", label: "Companies", href: "/admin/org-members", icon: "Globe" },
      { id: "groupmail", label: "Group Mail", href: "/admin/group-mail", icon: "Mail", superOnly: true },
    ],
  },
  {
    section: "Platform data",
    items: [
      { id: "vessels", label: "Vessel intel", href: "/admin/vessels", icon: "Shield" },
      { id: "commodities", label: "Commodities", href: "/admin/commodities", icon: "Layers" },
      { id: "ports", label: "Ports", href: "/admin/ports", icon: "Anchor" },
      { id: "risk", label: "Risk areas", href: "/admin/risk-areas", icon: "Map" },
      { id: "bunker", label: "Bunker ticker", href: "/admin/bunker", icon: "TrendUp" },
      { id: "safety", label: "Intelligence rules", href: "/admin/safety-questions", icon: "Sliders" },
    ],
  },
  {
    section: "Data",
    items: [
      { id: "datasync", label: "Data Sync", href: "/admin/data-sync", icon: "Clock", superOnly: true, countKey: "sync" },
    ],
  },
  {
    section: "Platform",
    items: [
      { id: "stats", label: "Analytics", href: "/admin/stats", icon: "MarketBars" },
      { id: "messages", label: "Messages", href: "/admin/messages", icon: "Bell", countKey: "messages" },
      { id: "eta", label: "ETA / tax console", href: "/admin/eta", icon: "Doc", superOnly: true },
      { id: "admins", label: "Admin accounts", href: "/admin/admins", icon: "ShieldLock", superOnly: true },
      { id: "settings", label: "Platform settings", href: "/admin/settings", icon: "Settings", superOnly: true },
    ],
  },
];
