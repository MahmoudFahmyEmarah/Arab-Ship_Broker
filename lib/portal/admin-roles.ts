// Admin authorization model, ported from admin/admin-roles.js.
// ctx = { role: "super" | "sub", perms }. admCanAccess(sectionId, ctx) →
// "edit" | "view" | "none". Section ids are the bare admin ids.
//
// NOTE: the app schema currently only has users.role = "admin" (no sub-roles),
// so real admins resolve to the "super" profile via adminCtxFromUser(). When a
// sub-admin role column exists, map it there.

export type Access = "edit" | "view" | "none";
export interface AdminCtx {
  role: "super" | "sub";
  perms: Record<string, Access> | null;
}
export interface AdminProfile {
  key: string;
  name: string;
  label: string;
  short: string;
  role: "super" | "sub";
  perms: Record<string, Access> | null;
  blurb: string;
}

// Owner-only sections — never exposed to any sub-admin.
const OWNER_ONLY: Record<string, boolean> = { eta: true, admins: true, match: true };

export const ADMIN_PROFILES: Record<string, AdminProfile> = {
  super: { key: "super", name: "Hassan Al-Mansouri", label: "Superior Admin", short: "Superior", role: "super", perms: null, blurb: "Full access — every section, the ETA console and admin accounts." },
  sales: { key: "sales", name: "Mona Fahmy", label: "Admin · Sales", short: "Sales", role: "sub", perms: { partners: "edit", announ: "edit", analytics: "view", users: "view", listings: "view" }, blurb: "Market partners, announcements and growth analytics." },
  broker: { key: "broker", name: "Tarek Saleh", label: "Admin · Broker", short: "Broker", role: "sub", perms: { review: "edit", listings: "edit", users: "view", partners: "view", commod: "view", ports: "view", dist: "view", voyage: "view", rules: "view", bunker: "view" }, blurb: "Listing moderation and brokerage operations." },
  accountant: { key: "accountant", name: "Dalia Nasr", label: "Admin · Accountant", short: "Accountant", role: "sub", perms: { analytics: "edit", settings: "view", users: "view", partners: "view" }, blurb: "Revenue analytics and billing oversight. No tax-credential (ETA) access." },
  it: { key: "it", name: "Karim Adel", label: "Admin · IT", short: "IT", role: "sub", perms: { settings: "edit", bunker: "edit", commod: "edit", ports: "edit", dist: "edit", voyage: "edit", rules: "edit", analytics: "view" }, blurb: "Platform data, integrations and technical configuration." },
};

export const ADMIN_PROFILE_ORDER = ["super", "sales", "broker", "accountant", "it"];

export function admCanAccess(sectionId: string, ctx: AdminCtx | null | undefined): Access {
  if (!ctx) return "none";
  if (ctx.role === "super") return "edit";
  if (OWNER_ONLY[sectionId]) return "none";
  return (ctx.perms && ctx.perms[sectionId]) || "none";
}

// Real seam: derive the admin ctx from the signed-in admin user. Today every
// authenticated admin is "super"; wire a sub-role column here when it exists.
export function adminCtxFromUser(_user: unknown): AdminCtx {
  return { role: "super", perms: null };
}
