"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MapPin, Loader2, ChevronDown, X, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { PortOption, ZONE_CODES, ZONE_LABELS } from "@/lib/schemas/cargo";
import { searchPorts } from "@/sdk/app/ports";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

interface PortAutocompleteProps {
  label: string;
  selectedPort: PortOption | null;
  onChange: (locode: string, port: PortOption) => void;
  error?: string;
  placeholder?: string;
}

interface NewPortFormData {
  locode: string;
  trade_name: string;
  country: string;
  zone: string;
}

export function PortAutocomplete({
  label,
  selectedPort,
  onChange,
  error,
  placeholder = "Search port name…",
}: PortAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PortOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showNewPortForm, setShowNewPortForm] = useState(false);
  const [isSavingPort, setIsSavingPort] = useState(false);
  const [newPortData, setNewPortData] = useState<NewPortFormData>({
    locode: "",
    trade_name: "",
    country: "",
    zone: "",
  });
  const [newPortErrors, setNewPortErrors] = useState<Partial<NewPortFormData>>(
    {},
  );

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
      // Curated ports table answers first; the full UN/LOCODE reference (≈13.5k)
      // backstops it so any port is findable. Merge, de-duped by LOCODE.
      const [tableRes, refRes] = await Promise.all([
        searchPorts(supabase, q).catch(() => [] as PortOption[]),
        fetch(`/api/ports/search?q=${encodeURIComponent(q)}`)
          .then((r) => r.json())
          .then((d) => (d.results ?? []) as PortOption[])
          .catch(() => [] as PortOption[]),
      ]);
      const norm = (l: string) => l.replace(/\s+/g, "").toUpperCase();
      const seen = new Set(tableRes.map((p) => norm(p.locode)));
      const merged = [...tableRes, ...refRes.filter((p) => !seen.has(norm(p.locode)))];
      setResults(merged.slice(0, 12));
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
        setShowNewPortForm(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (port: PortOption) => {
    onChange(port.locode, port);
    setQuery("");
    setIsOpen(false);
    setResults([]);
  };

  const handleClear = () => {
    onChange("", {
      locode: "",
      trade_name: "",
      country: "",
      zone: "Unknown" as PortOption["zone"],
      port_type: "Sea Port",
    });
    setQuery("");
    setIsOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const validateNewPort = (): boolean => {
    const errors: Partial<NewPortFormData> = {};
    if (!newPortData.locode.trim()) errors.locode = "LOCODE is required";
    else if (!/^[A-Z]{2}\s?[A-Z0-9]{3}$/i.test(newPortData.locode.trim()))
      errors.locode = "Format: XX XXX (e.g. EG ALY)";
    if (!newPortData.trade_name.trim())
      errors.trade_name = "Port name is required";
    if (!newPortData.country.trim()) errors.country = "Country is required";
    if (!newPortData.zone) errors.zone = "Zone is required";
    setNewPortErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveNewPort = async () => {
    if (!validateNewPort()) return;

    setIsSavingPort(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const locode = newPortData.locode.trim().toUpperCase();

      const { error } = await supabase.from("ports").insert({
        locode,
        trade_name: newPortData.trade_name.trim(),
        country: newPortData.country.trim(),
        zone: newPortData.zone,
        port_type: "Sea Port",
        is_verified: false,
        is_active: true,
      });

      if (error) {
        if (error.code === "23505") {
          // Duplicate locode — fetch and use the existing port
          const { data: existing } = await supabase
            .from("ports")
            .select("locode, trade_name, country, zone, port_type")
            .eq("locode", locode)
            .single();

          if (existing) {
            handleSelect(existing as PortOption);
            setShowNewPortForm(false);
            setIsOpen(false);
            return;
          }
        }
        throw error;
      }

      const newPort: PortOption = {
        locode,
        trade_name: `${newPortData.trade_name.trim()} (pending verification)`,
        country: newPortData.country.trim(),
        zone: newPortData.zone as PortOption["zone"],
        port_type: "Sea Port",
      };

      handleSelect(newPort);
      setShowNewPortForm(false);
      setIsOpen(false);
    } catch (err) {
      console.error("Failed to save new port:", err);
    } finally {
      setIsSavingPort(false);
    }
  };

  const showAddOption =
    query.trim().length >= 2 && !isLoading && results.length === 0;

  return (
    <div ref={containerRef} className="space-y-1.5">
      <label className="text-sm font-semibold text-asb-ink-soft">{label}</label>

      {/* Selected port display */}
      {selectedPort?.locode && !isOpen ? (
        <div className="flex items-center justify-between p-3 rounded border border-asb-blue bg-asb-blue-light">
          <div className="flex items-center gap-2.5">
            <MapPin className="w-4 h-4 text-asb-blue shrink-0" />
            <div>
              <p className="text-sm font-semibold text-asb-navy">
                {selectedPort.trade_name}
              </p>
              <p className="text-xs text-asb-gray-500">
                {selectedPort.locode} · {selectedPort.country} ·{" "}
                {selectedPort.zone}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="text-asb-gray-400 hover:text-asb-gray-700 p-1 rounded-lg hover:bg-white transition-colors"
            title="Change port"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        /* Search input */
        <div className="relative">
          <div
            className={cn(
              "flex items-center gap-2 px-3 h-11 rounded border border-asb-gray-200 bg-asb-gray-50 focus-within:bg-white focus-within:border-asb-blue focus-within:ring-2 focus-within:ring-asb-blue/20 transition-all",
              error && "border-red-300",
            )}
          >
            <MapPin className="w-4 h-4 text-asb-gray-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIsOpen(true);
                setShowNewPortForm(false);
              }}
              onFocus={() => setIsOpen(true)}
              placeholder={placeholder}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-asb-gray-400"
            />
            {isLoading ? (
              <Loader2 className="w-4 h-4 text-asb-gray-400 animate-spin shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-asb-gray-400 shrink-0" />
            )}
          </div>

          {/* Dropdown results */}
          {isOpen && results.length > 0 && (
            <ul className="absolute z-50 w-full mt-1 bg-white border border-asb-gray-200 rounded shadow-lg overflow-hidden max-h-72 max-[768px]:max-h-[50vh] overflow-y-auto">
              {results.map((port) => (
                <li
                  key={port.locode}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(port)}
                  className="flex items-center justify-between px-3 py-2.5 hover:bg-asb-blue-light cursor-pointer transition-colors border-b border-asb-gray-100 last:border-0"
                >
                  <div className="flex items-center gap-2.5">
                    <MapPin className="w-3.5 h-3.5 text-asb-blue shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-asb-navy">
                        {port.trade_name}
                      </p>
                      <p className="text-xs text-asb-gray-500">
                        {port.locode} · {port.country}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-medium bg-asb-gray-100 text-asb-gray-700 px-1.5 py-0.5 rounded shrink-0">
                    {port.zone}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* No results + Add new port option */}
          {isOpen && showAddOption && !showNewPortForm && (
            <div className="absolute z-50 w-full mt-1 bg-white border border-asb-gray-200 rounded shadow-lg">
              <p className="text-sm text-asb-gray-500 px-4 pt-3">
                No ports found for &quot;{query}&quot;
              </p>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setShowNewPortForm(true);
                  setNewPortData((p) => ({ ...p, trade_name: query.trim() }));
                }}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-asb-blue hover:bg-asb-blue-light transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add &quot;{query}&quot; as a new port
              </button>
            </div>
          )}
        </div>
      )}

      {/* New port form */}
      {showNewPortForm && (
        <div className="mt-2 p-4 bg-amber-50 border border-amber-200 rounded space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Add new port
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                This port will be submitted for admin verification. It will
                appear on your listing as &quot;pending verification&quot; until
                approved.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewPortForm(false)}
              className="text-amber-600 hover:text-amber-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-asb-ink-soft">
                UN/LOCODE <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={newPortData.locode}
                onChange={(e) =>
                  setNewPortData((p) => ({
                    ...p,
                    locode: e.target.value.toUpperCase(),
                  }))
                }
                placeholder="e.g. EG ALY"
                className={cn(
                  "w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-1 focus:ring-asb-blue bg-white",
                  newPortErrors.locode ? "border-red-300" : "border-asb-gray-200",
                )}
              />
              {newPortErrors.locode && (
                <p className="text-xs text-red-500">{newPortErrors.locode}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-asb-ink-soft">
                Port name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={newPortData.trade_name}
                onChange={(e) =>
                  setNewPortData((p) => ({ ...p, trade_name: e.target.value }))
                }
                placeholder="e.g. Alexandria"
                className={cn(
                  "w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-1 focus:ring-asb-blue bg-white",
                  newPortErrors.trade_name
                    ? "border-red-300"
                    : "border-asb-gray-200",
                )}
              />
              {newPortErrors.trade_name && (
                <p className="text-xs text-red-500">
                  {newPortErrors.trade_name}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-asb-ink-soft">
                Country <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={newPortData.country}
                onChange={(e) =>
                  setNewPortData((p) => ({ ...p, country: e.target.value }))
                }
                placeholder="e.g. Egypt"
                className={cn(
                  "w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-1 focus:ring-asb-blue bg-white",
                  newPortErrors.country ? "border-red-300" : "border-asb-gray-200",
                )}
              />
              {newPortErrors.country && (
                <p className="text-xs text-red-500">{newPortErrors.country}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-asb-ink-soft">
                Trade zone <span className="text-red-400">*</span>
              </label>
              <select
                value={newPortData.zone}
                onChange={(e) =>
                  setNewPortData((p) => ({ ...p, zone: e.target.value }))
                }
                className={cn(
                  "w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-1 focus:ring-asb-blue bg-white",
                  newPortErrors.zone ? "border-red-300" : "border-asb-gray-200",
                )}
              >
                <option value="">Select zone…</option>
                {ZONE_CODES.filter((z) => z !== "Unknown").map((z) => (
                  <option key={z} value={z}>
                    {z} — {ZONE_LABELS[z]}
                  </option>
                ))}
              </select>
              {newPortErrors.zone && (
                <p className="text-xs text-red-500">{newPortErrors.zone}</p>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleSaveNewPort}
              disabled={isSavingPort}
              className="flex items-center gap-1.5 px-4 py-2 bg-asb-blue text-white text-sm font-semibold rounded-lg hover:bg-asb-blue transition-colors disabled:opacity-60"
            >
              {isSavingPort ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              Submit port for verification
            </button>
            <button
              type="button"
              onClick={() => setShowNewPortForm(false)}
              className="px-4 py-2 text-sm font-semibold text-asb-gray-700 hover:bg-asb-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
