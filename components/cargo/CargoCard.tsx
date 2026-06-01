"use client";

import Link from "next/link";
import { CargoListingRow } from "@/lib/schemas/cargo";

// Extra columns that exist in the DB (added by the firewall/feature migrations)
// but may not be on the base row type — accessed defensively.
type CargoExtra = CargoListingRow & {
  is_wog?: boolean | null;
  for_circulation?: boolean | null;
  commission_pct?: number | null;
  disch_rate?: string | null;
  imsbc_category?: string | null;
};

const GRAIN_COMMODITIES = new Set([
  "Wheat", "Corn", "Barley", "Rice", "Sorghum", "Soybean", "Soybeans", "Maize",
]);

function typeLabel(c: CargoExtra): { label: string; variant: string } {
  if (c.is_grain_cargo || (c.commodity_name && GRAIN_COMMODITIES.has(c.commodity_name)))
    return { label: "GRAIN", variant: "dryish" };
  if (c.cargo_type === "Break Bulk") return { label: "BREAK BULK", variant: "bbulk" };
  return { label: "DRY BULK", variant: "dryish" };
}

function laycanDays(from: string | null): number | null {
  if (!from) return null;
  const d = new Date(from);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

function stripKey(c: CargoExtra): string {
  if (c.review_status === "PENDING") return "strip-review";
  if (c.is_spot) return "strip-in";
  const days = laycanDays(c.laycan_from);
  if (days != null && days < 3) return "strip-out";
  if (days != null && days <= 7) return "strip-partial";
  return "strip-in";
}

const fmtDay = (s: string | null) => {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

// IMSBC category → label/treatment (Group A & DG carry hazard warnings).
// Uses the IMSBC group when a richer row supplies it; otherwise falls back to
// the listing's is_dg_cargo flag. No data is fabricated.
function imsbcRender(cat: string | null | undefined, isDg: boolean) {
  switch (cat) {
    case "Cat_A":
      return { text: "Group A", color: "#854F0B", warn: true };
    case "Cat_B":
      return { text: "Group B", color: "#1B3A5C", warn: false };
    case "Cat_C":
      return { text: "Group C", color: "#1B3A5C", warn: false };
    case "DG":
      return { text: "DG", color: "#A32D2D", warn: true };
  }
  if (isDg) return { text: "DG", color: "#A32D2D", warn: true };
  return { text: "—", color: "#1B3A5C", warn: false };
}

export function CargoCard({
  cargo,
  matches = 0,
  partner = null,
  selected = false,
  onSelect,
}: {
  cargo: CargoListingRow;
  /** Engine match count (0 → muted circle). */
  matches?: number;
  /** Company alias only — never personal contact. null → identity masked. */
  partner?: { name: string; role?: string } | null;
  /** Board mode: when provided, clicking selects (reframes the map) instead
   *  of navigating; the commodity title becomes the detail link. */
  selected?: boolean;
  onSelect?: (id: string) => void;
}) {
  const c = cargo as CargoExtra;
  const t = typeLabel(c);
  const sf = c.stowage_factor;
  const sfDense = sf != null && sf < 0.5;
  const volume =
    sf != null ? `max ${Math.round(c.qty_max_mt * sf).toLocaleString()} m³` : "— m³";
  const weight =
    c.qty_min_mt !== c.qty_max_mt
      ? `${c.qty_min_mt.toLocaleString()}–${c.qty_max_mt.toLocaleString()} MT`
      : `${c.qty_max_mt.toLocaleString()} MT`;
  const terms = (c.load_terms ?? "").toUpperCase();
  const fiost = terms.includes("FIOST");
  const ldText = c.load_rate
    ? c.disch_rate && c.disch_rate !== c.load_rate
      ? `${c.load_rate} / ${c.disch_rate}`
      : c.load_rate
    : null;

  const href = `/dashboard/cargo/${c.id}`;
  const inner = (
    <>
      {/* Line 1 — commodity + category */}
      <div className="cc-line1">
        <div className="cc-title">
          {onSelect ? (
            <Link
              href={href}
              onClick={(e) => e.stopPropagation()}
              className="text-inherit no-underline hover:underline"
            >
              {c.commodity_name}
            </Link>
          ) : (
            c.commodity_name
          )}
        </div>
        <span className={`cc-cat cc-cat--${t.variant}`}>{t.label}</span>
      </div>

      {/* Line 2 — route + zones + WOG */}
      <div className="cc-line2">
        <span className="cc-route-line">
          <span className="cc-ports">
            {c.load_port_locode}
            <span className="cc-arrow"> → </span>
            {c.disch_port_locode}
          </span>
          {(c.load_zone || c.disch_zone) && (
            <>
              <span className="cc-mid">·</span>
              <span className="cc-zones">
                {c.load_zone}
                <span className="cc-arrow"> → </span>
                {c.disch_zone}
              </span>
            </>
          )}
        </span>
        {c.is_wog && <span className="cc-wog">WOG</span>}
      </div>

      {/* Data grid 2×3 */}
      <div className="cc-grid">
        <div className="cc-field">
          <div className="cc-field__k">QTY / VOL</div>
          <div className="cc-field__v">
            <span className="cc-qty">
              <span className="cc-qty__w">{weight}</span>
              <span
                className="cc-qty__v"
                style={{ color: sf != null ? "#185FA5" : "#8B95A3" }}
              >
                {volume}
              </span>
            </span>
          </div>
        </div>

        <div className="cc-field">
          <div className="cc-field__k">LAYCAN</div>
          <div className="cc-field__v">
            {c.is_spot ? (
              <span className="cc-spot">SPOT</span>
            ) : (
              <span>
                {fmtDay(c.laycan_from)}
                {c.laycan_to ? ` – ${fmtDay(c.laycan_to)}` : ""}
              </span>
            )}
          </div>
        </div>

        <div className="cc-field">
          <div className="cc-field__k">TERMS</div>
          <div className="cc-field__v">{c.load_terms || "—"}</div>
        </div>

        <div className="cc-field">
          <div className="cc-field__k">SF</div>
          <div className="cc-field__v">
            {sf != null ? (
              <span style={sfDense ? { color: "#854F0B" } : undefined}>
                {sfDense && "⚠ "}
                {sf} m³/t
              </span>
            ) : (
              <span className="cc-tbd">Not declared</span>
            )}
          </div>
        </div>

        <div className="cc-field">
          <div className="cc-field__k">L/D RATE</div>
          <div className="cc-field__v">
            {fiost ? (
              <span className="cc-cat cc-cat--dryish">FIOST</span>
            ) : ldText ? (
              <span>{ldText}</span>
            ) : (
              <span className="cc-tbd">Rate TBD</span>
            )}
          </div>
        </div>

        <div className="cc-field">
          <div className="cc-field__k">IMSBC</div>
          <div className="cc-field__v">
            {(() => {
              const im = imsbcRender(c.imsbc_category, c.is_dg_cargo);
              return (
                <span style={{ color: im.color, fontWeight: im.warn ? 500 : 400 }}>
                  {im.warn && "⚠ "}
                  {im.text}
                </span>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Footer — freight + via | circ | match (no contact) */}
      <div className="cc-footer">
        <div className="cc-foot-col cc-foot-col--freight">
          <div className="cc-freight">
            {c.freight_idea_usd_mt != null ? `$${c.freight_idea_usd_mt}/MT` : "—"}
            {c.commission_pct != null && ` · ${c.commission_pct}% comm`}
          </div>
          <div className="cc-partner-slot">
            {partner ? (
              <span className="mp-tag">
                via <b>{partner.name}</b>
                {partner.role && ` (${partner.role})`}
              </span>
            ) : (
              <span className="mp-tag masked">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <rect x="3" y="7" width="10" height="6.5" rx="1" />
                  <path d="M5 7V5a3 3 0 016 0v2" />
                </svg>
                Identity · Tier 3 &amp; Partner
              </span>
            )}
          </div>
        </div>
        <div className="cc-foot-col">
          <div className="cc-foot-label">Circ</div>
          <span className={`cc-circ-dot ${c.for_circulation ? "is-on" : "is-off"}`} />
        </div>
        <div className="cc-foot-col cc-foot-col--match">
          <div className="cc-foot-label">Match</div>
          <span className={`cc-match-circle ${matches === 0 ? "is-zero" : ""}`}>{matches}</span>
        </div>
      </div>
    </>
  );

  if (onSelect) {
    return (
      <div
        className={`cargo-card ${stripKey(c)} ${selected ? "is-selected" : ""}`}
        onClick={() => onSelect(c.id)}
      >
        {inner}
      </div>
    );
  }
  return (
    <Link href={href} className={`cargo-card ${stripKey(c)} block no-underline`}>
      {inner}
    </Link>
  );
}
