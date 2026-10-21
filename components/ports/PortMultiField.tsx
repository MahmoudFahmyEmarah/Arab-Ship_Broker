"use client";

// Several ports, one of them primary — searched, never typed (owner, 19 Oct 2026). Submits the exact text format
// the existing server actions parse: "EGPSD*, EGSUZ" (comma separated LOCODEs, * marks the primary), so no
// action changes. Add with the search; ★ makes a port primary; × removes it.
import * as React from "react";
import { PortSearchField } from "./PortSearchField";
import { findPort, normLocode, type PortChoice } from "@/lib/ports/port-search";

export interface PortMultiValue { locode: string; isPrimary: boolean }

/** "EGPSD*, EGSUZ" — the primary first is not required; exactly what the actions already accept. */
export function serializePortList(list: readonly PortMultiValue[]): string {
  return list.map((p) => `${normLocode(p.locode)}${p.isPrimary ? "*" : ""}`).join(", ");
}

export function PortMultiField({
  options, defaultValue = [], name, ariaLabel, inputClassName,
}: {
  options: readonly PortChoice[];
  defaultValue?: readonly PortMultiValue[];
  name: string;
  ariaLabel?: string;
  inputClassName?: string;
}) {
  const [list, setList] = React.useState<PortMultiValue[]>(() => defaultValue.map((p) => ({ locode: normLocode(p.locode), isPrimary: p.isPrimary })));
  const remaining = React.useMemo(() => options.filter((o) => !list.some((p) => p.locode === normLocode(o.locode))), [options, list]);
  const add = React.useCallback((p: PortChoice | null) => {
    if (!p) return;
    setList((cur) => cur.some((x) => x.locode === normLocode(p.locode)) ? cur : [...cur, { locode: normLocode(p.locode), isPrimary: cur.length === 0 }]);
  }, []);
  const makePrimary = (code: string) => setList((cur) => cur.map((p) => ({ ...p, isPrimary: p.locode === code })));
  const remove = (code: string) => setList((cur) => {
    const next = cur.filter((p) => p.locode !== code);
    if (next.length && !next.some((p) => p.isPrimary)) next[0] = { ...next[0], isPrimary: true };
    return next;
  });

  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <input type="hidden" name={name} value={serializePortList(list)} />
      {list.length > 0 && (
        <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {list.map((p) => {
            const known = findPort(options, p.locode);
            return (
              <span key={p.locode} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 999, border: "1px solid var(--asb-gray-200)", background: p.isPrimary ? "var(--asb-gold-bg)" : "var(--asb-gray-50)", fontSize: 12 }}>
                <button type="button" onClick={() => makePrimary(p.locode)} aria-label={p.isPrimary ? `${p.locode} is the primary port` : `Make ${p.locode} the primary port`} aria-pressed={p.isPrimary} title={p.isPrimary ? "Primary port" : "Make primary"} style={{ border: 0, background: "none", cursor: "pointer", padding: 0, color: p.isPrimary ? "var(--asb-gold-deep)" : "var(--asb-gray-400)" }}>★</button>
                <span>{known ? `${known.name} · ` : ""}<span className="mono">{p.locode}</span>{known ? "" : " · not a verified port"}</span>
                <button type="button" onClick={() => remove(p.locode)} aria-label={`Remove ${p.locode}`} style={{ border: 0, background: "none", cursor: "pointer", padding: 0, color: "var(--asb-gray-500)" }}>×</button>
              </span>
            );
          })}
        </span>
      )}
      <PortSearchField options={remaining} value={null} onChange={add} ariaLabel={ariaLabel ?? "Add a port"} inputClassName={inputClassName} placeholder="Add a port: search name, LOCODE or country…" />
    </span>
  );
}
