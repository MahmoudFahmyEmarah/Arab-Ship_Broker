// ETA (Egyptian Tax Authority) e-invoice document builder — a pure function
// from our invoice rows to the JSON shape the e-invoicing API accepts and the
// portal form mirrors. Used today to show/copy the document while invoices are
// keyed into the portal by hand; tomorrow it is what the signing service signs
// and the API submits. Reference: ETA e-invoicing SDK, document structure v1.0.
import type { BillingCustomer, EtaAddress, Invoice, InvoiceLine } from "./types";
import { round5 } from "./money";

export type EtaIssuer = {
  legalName: string;
  taxId: string;
  activityCode: string;
  branchId: string;
  address: EtaAddress;
};

export type EtaDocument = {
  issuer: { type: "B"; id: string; name: string; address: Record<string, string> };
  receiver: { type: "B" | "P" | "F"; id: string; name: string; address: Record<string, string> };
  documentType: "I" | "C" | "D";
  documentTypeVersion: "1.0";
  dateTimeIssued: string;
  taxpayerActivityCode: string;
  internalID: string;
  purchaseOrderReference?: string;
  references?: string[];
  invoiceLines: EtaLine[];
  totalSalesAmount: number;
  totalDiscountAmount: number;
  netAmount: number;
  taxTotals: { taxType: string; amount: number }[];
  totalAmount: number;
  extraDiscountAmount: number;
  totalItemsDiscountAmount: number;
  signatures?: { signatureType: "I"; value: string }[];
};

export type EtaLine = {
  description: string;
  itemType: string;
  itemCode: string;
  unitType: string;
  quantity: number;
  internalCode?: string;
  salesTotal: number;
  total: number;
  valueDifference: number;
  totalTaxableFees: number;
  netTotal: number;
  itemsDiscount: number;
  unitValue: { currencySold: string; amountEGP: number; amountSold?: number; currencyExchangeRate?: number };
  discount: { rate: number; amount: number };
  taxableItems: { taxType: string; amount: number; subType: string; rate: number }[];
};

function addr(a: EtaAddress | undefined, fallbackCountry: string, branchId?: string): Record<string, string> {
  const out: Record<string, string> = {
    country: (a?.country ?? fallbackCountry).toUpperCase(),
    governate: a?.governate ?? "",
    regionCity: a?.regionCity ?? "",
    street: a?.street ?? "",
    buildingNumber: a?.buildingNumber ?? "",
  };
  if (branchId != null) out.branchID = branchId;
  if (a?.postalCode) out.postalCode = a.postalCode;
  if (a?.floor) out.floor = a.floor;
  if (a?.room) out.room = a.room;
  if (a?.landmark) out.landmark = a.landmark;
  if (a?.additionalInformation) out.additionalInformation = a.additionalInformation;
  return out;
}

/** Fields the portal / API require before a document can be accepted. */
export function etaReadiness(issuer: EtaIssuer | null, customer: Pick<BillingCustomer, "receiver_type" | "tax_id" | "legal_name" | "country" | "address">, lines: Pick<InvoiceLine, "item_code">[]) {
  const missing: string[] = [];
  if (!issuer?.taxId) missing.push("issuer tax registration number");
  if (!issuer?.activityCode) missing.push("issuer activity code");
  if (!issuer?.legalName) missing.push("issuer legal name");
  if (!issuer?.address?.governate || !issuer?.address?.regionCity || !issuer?.address?.street || !issuer?.address?.buildingNumber) missing.push("issuer address (governate, city, street, building)");
  if (customer.receiver_type !== "F" && !customer.tax_id) missing.push("customer tax id (required for Egyptian businesses and persons)");
  if (!customer.legal_name) missing.push("customer legal name");
  if (!customer.address?.governate && customer.country?.toUpperCase() === "EG") missing.push("customer governate");
  if (lines.some((l) => !l.item_code)) missing.push("EGS/GS1 item code on every line");
  return { ready: missing.length === 0, missing };
}

export function toEtaDocument(
  invoice: Invoice,
  lines: InvoiceLine[],
  customer: BillingCustomer,
  issuer: EtaIssuer,
  opts: { relatedUuid?: string | null } = {},
): EtaDocument {
  const isEgp = invoice.currency === "EGP";
  const fx = invoice.fx_rate ?? 1;
  const toEgp = (n: number) => round5(isEgp ? n : n * fx);

  const etaLines: EtaLine[] = lines.map((l) => {
    const salesTotal = toEgp(l.quantity * l.unit_price);
    const discountAmt = toEgp(l.discount);
    const net = toEgp(l.net_total);
    const tax = toEgp(l.tax_amount);
    return {
      description: l.description,
      itemType: l.item_type,
      itemCode: l.item_code ?? "",
      unitType: l.unit_type,
      quantity: l.quantity,
      internalCode: l.item_code ?? undefined,
      salesTotal,
      total: toEgp(l.total),
      valueDifference: 0,
      totalTaxableFees: 0,
      netTotal: net,
      itemsDiscount: 0,
      unitValue: isEgp
        ? { currencySold: "EGP", amountEGP: round5(l.unit_price) }
        : { currencySold: invoice.currency, amountSold: round5(l.unit_price), currencyExchangeRate: round5(fx), amountEGP: round5(l.unit_price * fx) },
      discount: { rate: 0, amount: discountAmt },
      taxableItems: [{ taxType: l.tax_type, amount: tax, subType: l.tax_subtype, rate: Number(l.tax_rate) }],
    };
  });

  const totalSales = round5(etaLines.reduce((s, l) => s + l.salesTotal, 0));
  const totalDiscount = round5(etaLines.reduce((s, l) => s + l.discount.amount, 0));
  const net = round5(etaLines.reduce((s, l) => s + l.netTotal, 0));
  const taxByType = new Map<string, number>();
  for (const l of etaLines) for (const t of l.taxableItems) taxByType.set(t.taxType, round5((taxByType.get(t.taxType) ?? 0) + t.amount));
  const total = round5(etaLines.reduce((s, l) => s + l.total, 0));

  const doc: EtaDocument = {
    issuer: { type: "B", id: issuer.taxId, name: issuer.legalName, address: addr(issuer.address, "EG", issuer.branchId) },
    receiver: {
      type: customer.receiver_type,
      id: customer.tax_id ?? "",
      name: customer.legal_name,
      address: addr(customer.address, customer.country || "EG"),
    },
    documentType: invoice.document_type,
    documentTypeVersion: "1.0",
    dateTimeIssued: (invoice.issued_at ? new Date(invoice.issued_at) : new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    taxpayerActivityCode: issuer.activityCode,
    internalID: invoice.number ?? invoice.id,
    invoiceLines: etaLines,
    totalSalesAmount: totalSales,
    totalDiscountAmount: totalDiscount,
    netAmount: net,
    taxTotals: [...taxByType.entries()].map(([taxType, amount]) => ({ taxType, amount })),
    totalAmount: total,
    extraDiscountAmount: 0,
    totalItemsDiscountAmount: 0,
  };
  if (invoice.document_type !== "I" && opts.relatedUuid) doc.references = [opts.relatedUuid];
  return doc;
}
