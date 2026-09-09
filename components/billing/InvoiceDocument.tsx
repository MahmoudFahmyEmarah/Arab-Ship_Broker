// The invoice as a document: bilingual (English / Arabic), print-ready (the
// browser's "Save as PDF" is the PDF for now), rendered from the frozen
// snapshots on the invoice so it never changes after issue. Shared by the
// admin route and the member route; both pass data they were allowed to read.
import type { BillingCustomer, Invoice, InvoiceLine, Payment } from "@/lib/billing/types";
import { fmtMoney } from "@/lib/billing/money";
import { ASB_LOGO_MASK } from "@/components/admin/shell/logo-mask";

type IssuerSnap = { legal_name?: string | null; legal_name_ar?: string | null; tax_id?: string | null; activity_code?: string | null; address?: Record<string, string>; bank_details?: Record<string, string> };

const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const TYPE = { I: ["Tax Invoice", "فاتورة ضريبية"], C: ["Credit Note", "إشعار دائن"], D: ["Debit Note", "إشعار مدين"] } as const;
const STATUS = { draft: ["Draft", "مسودة"], issued: ["Unpaid", "غير مسددة"], partially_paid: ["Partially paid", "مسددة جزئياً"], paid: ["Paid", "مسددة"], void: ["Void", "ملغاة"] } as const;

