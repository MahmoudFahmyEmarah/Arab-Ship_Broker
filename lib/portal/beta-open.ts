// Invitation-only tools stay usable in Beta (owner ruling, 6 Oct 2026): an
// invited supplier publishes prices and invited parties negotiate. Each page
// enforces its own access (supplier membership, Fixture Room tier/party).
// The PDA agency inbox joins them (owner ruling 19 Oct 2026): staff of an ASB-invited agency answer quote requests in
// Beta; the database decides who is staff (get_my_pda_agency), and anyone else sees only "not a listed agency".
export const BETA_OPEN_PATHS = ["/dashboard/bunker-supplier", "/dashboard/fixture-room", "/dashboard/agency"] as const;

export const isBetaOpenPath = (pathname: string) =>
  BETA_OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
