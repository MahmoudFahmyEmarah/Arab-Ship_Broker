// Classified records → ParsedSheet[] with UPPERCASE header keys that match
// SHEET_SPECS. From here the email path is identical to the XLSX path: the same
// mapRow → diff → validate → stage pipeline runs, so laycan SPOT/PPT handling,
// zone/enum validation, and the UNMAPPED→Manual-Review queue all apply for free.

import { createHash } from "node:crypto";
import type { ParsedSheet, RawRow } from "../types";
import type { CargoRecord, EmailSource, VesselRecord } from "./types";

// The source message travels as reserved keys on the raw row: unmapped (so they
// never become columns), but stored in sync_staged_row.raw for the Source drawer.
function srcKeys(src?: EmailSource): RawRow {
  if (!src) return {};
  return {
    _SRC_FROM: src.from ?? null,
    _SRC_SUBJECT: src.subject ?? null,
    _SRC_DATE: src.date ?? null,
    _SRC_TEXT: src.text ?? null,
    _SRC_CHANNEL: src.channel ?? "email",
    _SRC_NAME: src.name ?? null,
    _SRC_MSG_ID: src.msgId ?? null,
  };
}

// Circulars rarely carry the broker's internal CM-nnn reference, yet the pipeline
// keys cargo on `ref` (a missing key ⇒ invalid ⇒ can't sync). Rather than drop
// these rows, mint a DETERMINISTIC provisional key from the cargo's identifying
// fields: the same cargo re-extracted hashes to the same prefixed ref, so a
// re-sync updates in place instead of duplicating. Prefix encodes the channel
// (EM- email, WA- whatsapp). Marked provisional (see sheets.ts) so a reviewer
// can confirm or replace it; every commit remains reversible.
function provisionalRef(r: CargoRecord, prefix: string): string {
  const basis = [
    r.commodity, r.qty_min_mt, r.qty_max_mt,
    r.load_port, r.load_zone, r.disch_port, r.disch_zone,
    r.laycan_from, r.laycan_to,
  ].map((x) => (x == null ? "" : String(x).trim().toLowerCase())).join("|");
  const h = createHash("sha1").update(basis).digest("hex").slice(0, 8).toUpperCase();
  return `${prefix}-${h}`;
}

function cargoToRow(r: CargoRecord, prefix: string): RawRow {
  const ref = r.ref && r.ref.trim() ? r.ref.trim() : provisionalRef(r, prefix);
  return {
    REF: ref,
    CARGO_TYPE: r.cargo_type ?? null,
    COMMODITY: r.commodity ?? null,
    QTY_MIN_MT: r.qty_min_mt ?? null,
    QTY_MAX_MT: r.qty_max_mt ?? null,
    LOAD_PORT: r.load_port ?? null,
    LOAD_ZONE: r.load_zone ?? null,
    DISCH_PORT: r.disch_port ?? null,
    DISCH_ZONE: r.disch_zone ?? null,
    LAYCAN_FROM: r.laycan_from ?? null,
    LAYCAN_TO: r.laycan_to ?? null,
    FREIGHT_IDEA: r.freight_idea ?? null,
    COMMISSION_PCT: r.commission_pct ?? null,
    LOAD_RATE: r.load_rate ?? null,
    DISCH_RATE: r.disch_rate ?? null,
    LAYTIME_STRUCTURE: r.laytime_structure ?? null,
    LOAD_TERMS: r.load_terms ?? null,
    BROKER: r.broker ?? null,
    ASB_REGIME: r.asb_regime ?? null,
    NOTES: r.notes ?? null,
    ...srcKeys(r.__src),
  };
}

function vesselToRow(r: VesselRecord): RawRow {
  return {
    IMO: r.imo ?? null,
    VESSEL_NAME: r.vessel_name ?? null,
    VESSEL_TYPE: r.vessel_type ?? null,
    DWT_GRAIN: r.dwt ?? null,
    FLAG: r.flag ?? null,
    BUILT: r.built ?? null,
    GRT: r.grt ?? null,
    NRT: r.nrt ?? null,
    // Open-position intelligence rides along as raw-only keys (no matching
    // sheet column, so they never hit the vessels table) — the review queue
    // and the match engine consume them.
    OPEN_DATE: r.open_date ?? null,
    OPEN_PORT: r.open_port ?? null,
    OPEN_COUNTRY: r.open_country ?? null,
    OPEN_ZONE: r.open_zone ?? null,
    DIRECTION: r.direction ?? null,
    DEST_ZONES: r.dest_zones?.length ? r.dest_zones.join("|") : null,
    ...srcKeys(r.__src),
  };
}

export function recordsToSheets(
  cargo: CargoRecord[],
  vessels: VesselRecord[],
  opts: { refPrefix?: "EM" | "WA" } = {},
): ParsedSheet[] {
  const prefix = opts.refPrefix ?? "EM";
  const sheets: ParsedSheet[] = [];
  if (cargo.length) sheets.push({ sheet: "cargo", rows: cargo.map((r) => cargoToRow(r, prefix)) });
  if (vessels.length) sheets.push({ sheet: "vessels", rows: vessels.map(vesselToRow) });
  return sheets;
}
