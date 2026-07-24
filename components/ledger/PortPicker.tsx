"use client";

// Broker Ledger — port picker in the pp2 chrome, backed by the real two-tier
// port search (curated ports table + 13.5k UN/LOCODE reference, merged) that
// PortAutocomplete uses on the legacy forms.

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { searchLedgerPorts } from "@/sdk/app/ledger";
import { zoneDisplayName } from "./defs";
import type { LedgerPortSel } from "./cargo/state";

export function PortPicker({
  value,
  onChange,
  placeholder,
}: {
  value?: LedgerPortSel | null;
  onChange: (port: LedgerPortSel) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<LedgerPortSel[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }
      try {
        const supabase = getSupabaseBrowserClient();
        const ports = await searchLedgerPorts(supabase, q);
        setResults(
          ports.map((p) => ({
            locode: p.locode,
            name: p.trade_name,
            country: p.country,
            zone: p.zone,
            zoneName: zoneDisplayName(p.zone),
          })),
        );
      } catch {
        setResults([]);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  if (value?.locode && !open) {
    return (
      <div className="pp2-port-sel">
        <span className="pp2-port-sel__name">{value.name}</span>
        <span className="pp2-port-sel__loc">
          {value.locode}
          {value.zoneName ? " · " + value.zoneName : ""}
        </span>
        <button
          type="button"
          className="pp2-vcard__change"
          onClick={() => {
            setOpen(true);
            setQ("");
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="pp2-port">
      <input
        className="pp2-select"
        style={{ backgroundImage: "none" }}
        value={q}
        placeholder={placeholder || "Search port or LOCODE…"}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && q && (
        <div className="pp2-port__menu">
          {results.map((p) => (
            <button
              type="button"
              className="pp2-port__opt"
              key={p.locode}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(p);
                setOpen(false);
                setQ("");
              }}
            >
              <span className="pp2-port__opt-name">{p.name}</span>
              <span className="pp2-port__opt-meta">
                {p.locode} · {p.zoneName || p.zone}
                {p.country ? " · " + p.country : ""}
              </span>
            </button>
          ))}
          {results.length === 0 && <div className="pp2-port__empty">No port matches “{q}”.</div>}
        </div>
      )}
    </div>
  );
}
