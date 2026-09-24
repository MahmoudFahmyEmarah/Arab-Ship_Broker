"use client";

// One commercial term: the compact strip (status, holder, both positions,
// spread, validity countdown) and, when expanded, the positions, the
// bid/offer history and the composer. Every action goes through the room's
// command runner; nothing here decides commercial state.
import * as React from "react";
import type { FixtureProposalView, FixtureRoomView, FixtureTermView, FixtureValue, FixtureValueKind } from "@/lib/fixture-room/types";
import { countdown, formatFixtureValue, parseFixtureInput, relativeTime, spreadLabel } from "@/lib/fixture-room/format";
import { openingValueFromListing, type ListingFigures } from "@/lib/fixture-room/terms";
import type { RunCommand } from "./FixtureRoomClient";

function figuresFromSnapshot(view: FixtureRoomView): ListingFigures {
  const c = view.snapshot.cargo;
  const a = view.snapshot.vessel.availability;
  return {
    commodity: (c.commodity_name as string) ?? null, cargoType: (c.cargo_type as string) ?? null,
    qtyMin: (c.qty_min_mt as number) ?? null, qtyMax: (c.qty_max_mt as number) ?? null, stowageFactor: (c.stowage_factor as number) ?? null,
    loadPortCode: (c.load_port_locode as string) ?? null, loadPortName: (c.load_port_name as string) ?? null,
    dischPortCode: (c.disch_port_locode as string) ?? null, dischPortName: (c.disch_port_name as string) ?? null,
    laycanFrom: (c.laycan_from as string) ?? null, laycanTo: (c.laycan_to as string) ?? null, isSpot: (c.is_spot as boolean) ?? null,
    loadRate: c.load_rate == null ? null : Number(c.load_rate), dischRate: c.disch_rate == null ? null : Number(c.disch_rate),
    loadTerms: (c.load_terms as string) ?? null, freightIdea: (c.freight_idea_usd_mt as number) ?? null,
    vesselFreightIdea: (a.freight_idea_usd_mt as number) ?? null, commission: (c.commission_pct as number) ?? null, demurrage: (c.demurrage_rate as number) ?? null,
  };
}

function ValueFields({ kind, fields, setField }: { kind: FixtureValueKind; fields: Record<string, string>; setField: (k: string, v: string) => void }) {
  const f = (name: string, label: string, type = "text", extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="fxr-field" key={name}>
      <label htmlFor={`fx-${kind}-${name}`}>{label}</label>
      <input id={`fx-${kind}-${name}`} type={type} value={fields[name] ?? ""} onChange={(e) => setField(name, e.target.value)} {...extra} />
    </div>
  );
  switch (kind) {
    case "text": return <>{f("text", "Value", "text", { maxLength: 500 })}</>;
    case "number": return <>{f("num", "Amount", "number", { step: "any", inputMode: "decimal" })}</>;
    case "money_per_mt": return <>{f("num", "USD per MT", "number", { step: "0.01", min: 0, inputMode: "decimal" })}{f("currency", "Currency", "text", { maxLength: 3, placeholder: "USD" })}</>;
    case "rate_pair": return <>{f("load", "Load MT/day", "number", { step: "1", min: 1 })}{f("disch", "Discharge MT/day", "number", { step: "1", min: 1 })}</>;
    case "date_range":
      return (
        <>
          {f("from", "From", "date")}{f("to", "To", "date")}
          <div className="fxr-field is-check">
            <input id={`fx-${kind}-spot`} type="checkbox" checked={fields.spot === "true"} onChange={(e) => setField("spot", e.target.checked ? "true" : "")} />
            <label htmlFor={`fx-${kind}-spot`}>SPOT</label>
          </div>
        </>
      );
    case "port_pair": return <>{f("load", "Load port (LOCODE)", "text", { maxLength: 12 })}{f("disch", "Discharge port (LOCODE)", "text", { maxLength: 12 })}{f("load_name", "Load port name")}{f("disch_name", "Discharge port name")}</>;
  }
}

