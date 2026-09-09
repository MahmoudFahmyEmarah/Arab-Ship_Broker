// Billing & Gateway Layer — shared types (client-safe, no server imports).
// Mirrors supabase/migrations/20260906090000_billing_layer.sql.

export type BillingCurrency = "USD" | "EGP";
export type BillingPeriod = "monthly" | "annual";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "expired";
export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "void";
export type EinvoiceStatus = "not_submitted" | "submitted" | "valid" | "invalid" | "rejected" | "cancelled";
export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";
export type PaymentMethod = "bank_transfer" | "paymob" | "manual" | "credit_note";
export type VatTreatment = "standard" | "zero_rated_export" | "out_of_scope" | "pending_review";
export type EtaReceiverType = "B" | "P" | "F";
export type EtaDocumentType = "I" | "C" | "D";
export type PlanCode = "T2" | "T3" | "T4";
export type TierCode = "T1" | "T2" | "T3" | "T4";

export type EtaAddress = {
  country?: string;        // ISO-2
  governate?: string;
  regionCity?: string;
  street?: string;
  buildingNumber?: string;
  postalCode?: string;
  floor?: string;
  room?: string;
  landmark?: string;
  additionalInformation?: string;
};

export type BankDetails = {
  bank?: string;
  accountName?: string;
  iban?: string;
  accountNumber?: string;
  swift?: string;
  currency?: string;
  notes?: string;
};

export type BillingSettings = {
  issuer_legal_name: string | null;
  issuer_legal_name_ar: string | null;
  issuer_tax_id: string | null;
  issuer_activity_code: string | null;
  issuer_branch_id: string;
  issuer_address: EtaAddress;
  bank_details: BankDetails;
  invoice_prefix: string;
  vat_rate: number;
  grace_days: number;
  renew_before_days: number;
  reminder_days: number[];
  fx_source: string;
  paymob_enabled: boolean;
  paymob_merchant_id: string | null;
  paymob_integration_id: string | null;
  paymob_iframe_id: string | null;
  updated_at: string;
};

export type Plan = {
  code: PlanCode;
  tier: TierCode;
  name: string;
  name_ar: string | null;
  description: string | null;
  egs_code: string | null;
  gpc_code: string | null;
  is_active: boolean;
  sort_order: number;
};

export type Price = {
  id: string;
  plan_code: PlanCode;
  period: BillingPeriod;
  currency: BillingCurrency;
  unit_amount: number;
  active_from: string;
  active_to: string | null;
};

export type BillingCustomer = {
  id: string;
  org_id: string | null;
  user_id: string | null;
  legal_name: string;
  legal_name_ar: string | null;
  receiver_type: EtaReceiverType;
  tax_id: string | null;
  country: string;
  address: EtaAddress;
  currency: BillingCurrency;
  vat_treatment: VatTreatment;
  billing_email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Subscription = {
  id: string;
  customer_id: string;
  plan_code: PlanCode;
  period: BillingPeriod;
  seats: number;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  gateway: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceLine = {
  id: string;
  invoice_id: string;
  position: number;
  description: string;
  description_ar: string | null;
  item_type: string;
  item_code: string | null;
  unit_type: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tax_type: string;
  tax_subtype: string;
  tax_rate: number;
  net_total: number;
  tax_amount: number;
  total: number;
};

export type Invoice = {
  id: string;
  number: string | null;
  document_type: EtaDocumentType;
  related_invoice_id: string | null;
  customer_id: string;
  subscription_id: string | null;
  status: InvoiceStatus;
  einvoice_status: EinvoiceStatus;
  currency: BillingCurrency;
  fx_rate: number | null;
  fx_source: string | null;
  fx_date: string | null;
  vat_treatment: VatTreatment;
  vat_rate: number;
  period_start: string | null;
  period_end: string | null;
  issuer_snapshot: Record<string, unknown> | null;
  customer_snapshot: Record<string, unknown> | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  amount_paid: number;
  egp_total: number | null;
  due_at: string | null;
  issued_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  notes: string | null;
  eta_uuid: string | null;
  eta_long_id: string | null;
  eta_submission_id: string | null;
  eta_submitted_at: string | null;
  pdf_path: string | null;
  created_at: string;
  updated_at: string;
};

export type Payment = {
  id: string;
  invoice_id: string;
  customer_id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  currency: BillingCurrency;
  gateway: string | null;
  gateway_payment_id: string | null;
  reference: string | null;
  received_at: string;
  note: string | null;
  created_at: string;
};

export type FxRate = { day: string; base: string; quote: string; rate: number; source: string; fetched_at: string };

/** Tax subtype codes the ETA expects on VAT (T1) lines. */
export const ETA_VAT_SUBTYPE: Record<VatTreatment, { subtype: string; rate: number }> = {
  standard: { subtype: "V009", rate: 14 },          // 14% standard rate
  zero_rated_export: { subtype: "V001", rate: 0 },  // export of goods/services
  out_of_scope: { subtype: "V010", rate: 0 },       // non-taxable
  pending_review: { subtype: "V009", rate: 14 },    // treated as standard until the accountant decides
};

export const PERIOD_MONTHS: Record<BillingPeriod, number> = { monthly: 1, annual: 12 };

export const PLAN_FEATURES: Record<TierCode, string[]> = {
  T1: ["Post unlimited listings", "Zone-level match counts", "7-day archive"],
  T2: ["Everything in Free", "30-day archive", "Smart Parser", "Daily digest"],
  T3: ["Vessel names + IMO", "Full match intelligence", "Voyage calculators", "6-month archive"],
  T4: ["Everything in Subscriber", "Partner dashboard", "API access", "Account manager"],
};
