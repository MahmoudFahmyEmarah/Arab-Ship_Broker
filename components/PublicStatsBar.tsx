"use client";

import { useEffect, useState } from "react";
import { Package, Ship, Anchor, MapPin, Globe2, Building2 } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Totals = {
  cargo_live: number; vessels: number; open_positions: number;
  ports: number; zones: number; companies: number;
};

const nf = new Intl.NumberFormat("en-US");

// Compact public reach bar — REAL platform totals from get_public_platform_totals
// (aggregate-only anon RPC). Lets a visitor feel the platform is active without
// subscribing. Items with a zero count are hidden so it never reads as empty.
export function PublicStatsBar({
  variant = "light",
  className = "",
}: {
  variant?: "light" | "dark";
  className?: string;
}) {
  const [t, setT] = useState<Totals | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSupabaseBrowserClient()
      .rpc("get_public_platform_totals")
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setT(data as Totals);
      });
    return () => { cancelled = true; };
  }, []);

  if (!t) return null;

  const items: { icon: React.ElementType; value: number; label: string }[] = [
    { icon: Package, value: t.cargo_live, label: "Cargoes on the book" },
    { icon: Anchor, value: t.open_positions, label: "Open positions" },
    { icon: Ship, value: t.vessels, label: "Vessels tracked" },
    { icon: MapPin, value: t.ports, label: "Ports mapped" },
    { icon: Globe2, value: t.zones, label: "Trade zones" },
    { icon: Building2, value: t.companies, label: "Companies" },
  ].filter((i) => i.value > 0);

  if (items.length === 0) return null;

  const dark = variant === "dark";
  const wrap = dark
    ? "border-white/12 bg-white/[0.06] text-white"
    : "border-slate-200 bg-white text-ocean-950";
  const valueClr = dark ? "text-white" : "text-ocean-950";
  const labelClr = dark ? "text-ocean-100/70" : "text-slate-500";
  const iconClr = dark ? "text-foam-300" : "text-ocean-600";
  const divider = dark ? "bg-white/10" : "bg-slate-200";

  return (
    <div className={`rounded-2xl border ${wrap} ${className}`}>
      <div className="flex flex-wrap items-stretch justify-center gap-y-3 px-4 py-3.5">
        {items.map((i, idx) => (
          <div key={i.label} className="flex items-center">
            <div className="flex items-center gap-2.5 px-4 max-sm:px-3">
              <i.icon className={`w-4 h-4 shrink-0 ${iconClr}`} />
              <div className="flex flex-col leading-none">
                <span className={`text-lg max-sm:text-base font-bold tabular-nums tracking-tight ${valueClr}`}>
                  {nf.format(i.value)}
                </span>
                <span className={`text-[10.5px] font-medium ${labelClr}`}>{i.label}</span>
              </div>
            </div>
            {idx < items.length - 1 && (
              <span className={`hidden sm:block w-px self-center h-8 ${divider}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
