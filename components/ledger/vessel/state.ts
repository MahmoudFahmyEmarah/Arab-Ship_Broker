// Broker Ledger — Post Vessel (position) state model (mirrors the Concept 4
// prototype's localStorage shape, key asb.led.vessel.v1).

import type { LedgerPortSel } from "../cargo/state";

export interface LedgerVessel {
  /** DB vessels.id when picked from the registry. */
  id?: string | null;
  imo?: string | null;
  name?: string | null;
  type?: string | null;
  dwt?: string | number | null;
  built?: string | null;
  flag?: string | null;
  grt?: string | number | null;
  loa?: string | number | null;
  beam?: string | number | null;
  draft?: string | number | null;
  classSociety?: string | null;
  verified?: boolean;
  source?: string | null;
  /** Ownership & management chain (Q88 five tiers). */
  regOwner?: string | null;
  parentGroup?: string | null;
  ismManager?: string | null;
  manager?: string | null;
  disponentOwner?: string | null;
  /** Arrangement/performance on file (prefills the later steps). */
  numHolds?: number | string | null;
  numHatches?: number | string | null;
  boxShaped?: string | null;
  hatchType?: string | null;
  strengthenedHeavy?: string | null;
  holdsMayBeEmpty?: string | null;
  logFitted?: string | null;
  isGeared?: string | null;
  craneCount?: number | string | null;
  craneSwl?: number | string | null;
  numGrabs?: number | string | null;
  grabCapacity?: number | string | null;
  serviceSpeed?: number | string | null;
  meConsSea?: number | string | null;
  meConsPort?: number | string | null;
  auxConsPort?: number | string | null;
  fuelType?: string | null;
  brob?: number | string | null;
  scrubber?: boolean;
}

export interface VesselState {
  entryMode?: "search" | "tbn" | null;
  vesselImo?: string | null;
  vessel?: LedgerVessel | null;
  tbn?: {
    type?: string | null;
    dwt?: string | null;
    built?: string | null;
    flag?: string | null;
    loa?: string | null;
    beam?: string | null;
    draft?: string | null;
    grt?: string | null;
    classSociety?: string | null;
  } | null;
  arrangement?: {
    config?: string | null;
    numHolds?: string | null;
    numHatches?: string | null;
    boxShaped?: string | null;
    hatchType?: string | null;
    strengthenedHeavy?: string | null;
    holdsMayBeEmpty?: string | null;
    logFitted?: string | null;
    _source?: "record" | "user";
  } | null;
  availability?: {
    status?: string | null;
    charterType?: string | null;
    openPort?: LedgerPortSel | null;
    openFrom?: string | null;
    zones?: string[];
    direction?: string | null;
    wog?: boolean;
  } | null;
  performance?: {
    serviceSpeed?: string | null;
    fuelType?: string | null;
    meConsSea?: string | null;
    meConsPort?: string | null;
    auxConsPort?: string | null;
    brob?: string | null;
    scrubber?: boolean;
    eco?: boolean;
    _source?: "record" | "user";
  } | null;
  gear?: {
    geared?: boolean | null;
    craneCount?: string | null;
    craneSwl?: string | null;
    grabs?: boolean;
    numGrabs?: string | null;
    grabCapacity?: string | null;
    kickPlate?: boolean;
    _source?: "record" | "user";
  } | null;
}

export const initialVesselState = (): VesselState => ({ entryMode: null, vesselImo: null, vessel: null });

export const VESSEL_STORAGE_KEY = "asb.led.vessel.v1";
