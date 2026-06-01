"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Ship,
  Loader2,
  ChevronDown,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VesselRow } from "@/lib/schemas/vessel";
import { searchVessels } from "@/sdk/app/vessels";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

interface VesselSearchProps {
  selected: VesselRow | null;
  onChange: (vessel: VesselRow) => void;
  error?: string;
}

const RISK_CONFIG = {
  CLEAR: { cls: "bg-green-50 text-green-700 border-green-200", label: "CLEAR" },
  LOW: { cls: "bg-green-50 text-green-700 border-green-200", label: "LOW" },
  MEDIUM: {
    cls: "bg-amber-50 text-amber-700 border-amber-200",
    label: "MEDIUM",
  },
  HIGH: { cls: "bg-red-50 text-red-700 border-red-200", label: "HIGH" },
};

const SCOPE_CONFIG: Record<VesselRow["scope"], string> = {
  "In Scope": "bg-green-50 text-green-700 border-green-200",
  Marginal: "bg-amber-50 text-amber-700 border-amber-200",
  "Out of Scope": "bg-slate-100 text-slate-600 border-slate-200",
};

export function VesselSearch({ selected, onChange, error }: VesselSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VesselRow[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setIsLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      setResults(await searchVessels(supabase, q));
    } catch {
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(query), 300);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      )
        setIsOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const handleSelect = (v: VesselRow) => {
    onChange(v);
    setQuery("");
    setIsOpen(false);
    setResults([]);
  };

  return (
    <div ref={containerRef} className="space-y-1.5">
      <label className="text-sm font-semibold text-slate-700">
        Find your vessel
      </label>

      {selected ? (
        <div className="space-y-3">
          <div className="p-4 rounded-xl border border-ocean-200 bg-ocean-50 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <Ship className="w-5 h-5 text-ocean-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {selected.vessel_name}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selected.vessel_type}
                    {selected.imo_number && ` · IMO ${selected.imo_number}`}
                    {selected.flag && ` · ${selected.flag}`}
                    {selected.build_year && ` · Built ${selected.build_year}`}
                  </p>
                </div>
              </div>
              <span
                className={cn(
                  "text-xs font-bold px-2 py-1 rounded-lg border shrink-0",
                  RISK_CONFIG[selected.risk_level].cls,
                )}
              >
                {selected.risk_level}
              </span>
            </div>

            <div className="grid grid-cols-4 max-[1024px]:grid-cols-2 gap-2 text-xs">
              <div className="bg-white rounded-lg px-2 py-1.5 border border-ocean-100">
                <p className="text-slate-400 uppercase font-semibold mb-0.5">
                  DWT
                </p>
                <p className="font-semibold text-slate-800">
                  {selected.dwt_grain?.toLocaleString() ?? "—"} MT
                </p>
              </div>
              <div className="bg-white rounded-lg px-2 py-1.5 border border-ocean-100">
                <p className="text-slate-400 uppercase font-semibold mb-0.5">
                  Geared
                </p>
                <p className="font-semibold text-slate-800">
                  {selected.is_geared === null
                    ? "—"
                    : selected.is_geared
                      ? "Yes"
                      : "No"}
                </p>
              </div>
              <div className="bg-white rounded-lg px-2 py-1.5 border border-ocean-100">
                <p className="text-slate-400 uppercase font-semibold mb-0.5">
                  Grain cert
                </p>
                <p className="font-semibold text-slate-800">
                  {selected.grain_certified === null
                    ? "—"
                    : selected.grain_certified
                      ? "Yes"
                      : "No"}
                </p>
              </div>
              <div
                className={cn(
                  "rounded-lg px-2 py-1.5 border",
                  SCOPE_CONFIG[selected.scope],
                )}
              >
                <p className="uppercase font-semibold mb-0.5 opacity-70">
                  Scope
                </p>
                <p className="font-semibold">{selected.scope}</p>
              </div>
            </div>

            {selected.risk_level === "HIGH" && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>
                  This vessel carries a HIGH risk rating. Your availability
                  posting will go to admin review regardless of your trust tier.
                  Review typically completes within 2 hours.
                </p>
              </div>
            )}

            {selected.vessel_review_status === "IN_REVIEW" && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-300 rounded-lg p-3 text-xs text-red-800">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <p>
                  This vessel is under Arab ShipBroker review and cannot have
                  new positions posted at this time. Please contact Arab
                  ShipBroker to resolve the review before posting positions.
                </p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setIsOpen(true);
              setTimeout(() => inputRef.current?.focus(), 50);
            }}
            className="text-xs text-ocean-600 hover:text-ocean-700 font-medium"
          >
            Search for a different vessel
          </button>

          {isOpen && (
            <SearchInput
              ref={inputRef}
              query={query}
              setQuery={setQuery}
              results={results}
              isLoading={isLoading}
              onSelect={handleSelect}
              isOpen={isOpen}
              placeholder="Search to change vessel…"
            />
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <SearchInput
            ref={inputRef}
            query={query}
            setQuery={(q) => {
              setQuery(q);
              setIsOpen(true);
            }}
            results={results}
            isLoading={isLoading}
            onSelect={handleSelect}
            isOpen={isOpen}
            onFocus={() => setIsOpen(true)}
            placeholder="Search by vessel name or IMO number…"
            error={error}
          />
          <p className="text-xs text-slate-400">
            Vessel not found?{" "}
            <Link
              href="/dashboard/vessels/register"
              className="text-ocean-600 font-semibold hover:text-ocean-700"
            >
              Register it now
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}

interface SearchInputProps {
  query: string;
  setQuery: (q: string) => void;
  results: VesselRow[];
  isLoading: boolean;
  onSelect: (v: VesselRow) => void;
  isOpen: boolean;
  onFocus?: () => void;
  placeholder?: string;
  error?: string;
  ref?: React.RefObject<HTMLInputElement | null>;
}

const SearchInput = ({
  query,
  setQuery,
  results,
  isLoading,
  onSelect,
  isOpen,
  onFocus,
  placeholder,
  error,
  ref,
}: SearchInputProps) => (
  <div className="relative">
    <div
      className={cn(
        "flex items-center gap-2 px-3 h-11 rounded-xl border bg-slate-50 focus-within:bg-white focus-within:border-ocean-500 focus-within:ring-2 focus-within:ring-ocean-500/20 transition-all",
        error ? "border-red-300" : "border-slate-200",
      )}
    >
      <Ship className="w-4 h-4 text-slate-400 shrink-0" />
      <input
        ref={ref}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
      />
      {isLoading ? (
        <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" />
      ) : (
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      )}
    </div>

    {isOpen && results.length > 0 && (
      <ul className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-72 max-[768px]:max-h-[50vh] overflow-y-auto">
        {results.map((v) => (
          <li
            key={v.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(v)}
            className="flex items-center justify-between px-4 py-3 hover:bg-ocean-50 cursor-pointer transition-colors border-b border-slate-50 last:border-0"
          >
            <div className="flex items-start gap-3">
              <Ship className="w-4 h-4 text-ocean-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {v.vessel_name}
                </p>
                <p className="text-xs text-slate-500">
                  {v.vessel_type}
                  {v.dwt_grain && ` · ${v.dwt_grain.toLocaleString()} DWT`}
                  {v.build_year && ` · ${v.build_year}`}
                </p>
              </div>
            </div>
            {/* FIXED: scope pill in dropdown now uses SCOPE_CONFIG */}
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={cn(
                  "text-xs font-semibold px-1.5 py-0.5 rounded border",
                  RISK_CONFIG[v.risk_level].cls,
                )}
              >
                {v.risk_level}
              </span>
              <span
                className={cn(
                  "text-xs font-semibold px-1.5 py-0.5 rounded border",
                  SCOPE_CONFIG[v.scope],
                )}
              >
                {v.scope}
              </span>
              {v.imo_number && (
                <span className="text-xs text-slate-400 font-mono">
                  {v.imo_number}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    )}

    {isOpen && query.length >= 2 && !isLoading && results.length === 0 && (
      <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-4 space-y-1">
        <div className="flex items-center gap-2 text-slate-500">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <p className="text-sm font-medium">
            No vessels found for &quot;{query}&quot;
          </p>
        </div>
        <p className="text-xs text-slate-400">
          The vessel may not be in our register yet, or it may be sanctioned. If
          it is yours and not sanctioned, register it from the vessels page.
        </p>
      </div>
    )}

    {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
  </div>
);
