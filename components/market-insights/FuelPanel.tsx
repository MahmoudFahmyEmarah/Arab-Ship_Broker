import Link from "next/link";
import { Lock, Fuel, ArrowRight } from "lucide-react";
import { FUEL_COST } from "@/lib/market-insights";

const money = (v: number) => `$${v.toLocaleString("en-US")}`;

// ── MEMBER panel: the real Handysize fuel-cost estimate (figures present) ──
// Server-rendered. Only mounted for authenticated member sessions, so these
// numbers never reach an anonymous client (the firewall, Pre_Final §11).
export function FuelPanelMember() {
  const F = FUEL_COST;
  const max = Math.max(...F.tiers.map((t) => t.stress)) * 1.06;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
      {/* Header: title + amber estimate chip */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-2">
          <Fuel className="w-4 h-4 text-ocean-600" />
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
            Handysize daily fuel cost · by age &amp; Hormuz scenario
          </span>
        </div>
        <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-300/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">
          {F.estimateLabel}
        </span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 mb-5 text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-ocean-500" />
          Normal · ${F.scenarios.normal.price.toLocaleString("en-US")}/t
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: "#B5731A" }} />
          Hormuz-stress · ${F.scenarios.stress.price.toLocaleString("en-US")}/t
        </span>
      </div>

      {/* Grouped column chart: 4 tiers × 2 scenarios */}
      <div className="grid grid-cols-4 max-sm:grid-cols-2 gap-4">
        {F.tiers.map((t) => (
          <div key={t.label} className="flex flex-col items-center">
            <div className="flex items-end justify-center gap-2 h-44 w-full">
              {([
                { v: t.normal, cls: "bg-ocean-500", key: "n" },
                { v: t.stress, cls: "", key: "s", style: { background: "#B5731A" } },
              ] as const).map((b) => (
                <div key={b.key} className="flex flex-col items-center justify-end h-full flex-1 max-w-[44px]">
                  <span className="text-[11px] font-bold text-ocean-900 tabular-nums mb-1">
                    {money(b.v)}
                  </span>
                  <div
                    className={`mi-fuel-bar w-full rounded-t-md ${b.cls}`}
                    style={{ height: `${(b.v / max) * 100}%`, ...(("style" in b && b.style) || {}) }}
                  />
                </div>
              ))}
            </div>
            <span className="mt-2 text-[12px] font-semibold text-ocean-950 text-center leading-tight">
              {t.label}
            </span>
            <span className="text-[11px] text-slate-400 tabular-nums">{t.cons} t/day sea</span>
          </div>
        ))}
      </div>

      {/* Port line */}
      <p className="mt-5 text-[13px] text-slate-600">
        Port (working cargo, ~{F.port.cons}):{" "}
        <strong className="tabular-nums text-ocean-900">{money(F.port.normal)}/day</strong> normal ·{" "}
        <strong className="tabular-nums text-ocean-900">{money(F.port.stress)}/day</strong> Hormuz-stress
      </p>

      {/* Basis line */}
      <p className="mt-1.5 text-[11px] text-slate-400">{F.basis}</p>

      {/* Pure-CSS grow-from-zero on load (no JS); reduced-motion safe. */}
      <style>{`
        .mi-fuel-bar { transform-origin: bottom; animation: mi-fuel-grow .7s cubic-bezier(.22,1,.36,1) both; }
        @keyframes mi-fuel-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
        @media (prefers-reduced-motion: reduce) { .mi-fuel-bar { animation: none; } }
      `}</style>
    </div>
  );
}

// ── PUBLIC teaser (Pre_Final §11): a BLURRED grouped bar chart behind a lock.
// The bar heights are DECOY values hardcoded here — deliberately NOT derived
// from the real member figures (FUEL_COST), and there are ZERO numbers in the
// DOM (no daily costs, no $/t prices). Tier labels stay readable so the shape
// of the product is visible; the values are not.
const TEASER_DECOY: { tier: string; normal: number; stress: number }[] = [
  { tier: "Modern (5yr)", normal: 52, stress: 71 },
  { tier: "10-year", normal: 58, stress: 78 },
  { tier: "15-year", normal: 64, stress: 86 },
  { tier: "20-year+", normal: 70, stress: 95 },
];

export function FuelTeaserPublic() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-white p-5 mb-6">
      {/* Blurred decoy chart (purely decorative, no numbers) */}
      <div aria-hidden className="select-none blur-[5px] opacity-70 pointer-events-none">
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 mb-4">
          Handysize daily fuel cost · by age &amp; scenario
        </div>
        <div className="grid grid-cols-4 gap-4">
          {TEASER_DECOY.map((t) => (
            <div key={t.tier} className="flex flex-col items-center">
              <div className="flex items-end justify-center gap-2 h-28 w-full">
                <div className="flex-1 max-w-[40px] rounded-t-md bg-ocean-500" style={{ height: `${t.normal}%` }} />
                <div className="flex-1 max-w-[40px] rounded-t-md" style={{ height: `${t.stress}%`, background: "#B5731A" }} />
              </div>
              <span className="mt-2 text-[12px] font-semibold text-ocean-950 text-center leading-tight">{t.tier}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Soft radial overlay + lock + copy + CTA */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center text-center px-6"
        style={{ background: "radial-gradient(ellipse 70% 80% at 50% 50%, rgba(255,255,255,0.92) 40%, rgba(248,250,252,0.80) 100%)" }}
      >
        <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-ocean-950 text-white mb-3 shadow-md">
          <Lock className="w-5 h-5" />
        </span>
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <span className="text-[15px] font-semibold text-ocean-950">Handysize fuel-cost intelligence</span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-ocean-700 bg-ocean-50 border border-ocean-200 rounded-full px-2 py-0.5">
            Members only
          </span>
        </div>
        <p className="text-[13px] text-slate-500 mt-1.5 leading-relaxed max-w-md">
          Daily LSMGO burn by vessel age, modelled for Strait of Hormuz scenarios.
        </p>
        <Link
          href="/auth/signup"
          className="inline-flex items-center gap-2 h-10 px-5 mt-4 rounded-xl bg-ocean-950 text-white font-semibold text-sm hover:bg-ocean-900 transition-colors"
        >
          Get access <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
