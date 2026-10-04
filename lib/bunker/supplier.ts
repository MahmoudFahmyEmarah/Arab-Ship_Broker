// Shapes of the supplier portal (supplier_list_my_quotes / supplier_upsert_quotes).
// The caller's own supplier and quote ids appear here: they belong to them.
import type { FuelProductKey } from "./types";

export interface SupplierPortalProduct {
  key: FuelProductKey;
  label: string;
  family: "residual" | "distillate";
  sulphurClass: "HS" | "VLS" | "ULS";
  isoGrade: string;
  coreSlot: boolean;
  ecaSlot: boolean;
}

export interface SupplierPortalQuote {
  id: string;
  portLocode: string;
  productKey: FuelProductKey;
  priceUsdMt: number;
  deliveryMode: "barge" | "truck" | "pipe" | "ex_wharf";
  minQtyMt: number | null;
  bargeFeeUsd: number;
  mandatoryChargesUsd: number;
  validFrom: string;
  validUntil: string;
  status: "submitted" | "approved";
  source: "supplier" | "admin_override" | "admin_input";
  submittedAt: string;
  decisionReason: string | null;
}

export interface SupplierPortalHistory {
  at: string;
  action: "submit" | "approve" | "reject" | "withdraw" | "override" | "import";
  portLocode: string;
  productKey: string;
  oldPrice: number | null;
  newPrice: number | null;
  validUntil: string | null;
  byMe: boolean;
  reason: string | null;
}

export interface SupplierPortalSupplier {
  id: string;
  name: string;
  url: string | null;
  verified: boolean;
  status: "enabled" | "disabled";
  role: "editor" | "viewer";
  ports: { locode: string; name: string; isPrimary: boolean; eca: boolean }[];
  quotes: SupplierPortalQuote[];
  history: SupplierPortalHistory[];
}

export interface SupplierPortalState {
  products: SupplierPortalProduct[];
  suppliers: SupplierPortalSupplier[];
}

export interface SupplierQuoteInput {
  portLocode: string;
  productKey: FuelProductKey;
  priceUsdMt: number;
  validUntil: string;
  deliveryMode?: SupplierPortalQuote["deliveryMode"];
  minQtyMt?: number | null;
  bargeFeeUsd?: number;
  mandatoryChargesUsd?: number;
  /** Required: the database refuses a supplier submission without it (107000). */
  clientRef: string;
}

/** Products a port shows: the three core slots, ULSFO at ECA ports, plus anything already quoted there. */
export function slotsForPort(
  products: SupplierPortalProduct[],
  port: { locode: string; eca: boolean },
  quotes: SupplierPortalQuote[],
): SupplierPortalProduct[] {
  const quoted = new Set(quotes.filter((q) => q.portLocode === port.locode).map((q) => q.productKey));
  return products.filter((p) => p.coreSlot || (p.ecaSlot && port.eca) || quoted.has(p.key));
}

/** One submission attempt: the exact command sent, reused byte-for-byte on a retry. */
export interface SubmissionAttempt {
  fingerprint: string;
  payload: SupplierQuoteInput[];
}

/**
 * Reuse the pending attempt while the inputs are unchanged (a retry after a
 * lost response must replay the identical command, validity included); any
 * change of inputs is a new command with new keys.
 */
export function attemptFor(
  pending: SubmissionAttempt | null,
  fingerprint: string,
  build: () => SupplierQuoteInput[],
): SubmissionAttempt {
  if (pending && pending.fingerprint === fingerprint) return pending;
  return { fingerprint, payload: build() };
}
