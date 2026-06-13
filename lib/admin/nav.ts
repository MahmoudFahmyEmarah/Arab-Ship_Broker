// Admin navigation taxonomy — the grouped sidebar IA from the design handoff
// (14_admin_rebuild), mapped onto this app's REAL admin routes. Import-free so
// both the server layout and the client sidebar consume one definition.
//
// `section` ids match the authorization ids in sections.ts (canAccess). Icon
// keys resolve to inline SVGs in components/admin/shell/icons.tsx.

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
    items: [{ id: "dashboard", label: "Dashboard", href: "/admin/dashboard", icon: "dash" }],
  },
  {
    section: "Listings",
    items: [
      { id: "review", label: "Review queue", href: "/admin/queue", icon: "queue", countKey: "review" },
      { id: "cargo", label: "Cargo listings", href: "/admin/cargo", icon: "list" },
      { id: "vesselavail", label: "Vessel availability", href: "/admin/vessel-availability", icon: "vessel" },
    ],
  },
  {
    section: "Users",
    items: [
      { id: "users", label: "All users", href: "/admin/users", icon: "users" },
      { id: "orgmembers", label: "Companies", href: "/admin/org-members", icon: "building" },
    ],
  },
  {
    section: "Platform Data",
    items: [
      { id: "vessels", label: "Vessel intel", href: "/admin/vessels", icon: "shield" },
      { id: "commodities", label: "Commodities", href: "/admin/commodities", icon: "commod" },
      { id: "ports", label: "Ports", href: "/admin/ports", icon: "port" },
      { id: "bunker", label: "Bunker ticker", href: "/admin/bunker", icon: "bunker" },
      { id: "safety", label: "Intelligence rules", href: "/admin/safety-questions", icon: "rules" },
    ],
  },
  {
    section: "Platform",
    items: [
      { id: "stats", label: "Analytics", href: "/admin/stats", icon: "chart" },
      { id: "messages", label: "Messages", href: "/admin/messages", icon: "announ" },
      { id: "eta", label: "ETA / tax console", href: "/admin/eta", icon: "building", superOnly: true },
      { id: "admins", label: "Admin accounts", href: "/admin/admins", icon: "shieldlock", superOnly: true },
    ],
  },
];
