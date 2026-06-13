"use client";

// Admin registry card grid (adm-card-grid) with a search bar and pager — used
// for registry entities (commodities, ports) where a compact card reads better
// than a row. The card itself is rendered by the caller via `renderCard`.
import * as React from "react";

export function CardGrid<T extends Record<string, unknown>>({
  rows,
  searchKeys,
  renderCard,
  searchPlaceholder = "Search…",
  pageSize = 24,
  toolbar,
  emptyText = "No results",
}: {
  rows: T[];
  searchKeys: string[];
  renderCard: (row: T) => React.ReactNode;
  searchPlaceholder?: string;
  pageSize?: number;
  toolbar?: React.ReactNode;
  emptyText?: string;
}) {
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);

  const filtered = React.useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) =>
      searchKeys.some((k) => String((r as Record<string, unknown>)[k] ?? "").toLowerCase().includes(needle)),
    );
  }, [q, rows, searchKeys]);

  React.useEffect(() => setPage(1), [q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

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
        <span style={{ fontSize: 10, color: "#8B95A3" }}>
          {filtered.length} of {rows.length}
        </span>
      </div>
      <div className="adm-card-grid">
        {filtered.length === 0 ? (
          <div className="adm-grid-empty">{emptyText}</div>
        ) : (
          pageRows.map((r) => renderCard(r))
        )}
      </div>
      {pageCount > 1 && (
        <div className="adm-grid-foot">
          <span>
            Page {safePage} of {pageCount} · {pageSize} cards per page
          </span>
          <div className="adm-table__pager">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>
              ‹
            </button>
            <button className="is-on">{safePage}</button>
            <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage === pageCount}>
              ›
            </button>
          </div>
        </div>
      )}
    </>
  );
}
