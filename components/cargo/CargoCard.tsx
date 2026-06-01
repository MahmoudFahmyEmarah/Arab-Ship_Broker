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

export function CargoCard({ cargo }: { cargo: CargoListingRow }) {
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

  return (
    <Link
      href={`/dashboard/cargo/${c.id}`}
      className={`cargo-card ${stripKey(c)} block no-underline`}
    >
      {/* Line 1 — commodity + category */}
      <div className="cc-line1">
        <div className="cc-title">{c.commodity_name}</div>
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
            {c.is_dg_cargo ? (
              <span style={{ color: "#A32D2D", fontWeight: 500 }}>⚠ DG</span>
            ) : (
              <span>—</span>
            )}
          </div>
        </div>
      </div>

      {/* Footer — freight + circulation + view (no contact) */}
      <div className="cc-footer">
        <div className="cc-foot-col cc-foot-col--freight">
          <div className="cc-foot-label">Freight idea</div>
          <div className="cc-freight">
            {c.freight_idea_usd_mt != null ? `$${c.freight_idea_usd_mt}/MT` : "—"}
            {c.commission_pct != null && ` · ${c.commission_pct}% comm`}
          </div>
        </div>
        <div className="cc-foot-col">
          <div className="cc-foot-label">Circ</div>
          <span className={`cc-circ-dot ${c.for_circulation ? "is-on" : "is-off"}`} />
        </div>
        <div className="cc-foot-col">
          <div className="cc-foot-label">&nbsp;</div>
          <span className="cc-view">View →</span>
        </div>
      </div>
    </Link>
  );
}
