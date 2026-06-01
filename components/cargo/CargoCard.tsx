"use client";

import Link from "next/link";
import { CargoListingRow } from "@/lib/schemas/cargo";

// Extra prod columns accessed defensively (the base Row type may omit some).
type CargoExtra = CargoListingRow & {
  is_wog?: boolean | null;
  for_circulation?: boolean | null;
  commission_pct?: number | null;
  disch_rate?: string | null;
  imsbc_category?: string | null;
  demurrage_rate?: number | null;
  despatch_rate?: number | null;
  market_partner_name?: string | null;
  broker?: string | null;
};

const GRAIN_COMMODITIES = new Set([
  "Wheat", "Corn", "Barley", "Rice", "Sorghum", "Soybean", "Soybeans", "Maize",
]);

function typeLabel(c: CargoExtra): string {
  if (c.is_grain_cargo || (c.commodity_name && GRAIN_COMMODITIES.has(c.commodity_name)))
    return "GRAIN";
  if (c.cargo_type === "Break Bulk") return "BREAK BULK";
  return (c.cargo_type ?? "DRY BULK").toUpperCase();
}

function laycanDays(from: string | null): number | null {
  if (!from) return null;
  const d = new Date(from);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

// Status chip (replaces the old left strip): review / urgency-driven.
function statusChip(c: CargoExtra): { cls: string; label: string } {
  if (c.review_status === "PENDING") return { cls: "scope-review", label: "REVIEW" };
  if (c.is_spot) return { cls: "scope-in", label: "LIVE" };
  const d = laycanDays(c.laycan_from);
  if (d != null && d < 3) return { cls: "scope-out", label: "URGENT" };
  if (d != null && d <= 7) return { cls: "scope-partial", label: "SOON" };
  return { cls: "scope-in", label: "LIVE" };
}

function imsbcRender(cat: string | null | undefined, isDg: boolean): string {
  switch (cat) {
    case "Cat_A": return "⚠ Group A";
    case "Cat_B": return "Group B";
    case "Cat_C": return "Group C";
    case "DG": return "⚠ DG";
  }
  return isDg ? "⚠ DG" : "—";
}

const fmtDay = (s: string | null) => {
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

const dash = (v: string | number | null | undefined) =>
  v == null || v === "" ? "—" : String(v);

export function CargoCard({
  cargo,
  matches = 0,
  partner = null,
  selected = false,
  onSelect,
}: {
  cargo: CargoListingRow;
  matches?: number;
  partner?: { name: string; role?: string } | null;
  selected?: boolean;
  onSelect?: (id: string) => void;
}) {
  const c = cargo as CargoExtra;
  const href = `/dashboard/cargo/${c.id}`;
  const chip = statusChip(c);
  const cat = typeLabel(c);
  const qty =
    c.qty_min_mt !== c.qty_max_mt
      ? `${c.qty_min_mt.toLocaleString()}–${c.qty_max_mt.toLocaleString()}`
      : c.qty_max_mt.toLocaleString();
  const qtyIsRange = c.qty_min_mt !== c.qty_max_mt;
  const laycan = c.is_spot
    ? "SPOT"
    : `${fmtDay(c.laycan_from)} – ${fmtDay(c.laycan_to)}`;
  const ld =
    c.load_rate
      ? c.disch_rate && c.disch_rate !== c.load_rate
        ? `${c.load_rate} / ${c.disch_rate}`
        : c.load_rate
      : null;
  const imsbc = imsbcRender(c.imsbc_category, c.is_dg_cargo);
  const viaName = partner?.name ?? c.market_partner_name ?? c.broker ?? null;

  const inner = (
    <>
      {/* Header — commodity + status chip */}
      <div className="mvb-vc__hd">
        <span className="mvb-vc__name">
          {onSelect ? (
            <Link href={href} onClick={(e) => e.stopPropagation()} className="text-inherit no-underline hover:underline">
              {c.commodity_name}
            </Link>
          ) : (
            c.commodity_name
          )}
        </span>
        <span className={`mvb-chip-st ${chip.cls}`}>{chip.label}</span>
      </div>

      {/* ID line — ref · category + tags */}
      <div className="mvb-vc__id">
        {c.ref && <span className="mono">{c.ref}</span>}
        {c.ref && <span className="sep">·</span>}
        <span className="mvb-tag cat">{cat}</span>
        {c.is_dg_cargo && <span className="mvb-tag dg">DG</span>}
        {c.is_spot && <span className="mvb-tag spot">SPOT</span>}
        {c.is_wog && <span className="mvb-tag wog">WOG</span>}
      </div>

      {/* Figure block — QTY dominant + SF secondary */}
      <div className="mvb-vc__figs">
        <div className="mvb-fig mvb-fig--dwt">
          <div className="fglbl">Quantity (MT)</div>
          <div className="fgval" style={qtyIsRange ? { fontSize: 17 } : undefined}>{qty}</div>
        </div>
        <div className="mvb-fig mvb-fig--grt">
          <div className="fglbl">SF m³/t</div>
          {c.stowage_factor != null ? (
            <div className="fgval">{c.stowage_factor}</div>
          ) : (
            <div className="fgval tbc-sm">—</div>
          )}
        </div>
      </div>

      {/* Spec grid — Laycan / Terms / L·D / IMSBC */}
      <div className="mvb-vc__specs">
        <div className="mvb-spec"><div className="sk">Laycan</div><div className={`sv${c.is_spot ? "" : ""}`}>{laycan}</div></div>
        <div className="mvb-spec"><div className="sk">Terms</div><div className={`sv${c.load_terms ? "" : " dim"}`}>{dash(c.load_terms)}</div></div>
        <div className="mvb-spec"><div className="sk">L/D rate</div><div className={`sv${ld ? "" : " dim"}`}>{ld ?? "—"}</div></div>
        <div className="mvb-spec"><div className="sk">IMSBC</div><div className={`sv${imsbc === "—" ? " dim" : ""}`} style={imsbc.startsWith("⚠") ? { color: imsbc.includes("DG") ? "#C84A4A" : "#B17311" } : undefined}>{imsbc}</div></div>
      </div>

      {/* Commercial block (mirrors the vessel fuel block) */}
      <div className="mvb-vc__fuel">
        <div className="fh">Commercial · USD</div>
        <div className="mvb-fuelgrid">
          <div className="mvb-fcell"><div className="fk">Freight /MT</div><div className="fv">{c.freight_idea_usd_mt != null ? `$${c.freight_idea_usd_mt}` : "—"}</div></div>
          <div className="mvb-fcell"><div className="fk">Comm %</div><div className="fv">{c.commission_pct != null ? c.commission_pct : "—"}</div></div>
          <div className="mvb-fcell"><div className="fk">Demurrage</div><div className="fv">{c.demurrage_rate != null ? c.demurrage_rate.toLocaleString() : "—"}</div></div>
          <div className="mvb-fcell"><div className="fk">Despatch</div><div className="fv">{c.despatch_rate != null ? c.despatch_rate.toLocaleString() : "—"}</div></div>
        </div>
      </div>

      {/* Footer — ref · circ · matches · view */}
      <div className="mvb-vc__ft">
        <span className="imo">{c.ref ?? c.commodity_name}</span>
        <span
          className={`cc-circ-dot ${c.for_circulation ? "is-on" : "is-off"}`}
          title={c.for_circulation ? "In circulation" : "Not circulated"}
          style={{ marginLeft: 2 }}
        />
        <span className={`mvb-matches ${matches === 0 ? "none" : ""}`}>{matches} matches</span>
        <span className="sp" />
        {onSelect ? (
          <Link className="mvb-vlink strong" href={href} onClick={(e) => e.stopPropagation()}>
            View details
          </Link>
        ) : (
          <span className="mvb-vlink strong">View details</span>
        )}
      </div>

      {/* Route bar (mirrors the vessel position bar) */}
      <div className="mvb-vc__pos">
        <div className="posbar-eyebrow">Route</div>
        <div className="row1">
          <span className="port">{c.load_port_locode ?? c.load_port_name}</span>
          {c.load_zone && <span className="zone">{c.load_zone}</span>}
          <span style={{ color: "#9AA7BD", margin: "0 2px" }}>→</span>
          <span className="port">{c.disch_port_locode ?? c.disch_port_name}</span>
          {c.disch_zone && <span className="zone">{c.disch_zone}</span>}
        </div>
        <div className="dir">
          {c.load_port_name} <span style={{ color: "#9AA7BD" }}>→</span> {c.disch_port_name}
        </div>
      </div>

      {viaName ? (
        <div className="mvb-vc__via">
          via <b>{viaName}</b>
          {partner?.role && <span style={{ opacity: 0.7 }}> ({partner.role})</span>}
        </div>
      ) : null}
    </>
  );

  if (onSelect) {
    return (
      <article
        className={`mvb-vcard${selected ? " is-selected" : ""}`}
        onClick={() => onSelect(c.id)}
      >
        {inner}
      </article>
    );
  }
  return (
    <Link href={href} className="mvb-vcard" style={{ textDecoration: "none" }}>
      {inner}
    </Link>
  );
}
