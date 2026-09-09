// Data Quality — the gate, for every write path (server only).
//
//   const gate = await validateRow(sb, "cargo_listings", row, "forms", actor);
//   if (gate.blocked) → refuse; gate.issues carries the field messages
//
// The same rule definitions the batch audits run are evaluated on the unsaved
// row (fn_dq_validate). Block-mode rejections are logged to dq_gate_log.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DqChannel, DqGateResult } from "./types";

export async function validateRow(
  sb: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
  channel: DqChannel,
  actor?: { name?: string | null; id?: string | null },
  log = true,
): Promise<DqGateResult> {
  const { data, error } = await sb.rpc("fn_dq_validate", {
    p_table: table, p_row: row, p_channel: channel, p_actor: actor?.name ?? null, p_actor_id: actor?.id ?? null, p_log: log,
  });
  if (error) return { ok: true, blocked: false, issues: [] }; // the gate never breaks a write path by itself
  return data as DqGateResult;
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
