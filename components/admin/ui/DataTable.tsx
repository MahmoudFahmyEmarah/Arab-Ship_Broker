"use client";

// Generic searchable, paginated admin table (adm-table). The default density
// for admin data — NOT big cards. Columns declare a render fn for cells; rows
// can link to a detail route via `rowHref`. Search filters across the declared
// search keys (or all string columns).
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type Column<T> = {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  cellClass?: string;
  thStyle?: React.CSSProperties;
};

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  searchKeys,
  searchPlaceholder = "Search…",
  rowHref,
  onRowClick,
  selectedId,
  rowKey,
  pageSize = 25,
  toolbar,
  emptyText = "No results",
}: {
  columns: Column<T>[];
  rows: T[];
  searchKeys?: string[];
  searchPlaceholder?: string;
  rowHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedId?: string;
  rowKey?: (row: T) => string;
  pageSize?: number;
  toolbar?: React.ReactNode;
  emptyText?: string;
}) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);

  const filtered = React.useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    const keys = searchKeys ?? columns.map((c) => c.key);
    return rows.filter((r) =>
      keys.some((k) => String((r as Record<string, unknown>)[k] ?? "").toLowerCase().includes(needle)),
    );
  }, [q, rows, searchKeys, columns]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  React.useEffect(() => {
    setPage(1);
  }, [q]);

  const keyFor = (r: T, i: number) =>
    rowKey?.(r) ?? String((r as Record<string, unknown>).id ?? (r as Record<string, unknown>).ref ?? i);

  const go = (r: T) => {
    if (rowHref) router.push(rowHref(r));
    else onRowClick?.(r);
  };
  const clickable = !!rowHref || !!onRowClick;

  return (
    <>
      <div className="adm-filterbar">
        <input
          className="adm-search"
          placeholder={searchPlaceholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {toolbar}
      </div>
      <div className="adm-table">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={c.thStyle}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => {
              const id = keyFor(r, i);
              return (
                <tr
                  key={id}
                  className={`${clickable ? "" : "no-hover"} ${selectedId && id === selectedId ? "is-selected" : ""}`}
                  onClick={clickable ? () => go(r) : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={c.cellClass}>
                      {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr className="no-hover">
                <td colSpan={columns.length} style={{ textAlign: "center", color: "#8B95A3", padding: 30 }}>
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="adm-table__foot">
          <span>
            Showing {filtered.length === 0 ? 0 : start + 1}
            {"–"}
            {Math.min(start + pageSize, filtered.length)} of {filtered.length}
          </span>
          {pageCount > 1 && (
            <div className="adm-table__pager">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>
                ‹
              </button>
              {Array.from({ length: pageCount }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === pageCount || Math.abs(p - safePage) <= 1)
                .map((p, idx, arr) => (
                  <React.Fragment key={p}>
                    {idx > 0 && p - arr[idx - 1] > 1 && <button disabled>…</button>}
                    <button className={p === safePage ? "is-on" : ""} onClick={() => setPage(p)}>
                      {p}
                    </button>
                  </React.Fragment>
                ))}
              <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage === pageCount}>
                ›
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Re-export Link so pages can build cell links without another import.
export { Link as TableLink };
