"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { publishQuotes, withdrawQuote } from "@/app/(dashboard)/dashboard/bunker-supplier/actions";
import { DAY_MS, freshnessFromAgeMs } from "@/lib/bunker/freshness";
import {
  attemptFor,
  slotsForPort,
  type SubmissionAttempt,
  type SupplierPortalQuote,
  type SupplierPortalState,
  type SupplierPortalSupplier,
  type SupplierQuoteInput,
} from "@/lib/bunker/supplier";

// Price table by port × product. A supplier types new prices (or republishes
// the current ones with a fresh validity) and submits them in one batch.
// Per-port delivery terms apply to every price entered for that port.

type PortTerms = { deliveryMode: SupplierPortalQuote["deliveryMode"]; minQtyMt: string; bargeFeeUsd: string; mandatoryChargesUsd: string };
type Cells = Record<string, string>; // `${locode}|${product}` -> typed price

const ACTION_LABEL: Record<string, string> = {
  submit: "Submitted", approve: "Live", reject: "Rejected", withdraw: "Withdrawn", override: "Platform override", import: "Imported",
};

// Only the caller is identified; anyone else is a colleague (submissions) or the platform (decisions).
function byLabel(h: { byMe: boolean; action: string }) {
  if (h.byMe) return "You";
  if (h.action === "submit") return "Colleague";
  if (h.action === "withdraw") return "Colleague or Arab ShipBroker";
  return "Arab ShipBroker";
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

function termsFrom(quotes: SupplierPortalQuote[], locode: string): PortTerms {
  const q = quotes.find((x) => x.portLocode === locode && x.status === "approved") ?? quotes.find((x) => x.portLocode === locode);
  return {
    deliveryMode: q?.deliveryMode ?? "barge",
    minQtyMt: q?.minQtyMt ? String(q.minQtyMt) : "",
    bargeFeeUsd: q?.bargeFeeUsd ? String(q.bargeFeeUsd) : "",
    mandatoryChargesUsd: q?.mandatoryChargesUsd ? String(q.mandatoryChargesUsd) : "",
  };
}

function CellStatus({ live, pending, now }: { live?: SupplierPortalQuote; pending?: SupplierPortalQuote; now: number }) {
  if (pending) return <span className="bks-tag bks-tag--pending">${pending.priceUsdMt} awaiting approval</span>;
  if (!live) return <span className="bks-tag">No price</span>;
  const starts = Date.parse(live.validFrom);
  if (starts > now) {
    // Approved but not yet in effect: the previous price stays live until then (109000).
    return <span className="bks-tag bks-tag--pending">${live.priceUsdMt} from {new Date(starts).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>;
  }
  // Age runs from when the price took effect, as on the ticker and in the index.
  const age = now - Math.max(Date.parse(live.submittedAt), starts);
  const tier = Date.parse(live.validUntil) < now ? "expired" : freshnessFromAgeMs(age);
  const label = tier === "current" ? "Current" : tier === "stale" ? `Stale · ${Math.floor(age / DAY_MS)}d` : "Outdated";
  return (
    <span className={`bks-tag bks-tag--${tier === "current" ? "current" : tier === "stale" ? "stale" : "expired"}`}>
      ${live.priceUsdMt} · {label}
    </span>
  );
}

function SupplierTable({ supplier, products, now }: {
  supplier: SupplierPortalSupplier; products: SupplierPortalState["products"]; now: number;
}) {
  const router = useRouter();
  const canEdit = supplier.role === "editor" && supplier.status === "enabled";
  const [cells, setCells] = React.useState<Cells>({});
  const [terms, setTerms] = React.useState<Record<string, PortTerms>>(() =>
    Object.fromEntries(supplier.ports.map((p) => [p.locode, termsFrom(supplier.quotes, p.locode)])),
  );
  const [validDays, setValidDays] = React.useState("14");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // The exact command of the pending attempt: a retry (double click, lost
  // response) resends it byte-for-byte, so the server replays instead of
  // duplicating or conflicting. Cleared on success.
  const attempt = React.useRef<SubmissionAttempt | null>(null);

  // A key can hold the price live now and a scheduled replacement at once (110000);
  // both are shown, each with its own action (C2O-049).
  const approvedAt = (locode: string, key: string) =>
    supplier.quotes.filter((q) => q.portLocode === locode && q.productKey === key && q.status === "approved");
  const isLive = (q: SupplierPortalQuote) => q.liveNow ?? Date.parse(q.validFrom) <= now;
  const live = (locode: string, key: string) => approvedAt(locode, key).find(isLive);
  const scheduled = (locode: string, key: string) => approvedAt(locode, key).find((q) => !isLive(q));
  const pending = (locode: string, key: string) =>
    supplier.quotes.find((q) => q.portLocode === locode && q.productKey === key && q.status === "submitted");

  function build(prices: { locode: string; key: string; price: number }[]): SupplierQuoteInput[] {
    const ref = crypto.randomUUID();
    const until = new Date(Date.now() + Number(validDays) * DAY_MS).toISOString();
    return prices.map(({ locode, key, price }) => {
      const t = terms[locode];
      return {
        portLocode: locode,
        productKey: key as SupplierQuoteInput["productKey"],
        priceUsdMt: price,
        validUntil: until,
        deliveryMode: t.deliveryMode,
        minQtyMt: t.minQtyMt ? Number(t.minQtyMt) : null,
        bargeFeeUsd: t.bargeFeeUsd ? Number(t.bargeFeeUsd) : 0,
        mandatoryChargesUsd: t.mandatoryChargesUsd ? Number(t.mandatoryChargesUsd) : 0,
        clientRef: `${ref}:${locode}:${key}`,
      };
    });
  }

  async function submit(prices: { locode: string; key: string; price: number }[]) {
    setNotice(null);
    if (prices.length === 0) return setNotice({ kind: "error", text: "Enter at least one price." });
    if (prices.some((p) => !(p.price > 0))) return setNotice({ kind: "error", text: "Prices must be above zero." });
    const fingerprint = JSON.stringify({ prices, terms, validDays });
    attempt.current = attemptFor(attempt.current, fingerprint, () => build(prices));
    setBusy(true);
    let r: Awaited<ReturnType<typeof publishQuotes>>;
    try {
      r = await publishQuotes(supplier.id, attempt.current.payload);
    } catch {
      setBusy(false);
      return setNotice({
        kind: "error",
        text: "The connection dropped before we heard back. Press the same button again: your prices will not be duplicated.",
      });
    }
    setBusy(false);
    if (!r.ok) return setNotice({ kind: "error", text: r.error });
    attempt.current = null;
    setCells({});
    setNotice({
      kind: "ok",
      text: r.autoApproved
        ? `${r.submitted} price${r.submitted > 1 ? "s" : ""} published and live on the ticker.`
        : `${r.submitted} price${r.submitted > 1 ? "s" : ""} submitted; they go live after Arab ShipBroker approves them.`,
    });
    router.refresh();
  }

  const typed = () =>
    Object.entries(cells)
      .filter(([, v]) => v.trim() !== "")
      .map(([k, v]) => {
        const [locode, key] = k.split("|");
        return { locode, key, price: Number(v) };
      });

  // One price per port × product: the one live now (a scheduled replacement is not republished).
  const republish = () =>
    supplier.quotes
      .filter((q) => q.status === "approved" && q.liveNow !== false)
      .map((q) => ({ locode: q.portLocode, key: q.productKey, price: q.priceUsdMt }));

  return (
    <section className="bks-card" aria-labelledby={`sup-${supplier.id}`}>
      <div className="bks-card__head">
        <h2 id={`sup-${supplier.id}`} className="bks-card__title">{supplier.name}</h2>
        <span className={`bks-tag ${supplier.verified ? "bks-tag--current" : "bks-tag--pending"}`}>
          {supplier.verified ? "Verified · prices go live at once" : "Prices are reviewed before going live"}
        </span>
        {!canEdit && <span className="bks-tag">{supplier.status === "disabled" ? "Supplier disabled" : "View only"}</span>}
      </div>

      {supplier.ports.length === 0 && <p className="bks-muted">No port is registered for you yet. Ask Arab ShipBroker to add your ports.</p>}

      {supplier.ports.map((port) => {
        const slots = slotsForPort(products, port, supplier.quotes);
        const t = terms[port.locode];
        return (
          <div key={port.locode} className="bks-port">
            <div className="bks-port__head">
              <h3 className="bks-port__name">{port.name} <span className="bks-mono">{port.locode}</span></h3>
              {port.eca && <span className="bks-tag">ECA · 0.10 % S</span>}
            </div>
            <div className="bks-grid" role="table" aria-label={`Prices at ${port.name}`}>
              {slots.map((p) => {
                const k = `${port.locode}|${p.key}`;
                const lv = live(port.locode, p.key);
                const sc = scheduled(port.locode, p.key);
                const pd = pending(port.locode, p.key);
                return (
                  <div key={p.key} className="bks-cell" role="row">
                    <div className="bks-cell__label" role="rowheader">
                      {p.label} <span className="bks-muted">{p.isoGrade} · {p.sulphurClass}</span>
                    </div>
                    <CellStatus live={lv} pending={pd} now={now} />
                    {sc && (
                      <div className="bks-cell__row">
                        <span className="bks-tag bks-tag--pending" data-testid="scheduled-price">
                          Scheduled ${sc.priceUsdMt} from {new Date(sc.validFrom).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })}
                        </span>
                        {canEdit && (
                          <button
                            type="button" className="bks-btn bks-btn--ghost" disabled={busy}
                            aria-label={`Cancel the scheduled ${p.label} price at ${port.name}`}
                            onClick={async () => {
                              const r = await withdrawQuote(sc.id);
                              setNotice(r.ok ? { kind: "ok", text: `Scheduled ${p.label} price cancelled at ${port.name}; the current price stays live.` } : { kind: "error", text: r.error ?? "Failed" });
                              router.refresh();
                            }}
                          >
                            Cancel scheduled
                          </button>
                        )}
                      </div>
                    )}
                    <div className="bks-cell__row">
                      {canEdit && (
                        <input
                          className="bks-input"
                          type="number" inputMode="decimal" min="0.01" max="9999" step="0.01"
                          placeholder="New USD/MT"
                          aria-label={`New ${p.label} price at ${port.name}, USD per MT`}
                          value={cells[k] ?? ""}
                          onChange={(e) => setCells((c) => ({ ...c, [k]: e.target.value }))}
                        />
                      )}
                      {canEdit && (lv || pd) && (
                        <button
                          type="button" className="bks-btn bks-btn--ghost" disabled={busy}
                          onClick={async () => {
                            const r = await withdrawQuote((pd ?? lv)!.id);
                            setNotice(r.ok ? { kind: "ok", text: `${p.label} withdrawn at ${port.name}.` } : { kind: "error", text: r.error ?? "Failed" });
                            router.refresh();
                          }}
                        >
                          Withdraw
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {canEdit && (
              <div className="bks-terms">
                <label>Delivery
                  <select className="bks-input" value={t.deliveryMode}
                          onChange={(e) => setTerms((s) => ({ ...s, [port.locode]: { ...t, deliveryMode: e.target.value as PortTerms["deliveryMode"] } }))}>
                    <option value="barge">Barge</option><option value="truck">Truck</option><option value="pipe">Pipe</option><option value="ex_wharf">Ex-wharf</option>
                  </select>
                </label>
                <label>Min stem MT
                  <input className="bks-input" type="number" min="1" value={t.minQtyMt}
                         onChange={(e) => setTerms((s) => ({ ...s, [port.locode]: { ...t, minQtyMt: e.target.value } }))} />
                </label>
                <label>Barge fee USD / delivery
                  <input className="bks-input" type="number" min="0" step="0.01" value={t.bargeFeeUsd}
                         onChange={(e) => setTerms((s) => ({ ...s, [port.locode]: { ...t, bargeFeeUsd: e.target.value } }))} />
                </label>
                <label>Mandatory charges USD / delivery
                  <input className="bks-input" type="number" min="0" step="0.01" value={t.mandatoryChargesUsd}
                         onChange={(e) => setTerms((s) => ({ ...s, [port.locode]: { ...t, mandatoryChargesUsd: e.target.value } }))} />
                </label>
              </div>
            )}
          </div>
        );
      })}

      {canEdit && supplier.ports.length > 0 && (
        <div className="bks-actions">
          <label>Valid for
            <select className="bks-input" value={validDays} onChange={(e) => setValidDays(e.target.value)}>
              {[3, 7, 10, 14, 21, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
          <button type="button" className="bks-btn bks-btn--primary" disabled={busy} onClick={() => submit(typed())}>
            {busy ? "Publishing…" : "Publish new prices"}
          </button>
          <button type="button" className="bks-btn" disabled={busy || republish().length === 0} onClick={() => submit(republish())}
                  title="Confirm your current prices unchanged and restart their validity">
            Republish current prices
          </button>
        </div>
      )}
      {notice && (
        <p className={`bks-notice bks-notice--${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>
      )}

      <details className="bks-history">
        <summary>Update history ({supplier.history.length})</summary>
        {supplier.history.length === 0 ? <p className="bks-muted">Nothing yet.</p> : (
          <table className="bks-table">
            <thead><tr><th>When</th><th>Action</th><th>Port</th><th>Product</th><th>Old</th><th>New</th><th>Valid until</th><th>By</th></tr></thead>
            <tbody>
              {supplier.history.map((h, i) => (
                <tr key={`${h.at}-${i}`}>
                  <td>{fmt(h.at)}</td><td>{ACTION_LABEL[h.action] ?? h.action}</td><td className="bks-mono">{h.portLocode}</td>
                  <td>{h.productKey}</td><td>{h.oldPrice != null ? `$${h.oldPrice}` : "—"}</td><td>{h.newPrice != null ? `$${h.newPrice}` : "—"}</td>
                  <td>{h.validUntil ? fmt(h.validUntil) : "—"}</td><td>{byLabel(h)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </section>
  );
}

export function SupplierPortal({ state }: { state: SupplierPortalState }) {
  // Freshness labels are relative to page load; the page re-renders after every publish.
  const [now] = React.useState(() => Date.now());
  return (
    <div className="bks">
      <header className="bks__head">
        <h1 className="bks__title">Bunker prices</h1>
        <p className="bks__sub">
          Execution prices in good faith, USD per metric tonne. Refresh every 10–14 days or on a big move:
          prices older than 7 days show as stale, after 14 days they leave the platform index, after 21 days they leave the ticker.
        </p>
      </header>
      {state.suppliers.map((s) => <SupplierTable key={s.id} supplier={s} products={state.products} now={now} />)}
    </div>
  );
}
