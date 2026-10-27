import { decideQuote, overridePrice } from "@/app/(admin)/admin/bunker/actions";
import type { AdminBunkerDashboard, AdminBunkerQuote } from "@/lib/bunker/admin";
import { SupplierPortFields } from "./SupplierPortFields";

const PRODUCTS = [
  { key: "HSFO380", label: "HSFO 380" },
  { key: "VLSFO", label: "VLSFO" },
  { key: "ULSFO", label: "ULSFO" },
  { key: "LSMGO", label: "LSMGO" },
  { key: "MGO05", label: "MGO 0.5%" },
  { key: "MDO", label: "MDO" },
];

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function FreshBadge({ q, asOf }: { q: AdminBunkerQuote; asOf: number }) {
  if (q.status === "submitted") return <span className="adm-badge pending">Awaiting approval</span>;
  // Approved but not started: a scheduled replacement, not a lapsed price (C2O-049).
  if (q.liveNow === false && Date.parse(q.validFrom) > asOf) return <span className="adm-badge pending">Scheduled · from {fmtDate(q.validFrom)}</span>;
  if (!q.validNow) return <span className="adm-badge expired">Validity lapsed</span>;
  const cls = q.freshness === "current" ? "current" : q.freshness === "stale" ? "stale" : "expired";
  const label = q.freshness === "current" ? "Current" : q.freshness === "stale" ? "Stale" : q.freshness === "expired" ? "Outdated" : "Hidden";
  return <span className={`adm-badge ${cls}`}>{label}</span>;
}

function sourceLabel(q: AdminBunkerQuote) {
  return q.source === "supplier" ? "Supplier" : q.source === "admin_override" ? `Override · ${q.reason ?? ""}` : "Platform input";
}

