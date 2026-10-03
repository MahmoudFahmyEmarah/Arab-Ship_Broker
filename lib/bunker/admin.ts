// Shapes returned by admin_bunker_dashboard (admin console only; these carry
// supplier contacts and ids and must never reach a member surface).
import type { FuelProductKey, QuoteFreshness } from "./types";

export type QuoteStatus = "submitted" | "approved" | "rejected" | "withdrawn";
export type QuoteSource = "supplier" | "admin_override" | "admin_input";

export interface AdminBunkerSupplier {
  id: string;
  name: string;
  url: string | null;
  country: string | null;
  verified: boolean;
  status: "enabled" | "disabled";
  trustScore: number;
  isPlatform: boolean;
  notes: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  createdAt: string;
  updatedAt: string;
  ports: { locode: string; name: string; isPrimary: boolean }[];
  members: { userId: string; name: string | null; email: string; role: "editor" | "viewer"; since: string }[];
  latestQuoteAt: string | null;
}

export interface AdminBunkerQuote {
  id: string;
  supplierId: string;
  supplierName: string;
  portLocode: string;
  portName: string;
  productKey: FuelProductKey;
  priceUsdMt: number;
  deliveryMode: string;
  minQtyMt: number | null;
  bargeFeeUsd: number;
  mandatoryChargesUsd: number;
  validFrom: string;
  validUntil: string;
  status: Extract<QuoteStatus, "submitted" | "approved">;
  source: QuoteSource;
  reason: string | null;
  submittedAt: string;
  freshness: QuoteFreshness;
  validNow: boolean;
}

export interface AdminBunkerEvent {
  at: string;
  supplierName: string;
  action: "submit" | "approve" | "reject" | "withdraw" | "override" | "import";
  portLocode: string;
  productKey: string;
  oldPrice: number | null;
  newPrice: number | null;
  validUntil: string | null;
  actorName: string | null;
  reason: string | null;
}

export type AdminBunkerAlert =
  | { kind: "no_live_quote" | "stale" | "expired"; supplierId: string; supplierName: string; latestQuoteAt: string | null }
  | { kind: "pending_approval"; count: number };

export interface AdminBunkerDashboard {
  asOf: string;
  suppliers: AdminBunkerSupplier[];
  quotes: AdminBunkerQuote[];
  events: AdminBunkerEvent[];
  alerts: AdminBunkerAlert[];
}
