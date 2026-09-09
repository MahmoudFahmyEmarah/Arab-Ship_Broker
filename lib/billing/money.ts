// Money and line arithmetic for the billing layer. Pure functions, two-decimal
// half-up rounding everywhere the customer sees a figure, five decimals where
// the ETA payload wants them. Never use floating math on the client for totals;
// the database recomputes them from lines on every change (fn_invoice_recalc).
import type { BillingCurrency, BillingPeriod, VatTreatment } from "./types";
import { ETA_VAT_SUBTYPE, PERIOD_MONTHS } from "./types";

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round5 = (n: number) => Math.round((n + Number.EPSILON) * 100000) / 100000;

export function fmtMoney(n: number | null | undefined, currency: BillingCurrency | string = "USD", locale = "en-GB"): string {
  if (n == null || Number.isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** One invoice line computed from quantity, unit price, discount and VAT treatment. */
export function computeLine(input: { quantity: number; unitPrice: number; discount?: number; treatment: VatTreatment; vatRate?: number }) {
  const gross = round2(input.quantity * input.unitPrice);
  const discount = round2(input.discount ?? 0);
  const net = round2(gross - discount);
  const meta = ETA_VAT_SUBTYPE[input.treatment];
  const rate = input.treatment === "standard" || input.treatment === "pending_review" ? (input.vatRate ?? meta.rate) : 0;
  const tax = round2(net * rate / 100);
  return { gross, discount, net, taxSubtype: meta.subtype, taxRate: rate, tax, total: round2(net + tax) };
}

export function sumLines(lines: { net: number; tax: number; total: number; discount: number; gross: number }[]) {
  const subtotal = round2(lines.reduce((s, l) => s + l.gross, 0));
  const discount = round2(lines.reduce((s, l) => s + l.discount, 0));
  const tax = round2(lines.reduce((s, l) => s + l.tax, 0));
  const total = round2(lines.reduce((s, l) => s + l.total, 0));
  return { subtotal, discount, tax, total };
}

/** Add a billing period to a date (UTC), clamping month-end (31 Jan + 1 month = 28/29 Feb). */
export function addPeriod(start: Date, period: BillingPeriod): Date {
  const d = new Date(start.getTime());
  const months = PERIOD_MONTHS[period];
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export function egpEquivalent(amount: number, currency: BillingCurrency, fxRate: number | null): number | null {
  if (currency === "EGP") return round2(amount);
  if (fxRate == null) return null;
  return round2(amount * fxRate);
}
