"use client";

// Market Partner panel — slide-in profile shown when a "via <Partner>" tag is
// clicked (ported from asb/market-partner.jsx). Opens via a window event so any
// card can trigger it; visible to Subscriber+ tiers.
import * as React from "react";
import { createPortal } from "react-dom";
import { useViewerTier, isLimitedTier } from "@/lib/portal/tier";

interface Partner { slug: string; name: string; memberSince: string; zones: string[]; blurb: string }
const PARTNERS: Record<string, Partner> = {
  navigrains: { slug: "navigrains", name: "Navigrains", memberSince: "May 2025", zones: ["B.SEA", "E.MED", "R.SEA"], blurb: "Grain & dry-bulk specialist across the Black Sea and East Med." },
  satirbroke: { slug: "satirbroke", name: "Satirbroke", memberSince: "Feb 2025", zones: ["E.MED", "R.SEA", "AG"], blurb: "Break-bulk and project cargo broker, Eastern Mediterranean to the Gulf." },
  medshipping: { slug: "medshipping", name: "Mediterranean Shipping Services", memberSince: "Mar 2024", zones: ["E.MED", "B.SEA"], blurb: "Full-service shipbroking house, Mediterranean & Black Sea." },
  gulfsea: { slug: "gulfsea", name: "Gulf Sea Brokers", memberSince: "Aug 2024", zones: ["AG", "A.SEA", "R.SEA"], blurb: "Arabian Gulf tonnage and cargo desk." },
};

export function openMarketPartner(slug: string) {
  window.dispatchEvent(new CustomEvent("asb:open-partner", { detail: slug }));
}

export function MarketPartnerHost() {
  const [slug, setSlug] = React.useState<string | null>(null);
  React.useEffect(() => {
    const h = (e: Event) => setSlug((e as CustomEvent).detail as string);
    window.addEventListener("asb:open-partner", h);
    return () => window.removeEventListener("asb:open-partner", h);
  }, []);
  if (!slug || typeof document === "undefined") return null;
  const p = PARTNERS[slug] || { slug, name: slug, memberSince: "—", zones: [], blurb: "Market partner on Arab ShipBroker." };
  return createPortal(
    <div className="mp-backdrop" onMouseDown={() => setSlug(null)}>
      <div className="mp-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mp-panel__head">
          <div className="mp-panel__avatar">{p.name.slice(0, 1)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mp-panel__name">{p.name}</div>
            <div className="mp-panel__since">Market Partner · since {p.memberSince}</div>
          </div>
          <button className="mp-panel__close" onClick={() => setSlug(null)}>✕</button>
        </div>
        <div className="mp-panel__body">
          <p className="mp-panel__blurb">{p.blurb}</p>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Operating zones</div>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            {p.zones.map((z) => <span key={z} className="asb-badge blue">{z}</span>)}
          </div>
          <div className="mp-panel__note">🔒 Verified partner. Contact details are exchanged once both parties opt in.</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Inline "via <Partner>" tag for cards — hidden for limited tiers.
export function MarketPartnerTag({ slug }: { slug?: string | null }) {
  const tier = useViewerTier();
  if (!slug) return null;
  if (isLimitedTier(tier)) {
    return <span className="mp-tag mp-tag--locked" title="Partner identity available to Subscriber tier">🔒 Partner</span>;
  }
  const p = PARTNERS[slug];
  return (
    <button className="mp-tag" onClick={(e) => { e.stopPropagation(); openMarketPartner(slug); }}>
      via <b>{p?.name ?? slug}</b>
    </button>
  );
}
