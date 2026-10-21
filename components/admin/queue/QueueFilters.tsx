"use client";

// The design's filter bar for the review queue (Portal standalone 7 · PageReview): compact dropdown chips that
// change the URL's query, so the server page re-reads the queue with the filters applied.
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface FilterDef { key: string; label: string; options: { value: string; label: string }[] }

export function QueueFilters({ filters, summary }: { filters: FilterDef[]; summary: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  };
  return (
    <div className="adm-filterbar adm-filterbar--card">
      {filters.map((f) => (
        <label key={f.key} className="adm-filter-select">
          <span className="adm-sr-only">{f.label}</span>
          <select value={params.get(f.key) ?? ""} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label}>
            <option value="">{f.label}</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ))}
      <span className="adm-filterbar__summary">{summary}</span>
    </div>
  );
}
