// View models the Claude-design portal components render. Kept separate from
// the DB row types (lib/schemas/*) so the design layer never depends on
// Supabase shapes directly — adapters (./adapters.ts) translate between them.

export type CargoScope = "in" | "partial" | "out" | "fixed";

export interface CargoView {
  id: string;
  refId: string;
  cargo: string;
  commodity: string;
  type: string; // "Dry Bulk" | "Break Bulk" | …
  scope: CargoScope;
  route: {
    polName: string;
    polCode: string;
    polZone: string;
    podName: string;
    podCode: string;
    podZone: string;
  };
  // Multi-port range (index 0 = the primary in `route`). Empty/absent = single-port.
  loadPorts?: { locode: string; name: string; zone: string; status: string }[];
  dischPorts?: { locode: string; name: string; zone: string; status: string }[];
  qty: { min: number | null; max: number | null };
  qtyMt: string;
  vol: string;
  volUnit?: string;
  sf: number | null;
  imsbcGroup: string;
  laycanFrom: string;
  laycanTo: string;
  laycanDays: number | null;
  loadTerms: string | null;
  loadRate: number | null;
  dischRate: number | null;
  freightIdea: number | null;
  commission: number | null;
  demurrage: number | null;
  matches: number;
  spot?: boolean;
  wog?: boolean;
  forCirculation?: boolean;
  partnerSlug?: string | null;
  // Detail-panel extras (optional; "—" when the source row has no value)
  nature?: string | null;
  requiresGeared?: boolean | null;
  maxAge?: number | null;
  maxLoa?: number | null;
  maxDraft?: number | null;
  isGrain?: boolean;
  isDg?: boolean;
}

export type VesselStatusView = "open" | "review" | "fixed";

// Ownership card data — fetched on panel open from the firewalled
// v_vessel_detail. `entitled` is false for non-owner market viewers, in which
// case every field is null and the card shows the brokered/masked state.
export interface VesselOwnershipView {
  entitled: boolean;
  ownerName: string | null;
  ownerImo: string | null;
  ownerCountry: string | null;
  ownerFleet: number | null;
  ownerDesk: string | null;
  managerName: string | null;
  managerFleet: number | null;
  managerDesk: string | null;
}

export interface VesselView {
  id: string;
  name: string;
  imo: string;
  type: string;
  flag: string;
  dwt: string;
  grainCap: string;
  built: number | null;
  age: number | null;
  geared: boolean | null;
  grainCertified: boolean | null;
  dgCertified: boolean | null;
  openPort: string;
  openPortLocode: string | null;
  openPortZone: string;
  openDate: string;
  openDateUrgency: "red" | "amber" | "green";
  openDateDays: number | null;
  status: VesselStatusView;
  matches: number;
  fuel: {
    vlsfoSea: number | string;
    vlsfoPort: number | string;
    lsmgoSea: number | string;
    lsmgoPort: number | string;
  };
  // Detail-panel extras (optional; "—" when the source row has no value)
  vesselId?: string; // the vessels.id — keys the firewalled v_vessel_detail lookup
  dwtBale?: string;
  loa?: string;
  beam?: string;
  draft?: string;
  preferredZones?: string[] | null;
  serviceSpeed?: number | null;
  fuelType?: string | null;
  openDateRangeDays?: number | null;
  lastCargo?: string | null;
  acceptsPartCargo?: boolean | null;
}
