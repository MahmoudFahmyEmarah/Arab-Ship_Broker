// Invitation-only tools stay usable in Beta (owner ruling, 6 Oct 2026): an
// invited supplier publishes prices and invited parties negotiate. Each page
// enforces its own access (supplier membership, Fixture Room tier/party).
export const BETA_OPEN_PATHS = ["/dashboard/bunker-supplier", "/dashboard/fixture-room"] as const;

export const isBetaOpenPath = (pathname: string) =>
  BETA_OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
