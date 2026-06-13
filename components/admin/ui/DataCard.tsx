// Compact registry card (adm-data-card) — the dense card language for ports /
// commodities: title + mono sub-id, an optional colored group chip, a 2-col
// key/value grid, an "Incomplete" badge, and a footer (Edit / delete). Far
// denser than the old QTY/LAYCAN/REF tile cards.
import * as React from "react";

export type CardKV = { k: string; v: React.ReactNode; blue?: boolean };
export type GroupChip = { label: string; variant: "a" | "b" | "c" | "dg" };

export function DataCard({
  title,
  sub,
  group,
  kvs,
  incomplete,
  incompleteLabel = "Incomplete",
  inactive,
  footer,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  group?: GroupChip;
  kvs?: CardKV[];
  incomplete?: boolean;
  incompleteLabel?: string;
  inactive?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className={`adm-data-card${incomplete ? " is-incomplete" : ""}${inactive ? " is-inactive" : ""}`}
    >
      {incomplete && <span className="adm-incomplete">⚠ {incompleteLabel}</span>}
      <div className="adm-data-card__head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="adm-data-card__title">{title}</div>
          {sub != null && <div className="adm-data-card__sub">{sub}</div>}
        </div>
        {group && <span className={`adm-data-card__group is-${group.variant}`}>{group.label}</span>}
      </div>
      {kvs && kvs.length > 0 && (
        <div className="adm-data-card__grid">
          {kvs.map((kv, i) => (
            <div key={i} className="adm-data-card__kv">
              <span className="adm-data-card__k">{kv.k}</span>
              <span className={`adm-data-card__v${kv.blue ? " is-blue" : ""}`} title={typeof kv.v === "string" ? kv.v : undefined}>
                {kv.v}
              </span>
            </div>
          ))}
        </div>
      )}
      {footer && <div className="adm-data-card__foot">{footer}</div>}
    </div>
  );
}
