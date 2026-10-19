"use client";

// The shared port field (owner request, 19 Oct 2026): type a name, UN/LOCODE or country, pick from the list the
// form supplies, and the LOCODE is what gets stored. Works inside plain server-action forms (`name` renders a
// hidden input carrying the LOCODE) and in controlled React state (`onChange`). ARIA 1.2 combobox: arrow keys
// move, Enter picks, Escape closes; the chosen port shows as "Name · Country · LOCODE" with a Change button.
import * as React from "react";
import { filterPorts, findPort, portLabel, type PortChoice } from "@/lib/ports/port-search";

export interface PortSearchFieldProps {
  options: readonly PortChoice[];
  /** the selected LOCODE (controlled); omit to let the field hold its own state */
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (port: PortChoice | null) => void;
  /** form field name: a hidden input carries the selected LOCODE for server-action forms */
  name?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** accessible name when no visible <label> wraps the field */
  ariaLabel?: string;
  id?: string;
  inputClassName?: string;
  /** class for the "Change" button (admin default; member pages pass their own) */
  changeClassName?: string;
  /** shown when the list is empty, e.g. "This supplier has no registered ports" */
  emptyListNote?: string;
}

export function PortSearchField({
  options, value, defaultValue, onChange, name, required, disabled, placeholder, ariaLabel, id, inputClassName, changeClassName = "adm-btn small", emptyListNote,
}: PortSearchFieldProps) {
  const autoId = React.useId();
  const baseId = id ?? `port-${autoId.replace(/:/g, "")}`;
  const listId = `${baseId}-list`;
  const controlled = value !== undefined;
  const [own, setOwn] = React.useState<string | null>(defaultValue ?? null);
  const selectedCode = controlled ? value ?? null : own;
  const selected = findPort(options, selectedCode);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(!selected);
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const hits = React.useMemo(() => filterPorts(options, query, 12), [options, query]);

  // a selection that disappears from the list (e.g. another supplier chosen) is cleared, never kept silently
  React.useEffect(() => {
    if (selectedCode && options.length > 0 && !findPort(options, selectedCode)) {
      if (!controlled) setOwn(null);
      onChange?.(null);
      setEditing(true);
    }
  }, [options, selectedCode, controlled, onChange]);

  // a controlled value set from outside (e.g. a newly chosen cargo with a fixed port) shows as chosen, and a cleared
  // one reopens the search (Opus O2B-048 P2-1); pressing Change does not move the value, so it is not undone here
  React.useEffect(() => {
    if (controlled) setEditing(!findPort(options, selectedCode));
  }, [controlled, selectedCode, options]);

  const choose = (p: PortChoice | null) => {
    if (!controlled) setOwn(p?.locode ?? null);
    onChange?.(p);
    setQuery("");
    setOpen(false);
    setEditing(!p);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, Math.max(hits.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { if (open && hits[active]) { e.preventDefault(); choose(hits[active]); } }
    else if (e.key === "Escape") { setOpen(false); }
  };

  const hidden = name ? <input type="hidden" name={name} value={selected?.locode ?? ""} /> : null;

  if (selected && !editing) {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }} data-testid="port-search-selected">
        {hidden}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <strong>{selected.name}</strong>
          <span style={{ color: "var(--asb-gray-500)" }}>{selected.country ? ` · ${selected.country}` : ""} · {selected.locode}{selected.note ? ` · ${selected.note}` : ""}</span>
        </span>
        {!disabled && (
          <button type="button" className={changeClassName} onClick={() => { setEditing(true); setQuery(""); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}>
            Change
          </button>
        )}
      </span>
    );
  }

  const activeId = open && hits[active] ? `${listId}-${active}` : undefined;
  return (
    <span style={{ position: "relative", display: "block" }}>
      {hidden}
      <input
        ref={inputRef}
        id={baseId}
        className={inputClassName}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-label={ariaLabel ?? "Port"}
        aria-required={required || undefined}
        autoComplete="off"
        disabled={disabled}
        value={query}
        placeholder={placeholder ?? "Search port name, LOCODE or country…"}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        // a required field with nothing chosen blocks the form like a native required input
        required={required && !selected}
        style={{ width: "100%" }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          style={{
            position: "absolute", zIndex: 40, left: 0, right: 0, top: "calc(100% + 2px)", margin: 0, padding: 4, listStyle: "none",
            maxHeight: 280, overflowY: "auto", background: "var(--asb-white)", border: "1px solid var(--asb-gray-200)",
            borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.12)",
          }}
        >
          {hits.map((p, i) => (
            <li
              key={p.locode}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(p)}
              style={{
                padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontSize: 13,
                background: i === active ? "var(--asb-gray-100)" : "transparent", color: "var(--asb-navy)",
              }}
            >
              {portLabel(p)}{p.note ? <span style={{ color: "var(--asb-gray-500)" }}> · {p.note}</span> : null}
            </li>
          ))}
          {hits.length === 0 && (
            <li role="option" aria-disabled="true" aria-selected={false} style={{ padding: "6px 8px", fontSize: 13, color: "var(--asb-gray-500)" }}>
              {options.length === 0 ? (emptyListNote ?? "No ports available.") : `No port matches “${query}”.`}
            </li>
          )}
        </ul>
      )}
    </span>
  );
}
