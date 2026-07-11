// Outbound message composers — pure and unit-testable.
//
// REDACTION RULE (the commercial guard): outbound summaries show only the
// operational shape of an enquiry — commodity, type, quantities, ports/zones,
// laycan, regime. They NEVER include commission, freight ideas, rates, broker
// names, or notes: that is the bargaining data the platform keeps private.

import type { CargoRecord, VesselRecord } from "../email/types";
import type { MatchResult } from "../match";

const nf = (n: number | null | undefined) => (n == null ? null : n.toLocaleString("en-US"));

function line(label: string, value: string | null | undefined): string | null {
  return value ? `• ${label}: ${value}` : null;
}

const fmtDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

/** One cargo record → a compact WhatsApp block (redacted). */
export function cargoSummary(r: CargoRecord, i: number, total: number): string {
  const head = total > 1 ? `📦 *CARGO ENQUIRY ${i + 1}/${total}*` : "📦 *CARGO ENQUIRY*";
  const qty = r.qty_min_mt != null || r.qty_max_mt != null
    ? `${nf(r.qty_min_mt) ?? "—"} – ${nf(r.qty_max_mt) ?? "—"} MT` : null;
  const laycan = r.laycan_from
    ? (r.laycan_to && r.laycan_to !== r.laycan_from ? `${r.laycan_from} → ${r.laycan_to}` : r.laycan_from)
    : null;
  const rows = [
    line("Commodity", r.commodity ?? null),
    line("Type", [r.cargo_type, r.asb_regime && r.asb_regime !== "UNMAPPED" ? r.asb_regime : null].filter(Boolean).join(" · ") || null),
    line("Quantity", qty),
    line("Load", [r.load_port, r.load_zone].filter(Boolean).join(" · ") || null),
    line("Discharge", [r.disch_port, r.disch_zone].filter(Boolean).join(" · ") || null),
    line("Laycan", laycan),
    line("Posted", fmtDate(r.__src?.date)),
  ].filter(Boolean);
  return [head, "─────────────", ...rows].join("\n");
}

/** One vessel record → a compact WhatsApp block. */
export function vesselSummary(r: VesselRecord, i: number, total: number): string {
  const head = total > 1 ? `🚢 *OPEN VESSEL POSITION ${i + 1}/${total}*` : "🚢 *OPEN VESSEL POSITION*";
  const open = [r.open_port, r.open_country].filter(Boolean).join(", ") || null;
  const rows = [
    line("Vessel", r.vessel_name ?? null),
    line("IMO", r.imo ?? null),
    line("Type", r.vessel_type ?? null),
    line("DWT", nf(r.dwt) ? `${nf(r.dwt)} MT` : null),
    line("Built", r.built != null ? String(r.built) : null),
    line("Flag", r.flag ?? null),
    line("Open at", open ? `${open}${r.open_zone ? ` (${r.open_zone})` : ""}` : r.open_zone),
    line("Direction", r.direction ?? (r.dest_zones?.length ? r.dest_zones.join(" / ") : null)),
    line("Posted", fmtDate(r.__src?.date)),
  ].filter(Boolean);
  return [head, "─────────────", ...rows].join("\n");
}

/** The full extracted-data summary for the auto-ack. */
export function composeExtractSummary(cargo: CargoRecord[], vessels: VesselRecord[]): string {
  const parts = [
    ...cargo.map((r, i) => cargoSummary(r, i, cargo.length)),
    ...vessels.map((r, i) => vesselSummary(r, i, vessels.length)),
  ];
  return parts.join("\n\n");
}

/** Fill the admin-editable ack template. Unknown placeholders are left intact. */
export function renderTemplate(
  template: string,
  vars: { name: string; summary: string; url: string },
): string {
  return template
    .replaceAll("{{name}}", vars.name)
    .replaceAll("{{summary}}", vars.summary)
    .replaceAll("{{url}}", vars.url);
}

/** Mask a counterparty identity for the teaser: "MV AURORA" → "MV A•••••". */
export function maskName(name: string | null | undefined): string {
  const s = (name ?? "").trim();
  if (!s) return "•••••";
  const words = s.split(/\s+/);
  return words
    .map((w, i) => (i === 0 && /^(mv|m\/v)$/i.test(w) ? w.toUpperCase() : w.length <= 1 ? "•" : `${w[0].toUpperCase()}${"•".repeat(Math.min(w.length - 1, 6))}`))
    .join(" ");
}

/** The match teaser — masked counterparties, no commercial terms. */
export function composeTeaser(matches: MatchResult[], platformUrl: string): string {
  if (!matches.length) {
    return `*Arab ShipBroker — market scan*\nWe are actively scanning the market for your enquiry. Our chartering desk will revert with matching opportunities very soon.\n${platformUrl}`;
  }
  const lines = matches.slice(0, 5).map((m) => {
    const bits = [m.kind === "vessel" ? maskName(m.label) : m.label, ...m.facts].filter(Boolean).join(" · ");
    return `${m.band === "Strong" ? "🟢" : m.band === "Good" ? "🟡" : "⚪"} ${bits}`;
  });
  return [
    "*Arab ShipBroker — potential matches found*",
    `Our engine found *${matches.length} potential match${matches.length > 1 ? "es" : ""}* for your enquiry:`,
    "",
    ...lines,
    "",
    "Full details, contacts and fixtures are available on the platform — our desk will contact you shortly.",
    platformUrl,
  ].join("\n");
}