function ApprovedTable({ rows, canEdit, action, asOf }: { rows: AdminBunkerQuote[]; canEdit: boolean; action: "Withdraw" | "Cancel"; asOf: number }) {
  return (
    <div className="adm-table">
      <table>
        <thead><tr><th>Supplier</th><th>Port</th><th>Product</th><th className="num">USD/MT</th><th className="num">Barge + charges</th><th className="num">Min stem</th><th>{action === "Cancel" ? "Starts" : "Valid until"}</th><th>Freshness</th><th>Source</th>{canEdit && <th />}</tr></thead>
        <tbody>
          {rows.map((q) => (
            <tr key={q.id} className="no-hover">
              <td>{q.supplierName}</td>
              <td>{q.portName} <span className="mono">{q.portLocode}</span></td>
              <td>{q.productKey}</td>
              <td className="num">{usd(q.priceUsdMt)}</td>
              <td className="num">{q.bargeFeeUsd + q.mandatoryChargesUsd > 0 ? usd(q.bargeFeeUsd + q.mandatoryChargesUsd) : "—"}</td>
              <td className="num">{q.minQtyMt ? `${q.minQtyMt} MT` : "—"}</td>
              <td>{fmtDate(action === "Cancel" ? q.validFrom : q.validUntil)}</td>
              <td><FreshBadge q={q} asOf={asOf} /></td>
              <td>{sourceLabel(q)}</td>
              {canEdit && (
                <td>
                  <form action={decideQuote} style={{ display: "flex", gap: 6 }}>
                    <input type="hidden" name="quoteId" value={q.id} />
                    <input type="hidden" name="decision" value="withdraw" />
                    <input className="adm-input" name="reason" required minLength={3} placeholder="Reason" aria-label={`${action === "Cancel" ? "Cancellation" : "Withdrawal"} reason`} />
                    <button className="adm-btn">{action}</button>
                  </form>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const isLiveQuote = (q: AdminBunkerQuote) => q.liveNow ?? q.validNow;

/** Quotes from unverified suppliers waiting for a decision (not in the design; the approval flow needs it). */
export function PendingApprovals({ dash, canEdit }: { dash: AdminBunkerDashboard; canEdit: boolean }) {
  const pending = dash.quotes.filter((q) => q.status === "submitted");
  if (pending.length === 0) return null;
  return (
    <section className="adm-card">
      <div className="adm-card__head"><span className="adm-card__title">Awaiting approval</span><span className="adm-card__sub">{pending.length} quote{pending.length > 1 ? "s" : ""} from unverified suppliers</span></div>
      <div className="adm-table">
        <table>
          <thead><tr><th>Supplier</th><th>Port</th><th>Product</th><th className="num">USD/MT</th><th>Valid until</th><th>Submitted</th>{canEdit && <th>Decision</th>}</tr></thead>
          <tbody>
            {pending.map((q) => (
              <tr key={q.id} className="no-hover">
                <td>{q.supplierName}</td>
                <td>{q.portName} <span className="mono">{q.portLocode}</span></td>
                <td>{q.productKey}</td>
                <td className="num">{usd(q.priceUsdMt)}</td>
                <td>{fmtDate(q.validUntil)}</td>
                <td>{fmtDate(q.submittedAt)}</td>
                {canEdit && (
                  <td>
                    <form action={decideQuote} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <input type="hidden" name="quoteId" value={q.id} />
                      <input className="adm-input" name="reason" placeholder="Reason (required to reject)" aria-label="Decision reason" />
                      <button className="adm-btn approve" name="decision" value="approve">Approve</button>
                      <button className="adm-btn reject" name="decision" value="reject">Reject</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The design's "Current prices": one row per sponsor, one column per product (the live price; the lowest of its
 *  ports when it quotes several). Edit opens the override form; the per-quote detail and withdrawal sit below. */
export function CurrentPrices({ dash, canEdit }: { dash: AdminBunkerDashboard; canEdit: boolean }) {
  const asOf = Date.parse(dash.asOf); // server time of this dashboard read
  const live = dash.quotes.filter((q) => q.status === "approved" && isLiveQuote(q));
  const bySupplier = new Map<string, { name: string; cells: Map<string, AdminBunkerQuote[]> }>();
  for (const q of live) {
    const row = bySupplier.get(q.supplierId) ?? { name: q.supplierName, cells: new Map<string, AdminBunkerQuote[]>() };
    row.cells.set(q.productKey, [...(row.cells.get(q.productKey) ?? []), q]);
    bySupplier.set(q.supplierId, row);
  }
  const products = PRODUCTS.filter((p) => live.some((q) => q.productKey === p.key));
  return (
    <section className="adm-card" style={{ padding: 0 }}>
      <div className="adm-card__head" style={{ padding: "12px 16px 4px", marginBottom: 0 }}>
        <span className="adm-card__title">Current prices</span>
        {/* the headline the stat grid used to carry: live approved quotes, and how many of them are current */}
        <span className="adm-card__sub" data-testid="live-quotes">{live.length} live quote{live.length === 1 ? "" : "s"} · {live.filter((q) => q.freshness === "current" && q.validNow).length} current</span>
        <span className="adm-card__sub adm-card__sub--amber">Manual edits override the sponsor&apos;s published values until they republish.</span>
      </div>
      {live.length === 0 ? (
        <div className="adm-empty" style={{ margin: 16 }}>No live quote. Members see “No current offer” and the estimator uses its fallback.</div>
      ) : (
        <div className="adm-table" style={{ border: "none", borderRadius: 0 }}>
          <table>
            <thead><tr><th>Sponsor</th>{products.map((p) => <th key={p.key} className="num">{p.label}</th>)}<th /></tr></thead>
            <tbody>
              {[...bySupplier.entries()].map(([id, row]) => (
                <tr key={id}>
                  <td>{row.name}</td>
                  {products.map((p) => {
                    const qs = row.cells.get(p.key) ?? [];
                    if (qs.length === 0) return <td key={p.key} className="num">-</td>;
                    const best = qs.reduce((a, b) => (b.priceUsdMt < a.priceUsdMt ? b : a));
                    return <td key={p.key} className="num" title={qs.map((q) => `${q.portName} ${usd(q.priceUsdMt)}`).join(" · ")}>{usd(best.priceUsdMt)}{qs.length > 1 ? <span className="adm-muted"> · lowest of {qs.length} ports</span> : null}</td>;
                  })}
                  <td style={{ textAlign: "right" }}>{canEdit && <a className="adm-btn ghost small" href="#override">Edit</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {live.length > 0 && (
        <details className="adm-card__more">
          <summary>Price details, delivery terms and withdrawal ({live.length})</summary>
          <ApprovedTable rows={live} canEdit={canEdit} action="Withdraw" asOf={asOf} />
        </details>
      )}
    </section>
  );
}

/** Approved prices that start later (each replaces the live one at its start). */
export function ScheduledPrices({ dash, canEdit }: { dash: AdminBunkerDashboard; canEdit: boolean }) {
  const asOf = Date.parse(dash.asOf);
  const scheduled = dash.quotes.filter((q) => q.status === "approved" && !isLiveQuote(q) && Date.parse(q.validFrom) > asOf);
  if (scheduled.length === 0) return null;
  return (
    <section className="adm-card" aria-label="Scheduled prices">
      <div className="adm-card__head">
        <span className="adm-card__title">Scheduled to go live</span>
        <span className="adm-card__sub">The current price stays live until each of these starts. Cancelling one restores the price it was to replace.</span>
      </div>
      <ApprovedTable rows={scheduled} canEdit={canEdit} action="Cancel" asOf={asOf} />
    </section>
  );
}

/** The design's per-row "Edit": enter or override one price (supplier-scoped port search). */
export function OverridePrice({ dash }: { dash: AdminBunkerDashboard }) {
  return (
    <section className="adm-card" id="override">
      <div className="adm-card__head">
        <span className="adm-card__title">Edit or override a price</span>
        <span className="adm-card__sub">An override stands until the supplier republishes; under “Platform (manual)” it is staff input. Goes live immediately.</span>
      </div>
      <form action={overridePrice} className="adm-settings-grid">
        <SupplierPortFields suppliers={dash.suppliers.map((s) => ({ id: s.id, name: s.name, disabled: s.status === "disabled", ports: s.ports }))} />
        <label className="adm-field"><span className="adm-field__label">Product</span>
          <select className="adm-select" name="productKey" required>
            {PRODUCTS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <label className="adm-field"><span className="adm-field__label">Price USD/MT</span>
          <input className="adm-input" name="priceUsdMt" type="number" step="0.01" min="0.01" max="9999" required />
        </label>
        <label className="adm-field"><span className="adm-field__label">Delivery</span>
          <select className="adm-select" name="deliveryMode" defaultValue="barge">
            <option value="barge">Barge</option><option value="truck">Truck</option><option value="pipe">Pipe</option><option value="ex_wharf">Ex-wharf</option>
          </select>
        </label>
        <label className="adm-field"><span className="adm-field__label">Min stem MT</span>
          <input className="adm-input" name="minQtyMt" type="number" step="1" min="1" />
        </label>
        <label className="adm-field"><span className="adm-field__label">Barge fee USD (per delivery)</span>
          <input className="adm-input" name="bargeFeeUsd" type="number" step="0.01" min="0" />
        </label>
        <label className="adm-field"><span className="adm-field__label">Mandatory charges USD (per delivery)</span>
          <input className="adm-input" name="mandatoryChargesUsd" type="number" step="0.01" min="0" />
        </label>
        <label className="adm-field"><span className="adm-field__label">Valid for (days)</span>
          <input className="adm-input" name="validDays" type="number" min="1" max="60" defaultValue={14} required />
        </label>
        <label className="adm-field"><span className="adm-field__label">Reason (audit)</span>
          <input className="adm-input" name="reason" required minLength={3} placeholder="e.g. phoned price, supplier portal down" />
        </label>
        <div><button className="adm-btn primary" type="submit">Record price</button></div>
      </form>
    </section>
  );
}
