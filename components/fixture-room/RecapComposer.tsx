"use client";

// The design's recap composer (nrx): Email / WhatsApp tabs, recipients,
// subject and body, masking note. Delivery is not wired in v1 (frozen decision
// D7; Phase 1.1 decision D-2): the recap is copied or downloaded here and sent
// by the ASB desk until the notification module's outbox exists. The body is
// the published recap version when there is one, otherwise the deal summary;
// both come from the masked read model, so nothing here can reveal more than
// the room does.
import * as React from "react";
import type { FixtureRoomView } from "@/lib/fixture-room/types";
import { buildDealSummary, downloadText } from "@/lib/fixture-room/summary";
import { IcMail, IcWhatsapp } from "./icons";

export function RecapComposer({ view, onClose }: { view: FixtureRoomView; onClose: () => void }) {
  const { room, snapshot } = view;
  const latest = view.recaps.find((r) => !r.invalidatedAt) ?? null;
  const counterparty = view.parties.find((p) => p.capacity === "principal" && !p.isViewer && (p.side === "cargo" || p.side === "vessel")) ?? null;
  const disclosed = room.counterpartyDisclosed;
  const [channel, setChannel] = React.useState<"email" | "whatsapp">("email");
  const [to, setTo] = React.useState(disclosed && counterparty?.name ? `${counterparty.name} (via the ASB desk)` : `${counterparty?.label ?? "Counterparty"} (relayed via ASB)`);
  const [cc, setCc] = React.useState("");
  const [subject, setSubject] = React.useState(`Recap · ${String(snapshot.cargo.commodity_name ?? "Cargo")} / ${String(snapshot.vessel.vessel.vessel_name ?? "TBN")} · ${room.ref}`);
  const [body, setBody] = React.useState(() => latest?.contentText ?? buildDealSummary(view));
  const [copied, setCopied] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

  // The room re-renders every second (its clocks), and a parent may pass a fresh
  // onClose each time. The dialog's focus handling therefore runs once per
  // opening, never per render (C2O-012 item 1): it reads the latest onClose
  // through a ref, focuses the first control once, keeps Tab inside the dialog,
  // and hands focus back to the control that opened it.
  const closeRef = React.useRef(onClose);
  React.useEffect(() => { closeRef.current = onClose; });
  React.useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") ?? [])
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== "Tab" || !dialog) return;
      const els = focusables();
      if (els.length === 0) { e.preventDefault(); return; }
      const first = els[0], last = els[els.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !dialog.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    focusables()[0]?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const text = channel === "email" ? `To: ${to}\n${cc ? `Cc: ${cc}\n` : ""}Subject: ${subject}\n\n${body}` : body;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: download instead */ }
  };

  return (
    <div className="nrx-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="recap-scrim">
      <div className="nrx" role="dialog" aria-modal="true" aria-label="Send recap" ref={dialogRef} data-testid="recap-composer">
        <div className="nrx__hd">
          <div>
            <div className="nrx__title">Send recap</div>
            <div className="nrx__sub">{latest ? `Recap v${latest.versionNo} · ${latest.acknowledgedByAllPrincipals ? "acknowledged by both principals" : "awaiting acknowledgement"}` : "No recap published yet · this is the current deal summary"}</div>
          </div>
          <button type="button" className="nrx__x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="nrx__chan" role="tablist" aria-label="Delivery channel">
          <button type="button" role="tab" aria-selected={channel === "email"} className={channel === "email" ? "is-on" : ""} onClick={() => setChannel("email")}><IcMail /> Email</button>
          <button type="button" role="tab" aria-selected={channel === "whatsapp"} className={`wa${channel === "whatsapp" ? " is-on" : ""}`} onClick={() => setChannel("whatsapp")}><IcWhatsapp /> WhatsApp</button>
        </div>
        <div className="nrx__body">
          {channel === "email" ? (
            <>
              <div className="nrx__grid">
                <div className="nrx__field"><label htmlFor="nrx-to">To</label><input id="nrx-to" className="asb-input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
                <div className="nrx__field"><label htmlFor="nrx-cc">Cc</label><input id="nrx-cc" className="asb-input" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="your desk, optional" /></div>
              </div>
              <div className="nrx__field"><label htmlFor="nrx-subject">Subject</label><input id="nrx-subject" className="asb-input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            </>
          ) : null}
          <div className="nrx__field"><label htmlFor="nrx-body">{channel === "email" ? "Recap" : "Message"}</label><textarea id="nrx-body" className="nrx__ta" rows={11} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          {channel === "whatsapp" && <div className="nrx__wa"><IcWhatsapp /> Delivered from the ASB business line once the notification module is live.</div>}
        </div>
        <div className="nrx__ft">
          <span className="nrx__note">{disclosed ? "Counterparty released · the ASB desk sends it on." : "Counterparty masked · the ASB desk relays this recap."} Direct sending arrives with notifications.</span>
          <div className="nrx__actions">
            <button type="button" className="asb-btn" onClick={() => downloadText(`Fixture-${room.ref}-${latest ? `recap-v${latest.versionNo}` : "summary"}.txt`, text)}>Download</button>
            <button type="button" className="asb-btn primary" onClick={copy} data-testid="recap-copy">{copied ? "Copied ✓" : "Copy recap"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