function valueToFields(kind: FixtureValueKind, v: FixtureValue | null): Record<string, string> {
  if (!v) return {};
  const o = v as Record<string, unknown>;
  switch (kind) {
    case "text": return { text: String(o.text ?? "") };
    case "number": return { num: String(o.num ?? "") };
    case "money_per_mt": return { num: String(o.num ?? ""), currency: String(o.currency ?? "USD") };
    case "rate_pair": return { load: String(o.load ?? ""), disch: String(o.disch ?? "") };
    case "date_range": return o.spot === true ? { spot: "true" } : { from: String(o.from ?? ""), to: String(o.to ?? "") };
    case "port_pair": return { load: String(o.load ?? ""), disch: String(o.disch ?? ""), load_name: String(o.load_name ?? ""), disch_name: String(o.disch_name ?? "") };
  }
}

function Position({ label, p, now, isTurn, actions }: { label: string; p: FixtureProposalView | null; now: number; isTurn: boolean; actions?: React.ReactNode }) {
  const lapsed = !!p && (p.lapsed || (now > 0 && !!p.expiresAt && Date.parse(p.expiresAt) < now));
  return (
    <div className="fxr-pos">
      <div className="fxr-pos__who">
        <span>{label}{isTurn ? " · to answer" : ""}</span>
        {p?.expiresAt && !lapsed && <span className="fxr-strip__timer">{countdown(p.expiresAt, now)}</span>}
        {lapsed && <span className="fxr-hold lapsed">lapsed</span>}
      </div>
      <div className={`fxr-pos__val${lapsed ? " is-lapsed" : ""}`}>{p ? p.displayValue : "—"}</div>
      {p?.comment && <div className="fxr-pos__cmt">{p.comment}</div>}
      {p && (
        <div className="fxr-pos__cmt">
          {p.kind === "bid" ? "Bid" : "Offer"} R{p.round}{p.isFinal ? " · final" : ""}{p.relayed ? " · recorded by Arab ShipBroker on their behalf" : ""} · {relativeTime(p.createdAt, now)}
        </div>
      )}
      {actions && <div className="fxr-pos__acts">{actions}</div>}
    </div>
  );
}