export function InvoiceDocument({ invoice, lines, customer, payments, issuer, bank, related }: {
  invoice: Invoice; lines: InvoiceLine[]; customer: BillingCustomer; payments: Payment[];
  issuer: IssuerSnap; bank: Record<string, string> | null; related?: { number: string | null; eta_uuid: string | null } | null;
}) {
  const cur = invoice.currency;
  const open = invoice.total - invoice.amount_paid;
  const addr = (a?: Record<string, string>) => [a?.buildingNumber, a?.street, a?.regionCity, a?.governate, a?.postalCode, a?.country].filter(Boolean).join(", ");
  const showEgp = cur !== "EGP" && invoice.fx_rate;
  const [typeEn, typeAr] = TYPE[invoice.document_type];
  const [stEn, stAr] = STATUS[invoice.status];
  const termDays = invoice.issued_at && invoice.due_at
    ? Math.max(0, Math.round((new Date(invoice.due_at).getTime() - new Date(invoice.issued_at).getTime()) / 86400000))
    : null;

  return (
    <div className="inv">
      <style>{`
        .inv{max-width:820px;margin:0 auto;padding:32px 36px;background:#fff;color:#1A1A1A;font:13px/1.55 Inter,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-variant-numeric:tabular-nums}
        .inv *{box-sizing:border-box}
        .inv .top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:3px solid #0D2545;padding-bottom:16px}
        .inv .brand{display:flex;gap:10px;align-items:center}
        .inv .mark{width:34px;height:34px;background:#0D2545;-webkit-mask:url(${ASB_LOGO_MASK}) center/contain no-repeat;mask:url(${ASB_LOGO_MASK}) center/contain no-repeat}
        .inv h1{margin:0;font-size:22px;color:#0D2545;letter-spacing:-.01em}
        .inv .ar{font-family:"Segoe UI","Noto Naskh Arabic","Noto Sans Arabic",Tahoma,Arial,sans-serif;direction:rtl;unicode-bidi:isolate}
        .inv .sub{color:#5F6B7D;font-size:12px}
        .inv .meta{text-align:right;font-size:12px}
        .inv .meta b{display:block;font-size:15px;color:#0D2545}
        .inv .status{display:inline-block;margin-top:6px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:6px;background:#E6F1FB;color:#24486B}
        .inv .status.paid{background:#DFF0E6;color:#2E8B57}.inv .status.void{background:#F5E1E1;color:#A83A3A}.inv .status.draft{background:#F5F7FA;color:#8B95A3}
        .inv .parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:18px 0}
        .inv .party h3{margin:0 0 4px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#8B95A3}
        .inv .party .n{font-weight:600;color:#0D2545}
        .inv table{width:100%;border-collapse:collapse;margin-top:8px}
        .inv th{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#8B95A3;text-align:left;padding:8px 8px;border-bottom:1px solid #DDE5F0;background:#F5F7FA}
        .inv td{padding:9px 8px;border-bottom:1px solid #EDF1F8;vertical-align:top}
        .inv .r{text-align:right;white-space:nowrap}
        .inv .totals{margin-left:auto;width:340px;margin-top:10px}
        .inv .totals td{padding:5px 8px;border:0}
        .inv .totals tr.grand td{border-top:2px solid #0D2545;font-weight:700;font-size:15px;color:#0D2545;padding-top:8px}
        .inv .egp{color:#5F6B7D;font-size:11.5px}
        .inv .pay{margin-top:22px;display:grid;grid-template-columns:1fr 1fr;gap:20px}
        .inv .box{border:1px solid #DDE5F0;border-radius:10px;padding:12px 14px}
        .inv .box h3{margin:0 0 6px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#8B95A3}
        .inv .kv{display:grid;grid-template-columns:110px 1fr;gap:2px 10px;font-size:12px}
        .inv .kv span:nth-child(odd){color:#5F6B7D}
        .inv .foot{margin-top:26px;padding-top:12px;border-top:1px solid #DDE5F0;font-size:11px;color:#8B95A3;line-height:1.6}
        .inv .eta{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;word-break:break-all}
        @media print{ body{background:#fff} .inv{padding:0;max-width:none} .no-print{display:none!important} @page{margin:14mm} }
      `}</style>

      <div className="top">
        <div>
          <div className="brand">
            <span className="mark" aria-hidden />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#0D2545" }}>{issuer.legal_name || "Arab ShipBroker"}</div>
              {issuer.legal_name_ar && <div className="ar sub">{issuer.legal_name_ar}</div>}
            </div>
          </div>
          <div className="sub" style={{ marginTop: 8 }}>
            {issuer.address && addr(issuer.address) ? <div>{addr(issuer.address)}</div> : null}
            {issuer.tax_id ? <div>Tax registration no. · رقم التسجيل الضريبي: <b>{issuer.tax_id}</b></div> : <div style={{ color: "#A66A0C" }}>Tax registration number not set</div>}
            <div>www.arabshipbroker.com · info@arabshipbroker.com</div>
          </div>
        </div>
        <div className="meta">
          <h1>{typeEn}</h1>
          <div className="ar" style={{ fontSize: 15, color: "#0D2545" }}>{typeAr}</div>
          <b style={{ marginTop: 6 }}>{invoice.number ?? "DRAFT"}</b>
          <div>Issued · تاريخ الإصدار: {fmtDate(invoice.issued_at)}</div>
          <div>Due · تاريخ الاستحقاق: {fmtDate(invoice.due_at)}</div>
          {invoice.period_start && <div>Period · الفترة: {fmtDate(invoice.period_start)} – {fmtDate(invoice.period_end)}</div>}
          {related?.number && <div>Refers to · مرجع: {related.number}</div>}
          <span className={`status ${invoice.status}`}>{stEn} · <span className="ar">{stAr}</span></span>
        </div>
      </div>

      <div className="parties">
        <div className="party">
          <h3>Bill to · فاتورة إلى</h3>
          <div className="n">{customer.legal_name}</div>
          {customer.legal_name_ar && <div className="ar">{customer.legal_name_ar}</div>}
          {addr(customer.address as Record<string, string>) && <div className="sub">{addr(customer.address as Record<string, string>)}{customer.country ? `, ${customer.country}` : ""}</div>}
          {customer.tax_id && <div className="sub">Tax id · الرقم الضريبي: {customer.tax_id}</div>}
          {customer.billing_email && <div className="sub">{customer.billing_email}</div>}
        </div>
        <div className="party">
          <h3>Terms · الشروط</h3>
          <div className="kv">
            <span>Currency · العملة</span><span>{cur}{showEgp ? ` · 1 USD = ${invoice.fx_rate} EGP (${invoice.fx_source ?? ""} ${invoice.fx_date ?? ""})` : ""}</span>
            <span>VAT · الضريبة</span><span>{invoice.vat_treatment === "standard" || invoice.vat_treatment === "pending_review" ? `${invoice.vat_rate}% value-added tax` : invoice.vat_treatment === "zero_rated_export" ? "0% · exported service" : "out of scope"}</span>
            <span>Payment · السداد</span><span>{termDays != null ? `Bank transfer within ${termDays} days` : "Bank transfer on receipt"}, quoting the invoice number</span>
          </div>
        </div>
      </div>

      <table>
        <thead>
          <tr><th style={{ width: 28 }}>#</th><th>Description · البيان</th><th>Code · الكود</th><th className="r">Qty · الكمية</th><th className="r">Unit · سعر الوحدة</th><th className="r">VAT · الضريبة</th><th className="r">Total · الإجمالي</th></tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td>{l.position}</td>
              <td>{l.description}{l.description_ar && <div className="ar sub">{l.description_ar}</div>}</td>
              <td style={{ fontSize: 11, color: "#5F6B7D" }}>{l.item_code ?? "—"}</td>
              <td className="r">{l.quantity}</td>
              <td className="r">{fmtMoney(l.unit_price, cur)}</td>
              <td className="r">{fmtMoney(l.tax_amount, cur)}<div className="sub">{l.tax_rate}%</div></td>
              <td className="r">{fmtMoney(l.total, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="totals">
        <tbody>
          <tr><td>Subtotal · الإجمالي قبل الضريبة</td><td className="r">{fmtMoney(invoice.subtotal, cur)}</td></tr>
          {invoice.discount_total > 0 && <tr><td>Discount · الخصم</td><td className="r">−{fmtMoney(invoice.discount_total, cur)}</td></tr>}
          <tr><td>VAT {invoice.vat_rate}% · ضريبة القيمة المضافة</td><td className="r">{fmtMoney(invoice.tax_total, cur)}</td></tr>
          <tr className="grand"><td>Total · الإجمالي</td><td className="r">{fmtMoney(invoice.total, cur)}</td></tr>
          {showEgp && <tr><td className="egp">EGP equivalent · المعادل بالجنيه</td><td className="r egp">{fmtMoney(invoice.egp_total, "EGP")}</td></tr>}
          {invoice.amount_paid > 0 && <tr><td>Paid · المسدد</td><td className="r">{fmtMoney(invoice.amount_paid, cur)}</td></tr>}
          {open > 0.005 && invoice.status !== "void" && invoice.status !== "draft" && <tr><td style={{ fontWeight: 600 }}>Balance due · المتبقي</td><td className="r" style={{ fontWeight: 600 }}>{fmtMoney(open, cur)}</td></tr>}
        </tbody>
      </table>

      <div className="pay">
        {open > 0.005 && invoice.status !== "void" && invoice.status !== "draft" && bank && (bank.iban || bank.accountNumber) ? (
          <div className="box">
            <h3>Pay by bank transfer · السداد بالتحويل البنكي</h3>
            <div className="kv">
              {bank.bank && <><span>Bank</span><span>{bank.bank}</span></>}
              {bank.accountName && <><span>Account name</span><span>{bank.accountName}</span></>}
              {bank.iban && <><span>IBAN</span><span className="eta">{bank.iban}</span></>}
              {bank.accountNumber && <><span>Account no.</span><span className="eta">{bank.accountNumber}</span></>}
              {bank.swift && <><span>SWIFT</span><span>{bank.swift}</span></>}
              <span>Reference</span><span><b>{invoice.number}</b></span>
            </div>
            {bank.notes && <div className="sub" style={{ marginTop: 6 }}>{bank.notes}</div>}
          </div>
        ) : <div />}
        <div className="box">
          <h3>Tax authority · مصلحة الضرائب</h3>
          {invoice.eta_uuid ? (
            <div className="kv"><span>ETA UUID</span><span className="eta">{invoice.eta_uuid}</span>{invoice.eta_long_id && <><span>Long id</span><span className="eta">{invoice.eta_long_id}</span></>}<span>Status</span><span>{invoice.einvoice_status}</span></div>
          ) : (
            <div className="sub">{invoice.status === "draft" ? "Not issued yet." : "Registered with the Egyptian Tax Authority; the UUID is added to this document once the submission is accepted."}</div>
          )}
          {payments.filter((p) => p.status === "succeeded").length > 0 && (
            <div style={{ marginTop: 8 }}>
              <h3>Payments received · المدفوعات</h3>
              {payments.filter((p) => p.status === "succeeded").map((p) => <div key={p.id} className="sub">{fmtDate(p.received_at)} · {p.method.replace("_", " ")} · {fmtMoney(p.amount, p.currency)}{p.reference ? ` · ${p.reference}` : ""}</div>)}
            </div>
          )}
        </div>
      </div>

      {invoice.notes && <div className="sub" style={{ marginTop: 14 }}>{invoice.notes}</div>}
      <div className="foot">
        Issued electronically by the Arab ShipBroker platform · صادرة إلكترونياً من منصة الوسيط العربي للسفن. This document is a copy of the record held in the platform ledger; once registered with the ETA, the authority&apos;s UUID identifies the legal invoice.
      </div>
    </div>
  );
}
