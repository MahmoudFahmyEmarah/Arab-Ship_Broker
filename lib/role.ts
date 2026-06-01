// Role normalization.
//
// Production stores `users.role` with different labels than this app's code
// expects (e.g. "Broker" vs "broker", "Cargo Owner" vs "cargo_owner"). This
// maps any reasonable prod label to the app's canonical role by keyword, so
// the access logic is resilient to casing/spacing/underscore differences.

export type AppRole = "admin" | "cargo_owner" | "vessel_owner" | "broker";

export function normalizeRole(raw: string | null | undefined): AppRole | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();

  if (s.includes("admin")) return "admin";
  if (s.includes("broker")) return "broker";

  const cargo = s.includes("cargo");
  const vessel = s.includes("vessel");
  if (cargo && vessel) return "broker"; // dual persona
  if (cargo) return "cargo_owner";
  if (vessel) return "vessel_owner";

  // Fallback: exact canonical form with separators normalized.
  const u = s.replace(/[\s-]+/g, "_");
  if (u === "admin" || u === "cargo_owner" || u === "vessel_owner" || u === "broker") {
    return u as AppRole;
  }
  return null;
}
