"use client";

import Link from "next/link";
import {
  ShieldAlert,
  Package,
  MapPin,
  Calendar,
  ArrowRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  Globe,
} from "lucide-react";

import { CargoListingRow, ZoneCode, ZONE_LABELS } from "@/lib/schemas/cargo";
import { cn } from "@/lib/utils";

const ZONE_COLOUR: Partial<Record<ZoneCode, string>> = {
  "B.SEA": "bg-cyan-50    text-cyan-700   border-cyan-200",
  "E.MED": "bg-blue-50    text-blue-700   border-blue-200",
  "W.MED": "bg-blue-50    text-blue-700   border-blue-200",
  "C.MED": "bg-blue-50    text-blue-700   border-blue-200",
  ADRIATIC: "bg-indigo-50  text-indigo-700 border-indigo-200",
  "R.SEA": "bg-amber-50   text-amber-700  border-amber-200",
  AG: "bg-amber-50   text-amber-700  border-amber-200",
  "A.SEA": "bg-orange-50  text-orange-700 border-orange-200",
  WCAF: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ECAF: "bg-emerald-50 text-emerald-700 border-emerald-200",
  NCONT: "bg-violet-50  text-violet-700 border-violet-200",
  CARIB: "bg-teal-50    text-teal-700   border-teal-200",
  "F.EAST": "bg-rose-50    text-rose-700   border-rose-200",
  ECI: "bg-pink-50    text-pink-700   border-pink-200",
};

function ZonePill({
  zone,
  className,
}: {
  zone: string | null | undefined;
  className?: string;
}) {
  if (!zone || zone === "Unknown") return null;

  const colourCls =
    ZONE_COLOUR[zone as ZoneCode] ??
    "bg-slate-100 text-slate-600 border-slate-200";

  const label = ZONE_LABELS[zone as ZoneCode] ?? zone;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border uppercase tracking-wide shrink-0",
        colourCls,
        className,
      )}
      title={label}
    >
      <Globe className="w-2.5 h-2.5 opacity-60" />
      {zone}
    </span>
  );
}

export function CargoCard({ cargo }: { cargo: CargoListingRow }) {
  const isPending = cargo.review_status === "PENDING";
  const sameZone =
    cargo.load_zone && cargo.disch_zone && cargo.load_zone === cargo.disch_zone;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-ocean-200 transition-all flex flex-col overflow-hidden">
      <div className="p-5 pb-4 border-b border-slate-100">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <span className="bg-ocean-50 text-ocean-700 text-[10px] font-bold px-2 py-0.5 rounded-md uppercase border border-ocean-100">
                {cargo.cargo_type}
              </span>
              {cargo.is_dg_cargo && (
                <span className="bg-red-50 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 border border-red-100">
                  <ShieldAlert className="w-2.5 h-2.5" /> DG
                </span>
              )}
              {cargo.is_grain_cargo && (
                <span className="bg-amber-50 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-amber-100">
                  Grain
                </span>
              )}
              {cargo.is_spot && (
                <span className="bg-green-50 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-green-100">
                  SPOT
                </span>
              )}
              {isPending && (
                <span className="bg-slate-100 text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 border border-slate-200">
                  <Clock className="w-2.5 h-2.5" /> Under review
                </span>
              )}
            </div>

            <h3 className="text-sm font-bold text-slate-900 leading-snug">
              {cargo.commodity_name}
            </h3>
            {cargo.ref && (
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                {cargo.ref}
              </p>
            )}
          </div>

          <div className="shrink-0 pt-0.5">
            {cargo.review_status === "APPROVED" && (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            )}
            {cargo.review_status === "FLAGGED" && (
              <AlertCircle className="w-4 h-4 text-red-500" />
            )}
          </div>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-3 flex-1">
        <div className="flex items-start gap-2">
          <MapPin className="w-3.5 h-3.5 text-ocean-500 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">
              Route
            </p>
            <p className="text-xs font-semibold text-slate-900 leading-snug">
              <Link
                href={`/dashboard/ports/${cargo.load_port_locode}`}
                className="hover:underline"
              >
                {cargo.load_port_name}
              </Link>
              <span className="text-slate-400 mx-1.5">→</span>
              <Link
                href={`/dashboard/ports/${cargo.disch_port_locode}`}
                className="hover:underline"
              >
                {cargo.disch_port_name}
              </Link>
            </p>
            {(cargo.load_zone || cargo.disch_zone) && (
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <ZonePill zone={cargo.load_zone} />
                {cargo.disch_zone && !sameZone && (
                  <>
                    <span className="text-[9px] text-slate-300 font-bold">
                      →
                    </span>
                    <ZonePill zone={cargo.disch_zone} />
                  </>
                )}
                {sameZone && (
                  <span className="text-[10px] text-slate-400 italic">
                    same zone
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-start gap-2">
          <Package className="w-3.5 h-3.5 text-ocean-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">
              Quantity
            </p>
            <p className="text-xs font-semibold text-slate-900">
              {cargo.qty_min_mt.toLocaleString()}
              {cargo.qty_min_mt !== cargo.qty_max_mt && (
                <> – {cargo.qty_max_mt.toLocaleString()}</>
              )}{" "}
              MT
            </p>
            {cargo.stowage_factor && (
              <p className="text-[10px] text-slate-400 mt-0.5">
                SF {cargo.stowage_factor} m³/t
              </p>
            )}
          </div>
        </div>

        <div className="flex items-start gap-2">
          <Calendar className="w-3.5 h-3.5 text-ocean-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">
              Laycan
            </p>
            <p className="text-xs font-semibold text-slate-900">
              {cargo.is_spot
                ? "SPOT — any date"
                : `${cargo.laycan_from} – ${cargo.laycan_to}`}
            </p>
          </div>
        </div>

        {(cargo.load_terms || cargo.freight_idea_usd_mt) && (
          <div className="flex items-start gap-2">
            <span className="w-3.5 h-3.5 shrink-0 mt-0.5 flex items-center justify-center text-ocean-500 text-[11px] font-bold">
              $
            </span>
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">
                Commercial
              </p>
              {cargo.load_terms && (
                <p className="text-xs font-semibold text-slate-900">
                  {cargo.load_terms}
                </p>
              )}
              {cargo.freight_idea_usd_mt && (
                <p className="text-[10px] text-slate-400 mt-0.5">
                  ${cargo.freight_idea_usd_mt}/MT idea
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="bg-slate-50 px-5 py-3 border-t border-slate-100 flex justify-end">
        <Link
          href={`/dashboard/cargo/${cargo.id}`}
          className="flex items-center gap-2 text-sm font-bold text-white bg-ocean-600 hover:bg-ocean-700 px-4 py-2 rounded-xl transition-colors"
        >
          View details <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
