/**
 * Identity carried by voyage-leg facts in the browser. Route results are
 * date-sensitive; broker-entered distances are reusable only for the exact
 * endpoint pair for which they were entered.
 */
export interface LegEndpoints {
  from: string;
  to: string;
}

export interface LegLookupKey extends LegEndpoints {
  asOf: string;
}

export interface BoundLegResult<T> {
  key: LegLookupKey;
  result: T;
}

export function legEndpoints(from: string | null, to: string | null): LegEndpoints | null {
  if (!from || !to || from === to) return null;
  return { from, to };
}

export function legLookupKey(from: string | null, to: string | null, asOf: string): LegLookupKey | null {
  const endpoints = legEndpoints(from, to);
  return endpoints && asOf ? { ...endpoints, asOf } : null;
}

export function matchesLegEndpoints(key: LegEndpoints | null, from: string | null, to: string | null): boolean {
  return !!key && key.from === from && key.to === to;
}

export function matchesLegLookup(key: LegLookupKey | null, from: string | null, to: string | null, asOf: string): boolean {
  return !!key && key.from === from && key.to === to && key.asOf === asOf;
}

export function bindLegResult<T>(key: LegLookupKey, result: T): BoundLegResult<T> {
  return { key, result };
}

export function currentLegResult<T>(bound: BoundLegResult<T> | null, from: string | null, to: string | null, asOf: string): T | null {
  return bound && matchesLegLookup(bound.key, from, to, asOf)
    ? bound.result
    : null;
}

export function acceptedLegResult<T>(
  bound: BoundLegResult<T> | null,
  loading: boolean,
  loadingFor: LegLookupKey | null,
  from: string | null,
  to: string | null,
  asOf: string,
): T | null {
  if (loading && matchesLegLookup(loadingFor, from, to, asOf)) return null;
  return currentLegResult(bound, from, to, asOf);
}

export interface ManualLegFields {
  manualFor: LegEndpoints | null;
  manualNm: string;
  manualEcaNm: string;
  manualReason: string;
}

/**
 * Select manual fields for an endpoint pair. A different pair starts empty;
 * stale values are never silently adopted by the new route.
 */
export function rebindManualLeg<T extends ManualLegFields>(state: T, from: string | null, to: string | null): T | null {
  const endpoints = legEndpoints(from, to);
  if (!endpoints) return null;
  if (matchesLegEndpoints(state.manualFor, from, to)) return state;
  return { ...state, manualFor: endpoints, manualNm: "", manualEcaNm: "", manualReason: "" };
}

export interface VoyagePdaLinkInput {
  availabilityId: string | null;
  cargoOwnedListingId: string | null;
  cargoRef: string | null;
  loadLocode: string | null;
  dischargeLocode: string | null;
  quantityMt: number | null;
}

/** Build the governed Voyage -> Ports DA hand-off. */
export function voyagePdaHref(input: VoyagePdaLinkInput): string {
  const locode = /^[A-Z]{2}[A-Z0-9]{3}$/;
  const availabilityId = input.availabilityId?.trim() ?? "";
  const cargoRef = input.cargoRef?.trim() ?? "";
  if (
    !availabilityId || availabilityId.length > 100 ||
    !cargoRef || cargoRef.length > 100 ||
    !input.loadLocode || !locode.test(input.loadLocode) ||
    !input.dischargeLocode || !locode.test(input.dischargeLocode) ||
    input.quantityMt == null ||
    !Number.isFinite(input.quantityMt) ||
    input.quantityMt <= 0
  ) {
    return "/dashboard/ports-da";
  }
  const query = new URLSearchParams({ from: "voyage" });
  query.set("vesselId", availabilityId);
  query.set("ref", cargoRef);
  query.set("load", input.loadLocode);
  query.set("disch", input.dischargeLocode);
  query.set("mt", String(input.quantityMt));
  // A market CargoView.id is an actor-bound handle. Only an owner-visible raw
  // listing id may cross into the PDA module's cargoId contract.
  const ownedCargoId = input.cargoOwnedListingId?.trim() ?? "";
  if (ownedCargoId && ownedCargoId.length <= 100) query.set("cargoId", ownedCargoId);
  return `/dashboard/ports-da?${query.toString()}`;
}