export function TermRow({ view, term, active, onActivate, run, busy, now, actForPartyId }: {
  view: FixtureRoomView; term: FixtureTermView; active: boolean; onActivate: () => void; run: RunCommand; busy: boolean; now: number; actForPartyId: string | null;
}) {
  const caps = view.viewer.capabilities;
  const side = view.viewer.side;
  const mySide: "cargo" | "vessel" | null = actForPartyId
    ? (view.parties.find((p) => p.id === actForPartyId)?.side as "cargo" | "vessel" | undefined) ?? null
    : side === "cargo" || side === "vessel" ? side : null;
  const agreed = term.status === "agreed";
  const cargoDisp = term.cargoPosition?.displayValue ?? "—";
  const vesselDisp = term.vesselPosition?.displayValue ?? "—";
  const spread = agreed ? "agreed" : spreadLabel(term.valueKind, term.cargoPosition?.value ?? null, term.vesselPosition?.value ?? null);
  const holderLabel = agreed ? null
    : term.heldByLabel ? "on hold"
    : term.holder == null ? "open"
    : mySide && term.holder === mySide ? "your move"
    : term.holder === "cargo" ? "→ cargo side" : "→ vessel side";
  const holderCls = term.heldByLabel ? "held" : mySide && term.holder === mySide ? "you" : "";
  const live = mySide === "cargo" ? term.vesselPosition : mySide === "vessel" ? term.cargoPosition : null;
  const liveLapsed = !!live && (live.lapsed || (now > 0 && !!live.expiresAt && Date.parse(live.expiresAt) < now));
  const own = mySide === "cargo" ? term.cargoPosition : mySide === "vessel" ? term.vesselPosition : null;
  const ownTimer = mySide === "cargo" ? term.vesselPosition : term.cargoPosition;
  const canWork = caps.canPropose && !!mySide && !agreed && term.status !== "withdrawn";
  const commonBase = { asPartyId: null as string | null, onBehalfOfPartyId: actForPartyId };

  // composer
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const [comment, setComment] = React.useState("");
  const [isFinal, setIsFinal] = React.useState(false);
  const [validity, setValidity] = React.useState<string>("");
  const [err, setErr] = React.useState<string | null>(null);
  const setField = (k: string, v: string) => setFields((f) => ({ ...f, [k]: v }));
  const preview = React.useMemo(() => {
    const r = parseFixtureInput(term.valueKind, fields);
    return r.ok ? formatFixtureValue(term.valueKind, r.value, term.unit) : null;
  }, [fields, term.valueKind, term.unit]);
  const listingFigure = React.useMemo(() => (mySide ? openingValueFromListing(term.code, figuresFromSnapshot(view), mySide) : null), [term.code, view, mySide]);

  const submit = async () => {
    const r = parseFixtureInput(term.valueKind, fields);
    if (!r.ok) { setErr(r.error); return; }
    setErr(null);
    const ok = await run("submit", (base) => ({
      ...base, ...commonBase, termId: term.id, value: r.value, comment: comment.trim() || null, isFinal,
      expiresInMinutes: validity ? Number(validity) : null,
    }));
    if (ok) { setFields({}); setComment(""); setIsFinal(false); }
  };

  const history = view.proposals.filter((p) => p.termId === term.id).slice(-4);

  return (
    <div className={`fxr-term s-${term.status}${active ? " is-active" : ""}`} data-testid={`term-row-${term.code}`}>
      <button type="button" className="fxr-strip" onClick={onActivate} aria-expanded={active} aria-controls={`fx-thread-${term.code}`} data-testid={`term-strip-${term.code}`} title={term.hint ?? term.label}>
        <span className={`fxr-strip__dot s-${term.status}`} aria-hidden="true" />
        <span className="fxr-strip__n">{term.sortOrder}</span>
        <span className="fxr-strip__name">{term.label}</span>
        {holderLabel && <span className={`fxr-hold ${holderCls}`} data-testid={`term-holder-${term.code}`}>{holderLabel}</span>}
        {term.referredAt && <span className="fxr-tag is-warn">referred</span>}
        <span className="fxr-strip__nego">
          <span className={`fxr-side${term.holder === "cargo" && !agreed ? " is-turn" : ""}`}><em>Cargo</em>{agreed && term.agreed?.side === "cargo" ? term.agreed.displayValue : cargoDisp}</span>
          <span aria-hidden="true">{agreed ? "≡" : "⟷"}</span>
          <span className={`fxr-side${term.holder === "vessel" && !agreed ? " is-turn" : ""}`}><em>Vessel</em>{agreed && term.agreed?.side === "vessel" ? term.agreed.displayValue : vesselDisp}</span>
        </span>
        <span className={`fxr-strip__spread${spread === "aligned" || agreed ? " is-aligned" : ""}`}>{agreed ? `agreed · ${term.agreed?.displayValue ?? ""}` : (spread ?? "")}</span>
        {!agreed && now > 0 && ownTimer?.expiresAt && Date.parse(ownTimer.expiresAt) > now && (
          <span className={`fxr-strip__timer${Date.parse(ownTimer.expiresAt) - now < 60_000 ? " is-urgent" : ""}`}>{countdown(ownTimer.expiresAt, now)}</span>
        )}
        {term.round > 0 && !agreed && <span className="fxr-strip__round">R{term.round}</span>}
        <span className={`fxr-strip__chev${active ? " is-open" : ""}`} aria-hidden="true">▸</span>
      </button>

      {active && (
        <div className="fxr-thread" id={`fx-thread-${term.code}`} data-testid={`term-thread-${term.code}`}>
          {term.hint && <div className="fxr-hint">{term.hint}</div>}
          <div className="fxr-positions">
            <Position label="Cargo side" p={term.cargoPosition} now={now} isTurn={!agreed && term.holder === "cargo"}
              actions={!agreed && mySide === "vessel" && term.cargoPosition && caps.canAccept ? (
                <button type="button" className="asb-btn primary" disabled={busy || liveLapsed} data-testid={`accept-${term.code}`}
                  onClick={() => run("accept", (base) => ({ ...base, ...commonBase, proposalId: term.cargoPosition!.id }))}>
                  {liveLapsed ? "Lapsed" : `Accept ${term.cargoPosition.displayValue}`}
                </button>
              ) : !agreed && mySide === "cargo" && own && caps.canWithdrawProposal ? (
                <button type="button" className="fxr-link" disabled={busy} onClick={() => run("withdraw", (base) => ({ ...base, ...commonBase, proposalId: own.id }))}>Withdraw my bid</button>
              ) : undefined} />
            <Position label="Vessel side" p={term.vesselPosition} now={now} isTurn={!agreed && term.holder === "vessel"}
              actions={!agreed && mySide === "cargo" && term.vesselPosition && caps.canAccept ? (
                <button type="button" className="asb-btn primary" disabled={busy || liveLapsed} data-testid={`accept-${term.code}`}
                  onClick={() => run("accept", (base) => ({ ...base, ...commonBase, proposalId: term.vesselPosition!.id }))}>
                  {liveLapsed ? "Lapsed" : `Accept ${term.vesselPosition.displayValue}`}
                </button>
              ) : !agreed && mySide === "vessel" && own && caps.canWithdrawProposal ? (
                <button type="button" className="fxr-link" disabled={busy} onClick={() => run("withdraw", (base) => ({ ...base, ...commonBase, proposalId: own.id }))}>Withdraw my offer</button>
              ) : undefined} />
          </div>

          {history.length > 0 && (
            <div className="fxr-history" aria-label="Bid and offer history">
              {history.map((p) => (
                <div key={p.id} className={`fxr-bubble lane-${p.side}`}>
                  <div className="fxr-bubble__top"><span>{p.label}</span><span className="fxr-bubble__tag">{p.kind.toUpperCase()} R{p.round}</span><span>{relativeTime(p.createdAt, now)}</span></div>
                  <div className="fxr-bubble__val">{p.displayValue}</div>
                  {p.comment && <div>{p.comment}</div>}
                </div>
              ))}
            </div>
          )}

          {agreed ? (
            <div className="fxr-locked-note">
              <span>✓ Agreed · {term.agreed?.displayValue} · accepted by {term.agreedByLabel ?? "—"}</span>
              {caps.canReopen && (
                <button type="button" className="fxr-link" disabled={busy} data-testid={`reopen-${term.code}`}
                  onClick={() => { const reason = window.prompt("Why reopen this term? (optional)") ?? ""; void run("reopen", (base) => ({ ...base, ...commonBase, termId: term.id, reason: reason || null })); }}>
                  Reopen
                </button>
              )}
            </div>
          ) : canWork ? (
            <div className="fxr-composer" data-testid={`composer-${term.code}`}>
              <div className="fxr-composer__row">
                <ValueFields kind={term.valueKind} fields={fields} setField={setField} />
              </div>
              <div className="fxr-composer__row">
                <div className="fxr-field">
                  <label htmlFor={`fx-${term.code}-comment`}>Comment</label>
                  <input id={`fx-${term.code}-comment`} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} placeholder="optional" />
                </div>
                <div className="fxr-field" style={{ flex: "0 0 140px" }}>
                  <label htmlFor={`fx-${term.code}-validity`}>Valid for</label>
                  <select id={`fx-${term.code}-validity`} value={validity} onChange={(e) => setValidity(e.target.value)}>
                    <option value="">no limit</option>
                    <option value="12">12 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="120">2 hours</option>
                    <option value="1440">24 hours</option>
                  </select>
                </div>
                <div className="fxr-field is-check">
                  <input id={`fx-${term.code}-final`} type="checkbox" checked={isFinal} onChange={(e) => setIsFinal(e.target.checked)} />
                  <label htmlFor={`fx-${term.code}-final`}>Final position</label>
                </div>
              </div>
              <div className="fxr-composer__acts">
                <button type="button" className="asb-btn primary" disabled={busy || !preview} onClick={submit} data-testid={`submit-${term.code}`}>
                  {mySide === "cargo" ? "Send bid" : "Send offer"}{preview ? ` · ${preview}` : ""}
                </button>
                {listingFigure && <button type="button" className="fxr-link" onClick={() => setFields(valueToFields(term.valueKind, listingFigure))}>Use listing figure</button>}
                {live && !liveLapsed && <button type="button" className="fxr-link" onClick={() => setFields(valueToFields(term.valueKind, live.value))}>Match their figure</button>}
                {caps.canFlagTerm && (
                  <>
                    <button type="button" className="fxr-link" disabled={busy} onClick={() => run("flag", (base) => ({ ...base, ...commonBase, termId: term.id, flag: term.heldByLabel ? "resume" : "hold" }))}>{term.heldByLabel ? "Resume" : "Hold"}</button>
                    <button type="button" className="fxr-link" disabled={busy} onClick={() => run("flag", (base) => ({ ...base, ...commonBase, termId: term.id, flag: term.referredAt ? "clear_referral" : "refer" }))}>{term.referredAt ? "Clear referral" : "Refer"}</button>
                  </>
                )}
                {err && <span className="fxr-error" role="alert">{err}</span>}
              </div>
            </div>
          ) : (
            <div className="fxr-hint">{view.room.status === "invited" || view.room.status === "negotiating" ? "Waiting for the other side." : "This term is closed for negotiation."}</div>
          )}
        </div>
      )}
    </div>
  );
}
