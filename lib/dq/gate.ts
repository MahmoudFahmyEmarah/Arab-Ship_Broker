// Data Quality — the gate, for every write path (server only).
//
//   const gate = await validateRow(sb, "cargo_listings", row, "forms", actor);
//   if (gate.blocked) → refuse; gate.issues carries the field messages
//
// The same rule definitions the batch audits run are evaluated on the unsaved
// row (fn_dq_validate). Block-mode rejections are logged to dq_gate_log.
//
// Fail-open vs fail-closed: by default a gate that cannot run (RPC error) lets
// the write through, so a broken rule never takes a write path down. The
// FINAL step that makes a listing live — approval — must not inherit that:
// pass { strict: true } and an unavailable gate counts as a block, and so does
// any single rule that failed to evaluate (fn_dq_validate's errors counter).
//
// 17 Sep 2026: the member forms no longer depend on this module — the database
// evaluates the same gate on every authenticated write (trg_*_zz_dq_gate,
// 20260917120000_cargo_live_route_gate.sql), shadow until
// dq_settings.gate_forms_enforce is on.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DqChannel, DqGateResult } from "./types";

export async function validateRow(
  sb: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
  channel: DqChannel,
  actor?: { name?: string | null; id?: string | null },
  log = true,
  opts: { strict?: boolean } = {},
): Promise<DqGateResult> {
  const { data, error } = await sb.rpc("fn_dq_validate", {
    p_table: table, p_row: row, p_channel: channel, p_actor: actor?.name ?? null, p_actor_id: actor?.id ?? null, p_log: log,
  });
  if (error) {
    if (opts.strict) {
      return {
        ok: false, blocked: true, errors: 1,
        issues: [{ rule_code: "GATE", name: "Data-quality gate unavailable", severity: "error", field: null, mode: "block", message: `the data-quality gate could not run (${error.message}) — nothing was changed; try again or check Data quality → Gate` }],
      };
    }
    return { ok: true, blocked: false, issues: [] }; // the gate never breaks a write path by itself
  }
  const res = data as DqGateResult;
  if (opts.strict && (res.errors ?? 0) > 0 && !res.blocked) {
    return {
      ...res, ok: false, blocked: true,
      issues: [...res.issues, { rule_code: "GATE", name: "Data-quality rule did not evaluate", severity: "error", field: null, mode: "block", message: `${res.errors} rule(s) could not be evaluated, so nothing was changed — see Data quality → Gate → log for the rule that failed` }],
    };
  }
  return res;
}

/** Field → messages, for inline form rendering. */
export function issuesByField(gate: DqGateResult): Record<string, { severity: string; mode: string; message: string; rule_code: string }[]> {
  const out: Record<string, { severity: string; mode: string; message: string; rule_code: string }[]> = {};
  for (const i of gate.issues) {
    const k = i.field ?? "_form";
    (out[k] ??= []).push({ severity: i.severity, mode: i.mode, message: i.message, rule_code: i.rule_code });
  }
  return out;
}
