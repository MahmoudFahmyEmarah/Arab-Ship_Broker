"use client";

// One main item as designed (nr-item · fx-strip · fx-thread): the compact
// strip with both sides' figures, whose move it is, the spread and gap bar,
// the validity countdown and the round; expanded, the presence row with the
// validity ring, the three-lane thread of bids, offers and notes, and the
// composer for the viewer's seat. Every action goes through the room's
// command runner; nothing here decides commercial state.
import * as React from "react";
import type { FixtureProposalView, FixtureRoomView, FixtureTermView, FixtureValue, FixtureValueKind } from "@/lib/fixture-room/types";
import { countdown, formatFixtureValue, numericOf, parseFixtureInput, relativeTime, spreadLabel } from "@/lib/fixture-room/format";
import { openingValueFromListing, type ListingFigures } from "@/lib/fixture-room/terms";
import type { SidePresence } from "@/lib/fixture-room/presence";
import type { RunCommand } from "./FixtureRoomClient";
import { Gloss } from "./Gloss";
import { IcAlert, IcLock } from "./icons";

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
    <div className="fx-field" key={name}>
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
          <div className="fx-field is-check">
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

const isLapsed = (p: FixtureProposalView | null, now: number) => !!p && (p.lapsed || (now > 0 && !!p.expiresAt && Date.parse(p.expiresAt) < now));
const sideNoun = (s: "cargo" | "vessel") => (s === "cargo" ? "Cargo" : "Vessel");

/** How far apart the two positions are, as a share of the first-round gap (the design's gap bar). */
function gapPercent(term: FixtureTermView, proposals: FixtureProposalView[]): number {
  const a = numericOf(term.valueKind, term.cargoPosition?.value);
  const b = numericOf(term.valueKind, term.vesselPosition?.value);
  if (a == null || b == null || term.status === "agreed") return 0;
  const spread = Math.abs(a - b);
  if (spread === 0) return 0;
  const firstOf = (side: "cargo" | "vessel") => {
    const first = proposals.filter((p) => p.termId === term.id && p.side === side).sort((x, y) => x.createdAt.localeCompare(y.createdAt))[0];
    return first ? numericOf(term.valueKind, first.value) : null;
  };
  const a0 = firstOf("cargo"), b0 = firstOf("vessel");
  const spread0 = a0 != null && b0 != null && a0 !== b0 ? Math.abs(a0 - b0) : spread;
  return Math.max(6, Math.min(100, Math.round((spread / spread0) * 100)));
}

