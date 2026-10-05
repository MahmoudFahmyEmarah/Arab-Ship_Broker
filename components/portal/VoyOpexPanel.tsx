"use client";

// Voy OPEX — slide-over from the map right-bar. Tier-gated (locked for T1/T2 by
// the parent). It used to compute an "Estimated OPEX" from hard-coded fuel,
// KAP port-DA and flat Suez figures, and claimed a ticker sponsor price it never
// read (bunker = sea days × USD/MT, no consumption). At composition it became a
// launcher to the governed calculators, which carry provenance and status
// (architect ruling on C2O-041, B2O-011 R2). No figure is shown here.
import Link from "next/link";

const TOOLS: { href: string; title: string; note: string }[] = [
  { href: "/dashboard/voyage-estimator", title: "Voyage Estimator", note: "Legs, fuel from the bunker index, Suez transit, port costs and TCE, each with its source and status." },
  { href: "/dashboard/suez-toll", title: "Suez Canal toll", note: "Official SCA bands, SDR rate, fixed and conditional charges on the transit date." },
  { href: "/dashboard/ports-da", title: "Ports Cost Estimator", note: "Port disbursements from published tariffs; unpriced lines are listed, never guessed." },
];

export function VoyOpexPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="voy-panel open">
      <div className="voy-panel__inner">
        <div className="voy-panel__head">
          <span className="voy-panel__title">Voy OPEX</span>
          <button type="button" className="voy-panel__close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="voy-body">
          {TOOLS.map((t) => (
            <Link key={t.href} href={t.href} className="voy-line" onClick={onClose}>
              <span>
                <b>{t.title}</b>
                <span className="voy-note" style={{ display: "block" }}>{t.note}</span>
              </span>
              <b aria-hidden="true">→</b>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
