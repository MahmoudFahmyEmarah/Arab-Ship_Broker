// Admin authorization registry — the app-shape port of the design's
// admin-roles.js (ctx = { role: "super" | "sub", perms };
// admCanAccess(sectionId, ctx) → "edit" | "view" | "none").
// Plain module (no server imports) so both the server gate and the client
// sidebar consume the SAME registry — never two definitions.

export type AdminTier = "super" | "sub";
export type Access = "edit" | "view" | "none";
export type AdminPerms = Record<string, "edit" | "view">;

// Section ids → routes. Owner-only sections are NEVER exposed to sub-admins
// (ETA holds tax credentials; Admins manages other admins).
export const ADMIN_SECTIONS: { id: string; href: string }[] = [
  { id: "dashboard", href: "/admin/dashboard" },
  { id: "stats", href: "/admin/stats" },
  { id: "review", href: "/admin/queue" },
  { id: "cargo", href: "/admin/cargo" },
  { id: "vesselavail", href: "/admin/vessel-availability" },
  { id: "vessels", href: "/admin/vessels" },
  { id: "ports", href: "/admin/ports" },
  { id: "commodities", href: "/admin/commodities" },
  { id: "safety", href: "/admin/safety-questions" },
  { id: "users", href: "/admin/users" },
  { id: "orgmembers", href: "/admin/org-members" },
  { id: "messages", href: "/admin/messages" },
  { id: "bunker", href: "/admin/bunker" },
  { id: "eta", href: "/admin/eta" },
  { id: "admins", href: "/admin/admins" },
];

export const OWNER_ONLY: Record<string, boolean> = { eta: true, admins: true };

// Sub-admin presets — the design's profiles (Sales / Broker / Accountant /
// IT) mapped onto this app's real sections. Dashboard is implicit view for
// every admin.
export const ADMIN_PRESETS: Record<
  string,
  { label: string; blurb: string; perms: AdminPerms }
> = {
  sales: {
    label: "Admin · Sales",
    blurb: "Member outreach, messages and account oversight.",
    perms: { messages: "edit", users: "view", cargo: "view", vesselavail: "view", orgmembers: "view" },
  },
  broker: {
    label: "Admin · Broker",
    blurb: "Listing moderation and brokerage operations.",
    perms: {
      review: "edit", cargo: "edit", vesselavail: "edit",
      vessels: "view", users: "view", commodities: "view", ports: "view",
      bunker: "view", safety: "view", orgmembers: "view",
    },
  },
  accountant: {
    label: "Admin · Accountant",
    blurb: "Billing oversight. No tax-credential (ETA) access.",
    perms: { users: "view", messages: "view", bunker: "view" },
  },
  it: {
    label: "Admin · IT",
    blurb: "Platform data, integrations and technical configuration.",
    perms: {
      ports: "edit", commodities: "edit", safety: "edit",
      bunker: "edit", vessels: "edit", messages: "view",
    },
  },
};

export const ADMIN_PRESET_ORDER = ["sales", "broker", "accountant", "it"];

// The authorization gate (same semantics as the design's admCanAccess).
export function canAccess(
  sectionId: string,
  tier: AdminTier | null | undefined,
  perms: AdminPerms | null | undefined,
): Access {
  if (!tier) return "none";
  if (tier === "super") return "edit";
  if (OWNER_ONLY[sectionId]) return "none";
  // Read-only overview surfaces every admin may see (aggregate counts, no PII).
  if (sectionId === "dashboard" || sectionId === "stats") return "view";
  return perms?.[sectionId] ?? "none";
}
