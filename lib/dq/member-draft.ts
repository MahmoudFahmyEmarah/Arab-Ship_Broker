// Turning a member form's payload into the row the data-quality gate reads,
// and the gate's verdict into words for the form (workstream E, 19 Sep 2026).
// Pure, client-safe. Unknown keys are ignored by the gate, so a mapping only
// has to name the columns the rules look at.

import type { MemberDraftVerdict } from "./member-gate";

type Row = Record<string, unknown>;

/** The classic Post Cargo form already speaks in column names. */
export function cargoFormDraftRow(payload: Row): Row {
  const { safety_answers: _sa, ...rest } = payload;
  void _sa;
  return rest;
}

/** The broker-ledger cargo payload: one quantity, laycan pair, ports. */
export function ledgerCargoDraftRow(p: Row): Row {
  const parcels = Array.isArray(p.parcels) ? (p.parcels as Row[]) : null;
  const first = parcels && parcels.length ? parcels[0] : {};
  const qty = Number((first.qty_mt ?? p.qty_mt) ?? 0) || null;
  return {
    commodity_name: first.commodity_name ?? p.commodity_name ?? null,
    cargo_type: first.cargo_type ?? p.cargo_type ?? null,
    qty_min_mt: qty, qty_max_mt: qty,
    volume_cbm: first.volume_cbm ?? p.volume_cbm ?? null,
    packaging_type: first.packaging_type ?? p.packaging_type ?? null,
    load_port_locode: p.load_port_locode ?? null,
    disch_port_locode: p.disch_port_locode ?? null,
    laycan_from: p.laycan_from ?? null,
    laycan_to: p.laycan_to ?? null,
    is_spot: !!p.is_spot,
    freight_idea_usd_mt: p.freight_idea_usd_mt ?? null,
    commission_ttl_pct: p.commission_ttl_pct ?? null,
    notes: p.notes ?? null,
  };
}

/** The broker-ledger position payload → a vessel_availability row. */
export function ledgerPositionDraftRow(p: Row): Row {
  const a = (p.availability ?? {}) as Row;
  return {
    status: a.status ?? "OPEN",
    open_port_locode: a.open_port_locode ?? null,
    open_date: a.open_from ?? null,
    next_direction: a.next_direction ?? null,
    wog: !!a.wog,
  };
}

/** Under enforcement a block, or a rule that could not evaluate, refuses the post. */
export function draftRefused(v: MemberDraftVerdict): boolean {
  return v.enforcing && (v.blocked || v.errors > 0);
}

/** One message for the form: the blocking rules first, then the warnings. */
export function draftIssuesMessage(v: MemberDraftVerdict): string {
  const line = (i: MemberDraftVerdict["issues"][number]) => `${i.field ? `${i.field}: ` : ""}${i.message} (${i.rule_code})`;
  const blocks = v.issues.filter((i) => i.mode === "block");
  const warns = v.issues.filter((i) => i.mode !== "block");
  const parts: string[] = [];
  if (draftRefused(v)) parts.push(blocks.length ? `Not posted — fix these first: ${blocks.map(line).join("; ")}` : `Not posted — ${v.errors} data-quality rule(s) could not check this draft; try again in a moment.`);
  else if (blocks.length) parts.push(`These would be refused once enforcement is on: ${blocks.map(line).join("; ")}`);
  if (warns.length) parts.push(`Please check: ${warns.map(line).join("; ")}`);
  return parts.join(" · ");
}
