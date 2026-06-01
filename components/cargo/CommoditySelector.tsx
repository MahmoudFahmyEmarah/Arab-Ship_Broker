"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Package, Loader2, ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { CommodityOption } from "@/lib/schemas/cargo";
import { searchCommodities } from "@/sdk/app/commodities";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

interface CommoditySelectorProps {
  selected: CommodityOption | null;
  onChange: (commodity: CommodityOption) => void;
  error?: string;
}

const IMSBC_LABELS: Record<string, string> = {
  Cat_A: "Group A",
  Cat_B: "Group B",
  Cat_C: "Group C",
  DG: "Dangerous Goods",
  Non_DG: "Non-DG",
};

export function CommoditySelector({
  selected,
  onChange,
  error,
}: CommoditySelectorProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommodityOption[]>([]);
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
      const commodities = await searchCommodities(supabase, q);
      setResults(commodities);
    } catch {
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (commodity: CommodityOption) => {
    onChange(commodity);
    setQuery("");
    setIsOpen(false);
    setResults([]);
  };

  return (
    <div ref={containerRef} className="space-y-1.5">
      <label className="text-sm font-semibold text-slate-700">Commodity</label>

      {selected ? (
        <div className="space-y-3">
          {/* Selected commodity card */}
          <div className="flex items-start justify-between p-3 rounded-xl border border-ocean-200 bg-ocean-50">
            <div className="flex items-start gap-2.5">
              <Package className="w-4 h-4 text-ocean-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {selected.canonical_name}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <span className="text-xs font-bold bg-white text-ocean-700 px-2 py-0.5 rounded-md border border-ocean-200">
                    {selected.cargo_type}
                  </span>
                  <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                    IMSBC {IMSBC_LABELS[selected.imsbc_category]}
                  </span>
                  {selected.is_dg && (
                    <span className="text-xs font-bold bg-red-50 text-red-600 px-2 py-0.5 rounded-md border border-red-200">
                      Dangerous Goods
                    </span>
                  )}
                  {selected.is_grain && (
                    <span className="text-xs font-bold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md border border-amber-200">
                      Grain — cert. required
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-white transition-colors"
              title="Change commodity"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Derived fields banner */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-500 space-y-1">
            <p className="font-semibold text-slate-700 text-xs uppercase tracking-wide mb-1">
              Auto-set from commodity
            </p>
            <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-x-4 gap-y-1">
              <span>
                Cargo type:{" "}
                <strong className="text-slate-700">
                  {selected.cargo_type}
                </strong>
              </span>
              <span>
                IMSBC:{" "}
                <strong className="text-slate-700">
                  {selected.imsbc_category}
                </strong>
              </span>
              <span>
                DG cargo:{" "}
                <strong className="text-slate-700">
                  {selected.is_dg ? "Yes" : "No"}
                </strong>
              </span>
              <span>
                Grain cargo:{" "}
                <strong className="text-slate-700">
                  {selected.is_grain ? "Yes" : "No"}
                </strong>
              </span>
              {selected.default_sf_m3t && (
                <span>
                  Default SF:{" "}
                  <strong className="text-slate-700">
                    {selected.default_sf_m3t} m³/t
                  </strong>
                </span>
              )}
            </div>
          </div>

          {/* Change search */}
          {isOpen && (
            <SearchInput
              inputRef={inputRef}
              query={query}
              setQuery={setQuery}
              results={results}
              isLoading={isLoading}
              onSelect={handleSelect}
              placeholder="Search to change commodity…"
              isOpen={isOpen}
              onFocus={() => setIsOpen(true)}
            />
          )}
        </div>
      ) : (
        /* Search input (empty state) */
        <SearchInput
          inputRef={inputRef}
          query={query}
          setQuery={(q) => {
            setQuery(q);
            setIsOpen(true);
          }}
          results={results}
          isLoading={isLoading}
          onSelect={handleSelect}
          placeholder="Search commodity (e.g. Grain, Phosphate, Steel…)"
          error={error}
          isOpen={isOpen}
          onFocus={() => setIsOpen(true)}
        />
      )}

      {!selected && error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

interface SearchInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  setQuery: (q: string) => void;
  results: CommodityOption[];
  isLoading: boolean;
  onSelect: (c: CommodityOption) => void;
  placeholder?: string;
  error?: string;
  isOpen?: boolean;
  onFocus?: () => void;
}

function SearchInput({
  inputRef,
  query,
  setQuery,
  results,
  isLoading,
  onSelect,
  placeholder,
  error,
  isOpen,
  onFocus,
}: SearchInputProps) {
  return (
    <div className="relative">
      <div
        className={cn(
          "flex items-center gap-2 px-3 h-11 rounded-xl border border-slate-200 bg-slate-50 focus-within:bg-white focus-within:border-ocean-500 focus-within:ring-2 focus-within:ring-ocean-500/20 transition-all",
          error && "border-red-300",
        )}
      >
        <Package className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          ref={inputRef}
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
          {results.map((c) => (
            <li
              key={c.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(c)}
              className="flex items-center justify-between px-3 py-2.5 hover:bg-ocean-50 cursor-pointer transition-colors border-b border-slate-50 last:border-0"
            >
              <div className="flex items-center gap-2.5">
                <Package className="w-3.5 h-3.5 text-ocean-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {c.canonical_name}
                  </p>
                  <p className="text-xs text-slate-500">{c.cargo_type}</p>
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <span className="text-xs font-medium bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                  {c.imsbc_category}
                </span>
                {c.is_dg && (
                  <span className="text-xs font-medium bg-red-50 text-red-600 px-1.5 py-0.5 rounded">
                    DG
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {isOpen && query.length >= 2 && !isLoading && results.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3">
          <p className="text-sm text-slate-500">
            No commodities found for &quot;{query}&quot;
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Contact support to add a new commodity to the system.
          </p>
        </div>
      )}
    </div>
  );
}