export function TermRow({ view, term, active, onActivate, run, busy, now, actForPartyId, presence, hovered, onHover, isNew = false }: {
  view: FixtureRoomView; term: FixtureTermView; active: boolean; onActivate: () => void; run: RunCommand; busy: boolean; now: number; actForPartyId: string | null;
  presence: { cargo: SidePresence; vessel: SidePresence }; hovered: boolean; onHover: (id: string | null) => void; isNew?: boolean;
}) {
  const caps = view.viewer.capabilities;
  const side = view.viewer.side;
  const mySide: "cargo" | "vessel" | null = actForPartyId
    ? (view.parties.find((p) => p.id === actForPartyId)?.side as "cargo" | "vessel" | undefined) ?? null
    : side === "cargo" || side === "vessel" ? side : null;
  const otherSide: "cargo" | "vessel" | null = mySide === "cargo" ? "vessel" : mySide === "vessel" ? "cargo" : null;
  const agreed = term.status === "agreed";
  const cargoDisp = agreed && term.agreed?.side === "cargo" ? term.agreed.displayValue : term.cargoPosition?.displayValue ?? "—";
  const vesselDisp = agreed && term.agreed?.side === "vessel" ? term.agreed.displayValue : term.vesselPosition?.displayValue ?? "—";
  const spread = agreed ? null : spreadLabel(term.valueKind, term.cargoPosition?.value ?? null, term.vesselPosition?.value ?? null);
  const aligned = agreed || spread === "aligned";
  const gap = React.useMemo(() => gapPercent(term, view.proposals), [term, view.proposals]);
  const holderLabel = agreed ? null
    : term.referredAt ? "referred"
    : term.heldByLabel ? "on hold"
    : term.holder == null ? "open"
    : mySide && term.holder === mySide ? "your move"
    : term.holder === "cargo" ? "→ Cargo" : "→ Vessel";
  const holderCls = term.referredAt ? "refer" : term.heldByLabel ? "hold" : term.holder == null ? "" : mySide && term.holder === mySide ? "you" : term.holder;
  const live = mySide === "cargo" ? term.vesselPosition : mySide === "vessel" ? term.cargoPosition : null;   // the other side's standing figure
  const own = mySide === "cargo" ? term.cargoPosition : mySide === "vessel" ? term.vesselPosition : null;
  const liveLapsed = isLapsed(live, now);
  const ownLapsed = isLapsed(own, now);
  // the countdown that matters on the strip: the figure awaiting an answer
  const ticking = !agreed ? (term.holder === "cargo" ? term.vesselPosition : term.holder === "vessel" ? term.cargoPosition : null) : null;
  const tickingLeft = ticking?.expiresAt && now > 0 ? Date.parse(ticking.expiresAt) - now : null;
  // the figure currently on the table: the latest of the two sides' standing positions
  const standing = [term.cargoPosition, term.vesselPosition].filter((p): p is FixtureProposalView => !!p).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const canWork = caps.canPropose && !!mySide && !agreed && term.status !== "withdrawn";
  const commonBase = { asPartyId: null as string | null, onBehalfOfPartyId: actForPartyId };

  // composer
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const [comment, setComment] = React.useState("");
  const [isFinal, setIsFinal] = React.useState(false);
  const [validity, setValidity] = React.useState<string>("");
  const [err, setErr] = React.useState<string | null>(null);
  const [lapseDismissed, setLapseDismissed] = React.useState<string | null>(null);
  const setField = (k: string, v: string) => setFields((f) => ({ ...f, [k]: v }));
  const preview = React.useMemo(() => {
    const r = parseFixtureInput(term.valueKind, fields);
    return r.ok ? formatFixtureValue(term.valueKind, r.value, term.unit) : null;
  }, [fields, term.valueKind, term.unit]);
  const listingFigure = React.useMemo(() => (mySide ? openingValueFromListing(term.code, figuresFromSnapshot(view), mySide) : null), [term.code, view, mySide]);

  const submit = async (override?: { value: FixtureValue; expiresInMinutes: number | null }) => {
    let value: FixtureValue;
    if (override) value = override.value;
    else {
      const r = parseFixtureInput(term.valueKind, fields);
      if (!r.ok) { setErr(r.error); return; }
      value = r.value;
    }
    setErr(null);
    const ok = await run("submit", (base) => ({
      ...base, ...commonBase, termId: term.id, value, comment: override ? null : comment.trim() || null, isFinal: override ? false : isFinal,
      expiresInMinutes: override ? override.expiresInMinutes : validity ? Number(validity) : null,
    }));
    if (ok && !override) { setFields({}); setComment(""); setIsFinal(false); }
  };

  // the thread: this term's bids and offers plus the notes and nudges pinned to it, oldest first
  type ThreadItem = { key: string; lane: "cargo" | "vessel" | "broker"; who: string; tag: string; kind: "bid" | "offer" | "note"; value: string; comment: string | null; at: string; mine: boolean };
  const threadProposals: ThreadItem[] = view.proposals.filter((x) => x.termId === term.id).map((p) => ({
    key: `p-${p.id}`, lane: p.side === "mediator" ? "broker" : p.side, who: p.isMine ? "You" : p.relayed ? `${p.label} · via ASB` : p.label,
    tag: `${p.kind.toUpperCase()} R${p.round}${p.isFinal ? " · FINAL" : ""}`, kind: p.kind, value: p.displayValue, comment: p.comment, at: p.createdAt, mine: p.isMine,
  }));
  const threadNotes: ThreadItem[] = view.messages.filter((x) => x.termId === term.id).map((m) => ({
    key: `m-${m.id}`, lane: m.side === "mediator" ? "broker" : m.side, who: m.isMine ? "You" : m.label, tag: m.kind === "nudge" ? "NUDGE" : "NOTE",
    kind: "note", value: m.redacted ? "Redacted by an administrator." : m.body ?? "", comment: null, at: m.createdAt, mine: m.isMine,
  }));
  const thread = [...threadProposals, ...threadNotes].sort((a, b) => a.at.localeCompare(b.at)).slice(-6);

  const ringPct = live?.expiresAt && !liveLapsed && now > 0
    ? Math.max(0, Math.min(100, ((Date.parse(live.expiresAt) - now) / Math.max(1, Date.parse(live.expiresAt) - Date.parse(live.createdAt))) * 100))
    : null;
  const rootCls = `nr-item fx s-${term.status}${hovered ? " is-linked" : ""}${term.heldByLabel ? " is-parked" : ""}${active ? " is-active" : ""}${agreed ? " is-agreed" : ""}`;

  return (
    <div className={rootCls} data-testid={`term-row-${term.code}`} onMouseEnter={() => onHover(term.id)} onMouseLeave={() => onHover(null)}>
      {/* compact negotiation strip · always visible */}
      <button type="button" className="fx-strip" onClick={onActivate} aria-expanded={active} aria-controls={`fx-thread-${term.code}`} data-testid={`term-strip-${term.code}`} title={active ? "Collapse" : (term.hint ?? term.label)}>
        <span className={`fx-strip__dot s-${term.status}`} aria-hidden="true" />
        <span className="fx-strip__n">{term.sortOrder}</span>
        <span className="fx-strip__name">{term.label}</span>
        {isNew && <span className="fx-new" data-testid={`term-new-${term.code}`} title="Changed since your last visit">new</span>}
        {holderLabel && (
          <span className={`fx-hold ${holderCls}`} data-testid={`term-holder-${term.code}`} title={term.holder && term.holder !== mySide ? `With the ${term.holder} side · ${presence[term.holder].label}` : holderLabel}>
            {(holderCls === "cargo" || holderCls === "vessel") && <span className={`fx-hdot st-${presence[holderCls].state}`} aria-hidden="true" />}{holderLabel}
          </span>
        )}
        <span className={`fx-strip__nego${agreed ? " is-locked" : ""}`}>
          <span className={`fx-side cargo${term.holder === "cargo" && !agreed ? " is-turn" : ""}${term.cargoPosition?.isFinal ? " is-close" : ""}`} title="Cargo side"><Gloss text={cargoDisp} /></span>
          <span className="fx-arrow" aria-hidden="true">{agreed ? "≡" : "⟷"}</span>
          <span className={`fx-side vessel${term.holder === "vessel" && !agreed ? " is-turn" : ""}${term.vesselPosition?.isFinal ? " is-close" : ""}`} title="Vessel side"><Gloss text={vesselDisp} /></span>
        </span>
        <span className={`fx-strip__spread${aligned ? " is-aligned" : ""}`}>{agreed ? "agreed" : spread ?? "—"}</span>
        {!agreed && gap > 0 && <span className="fx-gap" aria-hidden="true"><span className="fx-gap__fill" style={{ width: `${gap}%` }} /></span>}
        {tickingLeft != null && tickingLeft > 0 && <span className={`fx-strip__timer${tickingLeft < 60_000 ? " is-urgent" : ""}`}>{countdown(ticking!.expiresAt, now)}</span>}
        {term.round > 0 && !agreed && <span className="fx-strip__round">R{term.round}</span>}
        <span className={`fx-strip__chev${active ? " is-open" : ""}`} aria-hidden="true">▸</span>
      </button>

      {active && (
        <div className="fx-thread" id={`fx-thread-${term.code}`} data-testid={`term-thread-${term.code}`}>
          {/* presence + validity ring */}
          <div className="fx-pres">
            <span className={`fx-pchip cargo st-${presence.cargo.state}`} title="Cargo side"><span className="fx-pdot" aria-hidden="true" /> Cargo <em>{presence.cargo.label}</em></span>
            {ringPct != null && live ? (
              <span className="fx-ring" title="Validity of the figure awaiting your answer">
                <svg viewBox="0 0 36 36" aria-hidden="true">
                  <circle className="fx-ring__bg" cx="18" cy="18" r="16" pathLength="100" />
                  <circle className={`fx-ring__fg${ringPct < 10 ? " is-urgent" : ""}`} cx="18" cy="18" r="16" pathLength="100" style={{ strokeDashoffset: 100 - ringPct }} />
                </svg>
                <span className={`fx-ring__t${ringPct < 10 ? " is-urgent" : ""}`}>{countdown(live.expiresAt, now)}</span>
              </span>
            ) : (
              <span className="fx-pres__mid">{agreed ? "agreed · final" : term.heldByLabel ? "on hold" : term.referredAt ? "referred to principal" : holderLabel ?? ""}</span>
            )}
            <span className={`fx-pchip vessel st-${presence.vessel.state}`} title="Vessel side"><span className="fx-pdot" aria-hidden="true" /> Vessel <em>{presence.vessel.label}</em></span>
          </div>

          {term.hint && <div className="fx-hint2"><Gloss text={term.hint} /></div>}

          {/* the thread · Cargo left · broker centre · Vessel right */}
          {thread.length > 0 && (
            <div className="fx-chat" aria-label="Bid and offer history" ref={(node) => { if (node) node.scrollTop = node.scrollHeight; }}>
              {thread.map((h) => (
                <div className={`fx-msg lane-${h.lane}`} key={h.key}>
                  <div className="fx-bubble">
                    <div className="fx-bubble__top"><span className="fx-bubble__who">{h.who}</span><span className={`fx-bubble__tag k-${h.kind}`}>{h.tag}</span><span className="fx-bubble__t">{relativeTime(h.at, now)}</span></div>
                    <div className="fx-bubble__val"><Gloss text={h.value} /></div>
                    {h.comment ? <div className="fx-bubble__cmt">{h.comment}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          {agreed ? (
            <div className="fx-locked-note">
              <span><IcLock /> Agreed · {term.agreed?.displayValue} · accepted by {term.agreedByLabel ?? "—"}</span>
              {caps.canReopen && (
                <button type="button" className="fx-link" disabled={busy} data-testid={`reopen-${term.code}`}
                  onClick={() => { const reason = window.prompt("Why reopen this term? (optional)") ?? ""; void run("reopen", (base) => ({ ...base, ...commonBase, termId: term.id, reason: reason || null })); }}>
                  Flag re-open
                </button>
              )}
            </div>
          ) : canWork ? (
            <div className="fx-composer" data-testid={`composer-${term.code}`}>
              {own && ownLapsed && lapseDismissed !== own.id && (
                <div className="fx-lapse">
                  <span className="fx-lapse__txt"><IcAlert /> Your {own.kind} {own.displayValue} lapsed · the {otherSide} side did not answer in time</span>
                  <button type="button" className="fx-lapse__btn" disabled={busy} onClick={() => submit({ value: own.value, expiresInMinutes: 12 })}>Re-send · fresh 12:00</button>
                  <button type="button" className="fx-link" onClick={() => setLapseDismissed(own.id)}>Dismiss</button>
                </div>
              )}
              {live && !liveLapsed && mySide && term.holder === mySide ? (
                <div className="fx-lead2">
                  <IcLock /> {sideNoun(otherSide!)} {live.kind} <b><Gloss text={live.displayValue} /></b> is with you
                  {caps.canAccept && (
                    <button type="button" className="asb-btn primary fx-send" style={{ marginLeft: "auto" }} disabled={busy} data-testid={`accept-${term.code}`}
                      onClick={() => run("accept", (base) => ({ ...base, ...commonBase, proposalId: live.id }))}>
                      Accept {live.displayValue}
                    </button>
                  )}
                </div>
              ) : live && liveLapsed ? (
                <div className="fx-lead2"><IcAlert /> The {otherSide} side&apos;s {live.kind} <b>{live.displayValue}</b> lapsed · ask for a fresh one or send yours</div>
              ) : own && !ownLapsed && otherSide && term.holder === otherSide ? (
                <div className="fx-outbound">
                  Your {own.kind} <b>{own.displayValue}</b> is with the {otherSide} side{own.expiresAt ? <> · <span className="fx-out__t">{countdown(own.expiresAt, now)}</span> left</> : null}
                  {caps.canWithdrawProposal && <button type="button" className="fx-link" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => run("withdraw", (base) => ({ ...base, ...commonBase, proposalId: own.id }))}>Withdraw</button>}
                </div>
              ) : null}

              <div className="fx-fields"><ValueFields kind={term.valueKind} fields={fields} setField={setField} /></div>
              <div className="fx-send2">
                <input className="asb-input fx-amend2" id={`fx-${term.code}-comment`} aria-label="Comment" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} placeholder="comment, optional" />
                <button type="button" className="asb-btn primary fx-send" disabled={busy || !preview} onClick={() => submit()} data-testid={`submit-${term.code}`}>
                  {mySide === "cargo" ? "Send bid" : "Send offer"}{preview ? ` · ${preview}` : ""}
                </button>
              </div>
              <div className="fx-acts2">
                {listingFigure && <button type="button" className="fx-chip2" onClick={() => setFields(valueToFields(term.valueKind, listingFigure))}>Use listing figure</button>}
                {live && !liveLapsed && <button type="button" className="fx-chip2" onClick={() => setFields(valueToFields(term.valueKind, live.value))}>Match their figure</button>}
                {caps.canMessage && otherSide && term.holder === otherSide && (
                  <button type="button" className="fx-chip2" disabled={busy} data-testid={`nudge-${term.code}`} title={`Ask the ${otherSide} side to answer on ${term.label.toLowerCase()}`}
                    onClick={() => run("message", (b) => ({ ...b, body: `Awaiting your answer on ${term.label.toLowerCase()}.`, kind: "nudge", visibility: "room", termId: term.id }))}>↑ Nudge {sideNoun(otherSide)}</button>
                )}
                <span className="fx-acts2__sep" />
                <label className="fx-field is-check"><input id={`fx-${term.code}-final`} type="checkbox" checked={isFinal} onChange={(e) => setIsFinal(e.target.checked)} /><span>Final position</span></label>
                <label className="fx-field is-check" htmlFor={`fx-${term.code}-validity`}><span>Valid for</span>
                  <select id={`fx-${term.code}-validity`} value={validity} onChange={(e) => setValidity(e.target.value)}>
                    <option value="">no limit</option>
                    <option value="12">12 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="120">2 hours</option>
                    <option value="1440">24 hours</option>
                  </select>
                </label>
                {caps.canFlagTerm && (
                  <>
                    <span className="fx-acts2__sep" />
                    <button type="button" className="fx-link" disabled={busy} onClick={() => run("flag", (base) => ({ ...base, ...commonBase, termId: term.id, flag: term.heldByLabel ? "resume" : "hold" }))}>{term.heldByLabel ? "Resume" : "Hold"}</button>
                    <button type="button" className="fx-link" disabled={busy} onClick={() => run("flag", (base) => ({ ...base, ...commonBase, termId: term.id, flag: term.referredAt ? "clear_referral" : "refer" }))}>{term.referredAt ? "Clear referral" : "Refer"}</button>
                  </>
                )}
                {err && <span className="fx-error" role="alert">{err}</span>}
              </div>
              {term.referredAt && <div className="fx-offnote refer">Referred to principal{term.referredByLabel ? ` by ${term.referredByLabel}` : ""} · awaiting a decision before this item moves.</div>}
              <div className="fx-final">
                <span className="fx-final__lbl">Final positions</span>
                <span className={`fx-flag${term.cargoPosition?.isFinal ? " is-on" : ""}`} title={term.cargoPosition?.isFinal ? "The cargo side marked its figure final" : "Cargo side has not marked a final figure"}>{term.cargoPosition?.isFinal ? "✓ Cargo final" : "Cargo open"}</span>
                <span className={`fx-flag${term.vesselPosition?.isFinal ? " is-on" : ""}`} title={term.vesselPosition?.isFinal ? "The vessel side marked its figure final" : "Vessel side has not marked a final figure"}>{term.vesselPosition?.isFinal ? "✓ Vessel final" : "Vessel open"}</span>
              </div>
            </div>
          ) : view.viewer.isMediator && !mySide && (view.room.status === "invited" || view.room.status === "negotiating") ? (
            // the mediator's console (design: broker seat): press either side, acknowledge the
            // standing figure, hold or refer; relaying a figure for a relayed party goes through
            // "Acting for" in the header, which turns this into that party's composer
            <div className="fx-composer" data-testid={`mediator-${term.code}`}>
              <div className="fx-lead2">
                <IcLock /> {term.holder ? `With the ${term.holder} side · ${presence[term.holder].label}` : "No figure on the table yet"}
                {standing && <> · standing <b><Gloss text={standing.displayValue} /></b></>}
              </div>
              <div className="fx-acts2">
                {caps.canMessage && (["cargo", "vessel"] as const).map((s) => (
                  <button key={s} type="button" className="fx-chip2" disabled={busy} data-testid={`press-${s}-${term.code}`} title={`Ask the ${s} side to improve or answer`}
                    onClick={() => run("message", (b) => ({ ...b, body: `Arab ShipBroker asks the ${s} side to improve or answer on ${term.label.toLowerCase()}.`, kind: "nudge", visibility: "room", termId: term.id }))}>↑ Press {sideNoun(s)}</button>
                ))}
                {caps.canMessage && standing && (
                  <button type="button" className="fx-chip2" disabled={busy} data-testid={`ack-${term.code}`} title="Acknowledge the standing figure to the side that sent it"
                    onClick={() => run("message", (b) => ({ ...b, body: `Received ${standing.displayValue} on ${term.label.toLowerCase()}.`, kind: "ack", visibility: "room", termId: term.id }))}>Acknowledge {standing.displayValue}</button>
                )}
                {caps.canFlagTerm && (
                  <>
                    <span className="fx-acts2__sep" />
                    <button type="button" className="fx-link" disabled={busy} onClick={() => run("flag", (base) => ({ ...base, ...commonBase, termId: term.id, flag: term.heldByLabel ? "resume" : "hold" }))}>{term.heldByLabel ? "Resume" : "Hold"}</button>
                    <button type="button" className="fx-link" disabled={busy} onClick={() => run("flag", (base) => ({ ...base, ...commonBase, termId: term.id, flag: term.referredAt ? "clear_referral" : "refer" }))}>{term.referredAt ? "Clear referral" : "Refer"}</button>
                  </>
                )}
              </div>
              {caps.actForPartyIds.length > 0 && <div className="fx-offnote">To relay a figure for a party that is off-platform, choose it under “Acting for” in the header.</div>}
              {term.referredAt && <div className="fx-offnote refer">Referred to principal{term.referredByLabel ? ` by ${term.referredByLabel}` : ""} · awaiting a decision before this item moves.</div>}
            </div>
          ) : (
            <div className="fx-hint2">{view.room.status === "invited" || view.room.status === "negotiating" ? "Waiting for the other side." : "This term is closed for negotiation."}</div>
          )}
        </div>
      )}
    </div>
  );
}
