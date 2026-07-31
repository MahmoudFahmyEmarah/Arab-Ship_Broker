// Broker Ledger — Post Cargo state model (mirrors the Concept 4 prototype's
// localStorage shape, key asb.led.cargo.v1).

export interface LedgerPortSel {
  locode: string;
  name: string;
  country?: string | null;
  zone?: string | null;
  zoneName?: string | null;
}

export interface CargoCommodity {
  name: string;
  /** Coarse pick the platform classifies from: dry-bulk | break-bulk. */
  form?: "dry-bulk" | "break-bulk" | null;
  packaging?: string | null;
  /** Trade/market name when it differs from the official name. */
  marketName?: string | null;
  /** Resolver readout snapshot (source table + group) for the summary UI. */
  source?: string | null;
  group?: string | null;
  regime?: string | null;
  multi?: boolean;
}

/** One additional parcel (parcel 2..N). Parcel 1 lives in the legacy
 *  commodity/quantity slots so single-parcel drafts and flows are unchanged. */
export interface ExtraParcel {
  commodity?: CargoCommodity | null;
  qtyMt?: string | number | null;
  molooPct?: string | null;
  optionHolder?: string | null;
  volume?: string | number | null;
  unit?: "CbM" | "CbFT";
}

export interface CargoState {
  commodity?: CargoCommodity | null;
  /** Parcels 2..N of a multi-parcel posting (parcel 1 = commodity+quantity). */
  extraParcels?: ExtraParcel[];
  quantity?: {
    qtyMt?: string | number | null;
    molooPct?: string | null;
    optionHolder?: string | null;
    volume?: string | number | null;
    unit?: "CbM" | "CbFT";
  } | null;
  ports?: {
    pol?: LedgerPortSel | null;
    pod?: LedgerPortSel | null;
    loadRate?: string | null;
    dischRate?: string | null;
    rateMechanism?: string | null;
    dayExceptions?: string | null;
    turnTime?: string | null;
    reversible?: string | null;
  } | null;
  terms?: {
    laycanFrom?: string | null;
    laycanTo?: string | null;
    norClause?: string | null;
    freight?: string | null;
    freightBasis?: string | null;
    despatch?: string | null;
    commissionPct?: string | null;
    spot?: boolean;
    iac?: boolean;
  } | null;
}

export const initialCargoState = (): CargoState => ({});

export const CARGO_STORAGE_KEY = "asb.led.cargo.v1";
