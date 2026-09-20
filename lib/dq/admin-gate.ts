// The admin channel's gate, for writes the database cannot judge by itself
// (21 Sep 2026).
//
// fn_dq_forms_gate judges an authenticated member's write and returns early
// for a service-role write that does not name a channel. Every admin console
// action runs on the service role, so a plain `.from(t).update(…)` there is
// judged by nothing at all — which is how Admin → Cargo and Admin → Vessel
// positions came to publish listings past the rules the review queue applies
// to the very same transition.
//
// Two RPCs already name the channel for themselves (edit_live_record and
// insert_live_record set dq.channel = 'admin'), and where a write can go
// through them it should. This helper is for the admin actions that update a
// row by id with a small patch of their own: it reads the row, judges the row
// that WOULD result, and hands the verdict back. The caller still performs
// its own write, so it can carry whatever precondition it needs.
//
//   strict: true   publication. A block-mode rule refuses, and so does a rule
//                  that could not be evaluated — nothing is published unjudged.
//   strict: false  the write is recorded and evaluated, never refused: the
//                  issues land in the gate log and the console shows them.
//                  For an edit that cannot put anything in front of members
//                  (registry metadata, a withdrawal).
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateRow } from "./gate";
import type { DqGateResult } from "./types";

export type AdminGateVerdict =
  | { ok: true; before: Record<string, unknown>; gate: DqGateResult }
  | { ok: false; error: string };

/** The issues that refused the write, in one line an administrator can act on. */
export function refusalText(gate: DqGateResult): string {
  const blocking = gate.issues.filter((i) => i.mode === "block").map((i) => `${i.rule_code} — ${i.message}`);
  return blocking.length ? blocking.join("; ") : "the data-quality gate blocked this row";
}

/**
 * Judge the row that `patch` would produce, on the admin channel.
 * Returns the row as it stands (so the caller can build a precondition) and
 * the verdict; or `ok: false` with a sentence to show, when the row cannot be
 * read or a strict gate refused it.
 */
export async function gateAdminEdit(
  sb: SupabaseClient,
  table: string,
  id: string,
  patch: Record<string, unknown>,
  actor: { id?: string | null; name?: string | null },
  opts: { strict: boolean; idColumn?: string; what?: string } = { strict: true },
): Promise<AdminGateVerdict> {
  const idColumn = opts.idColumn ?? "id";
  const what = opts.what ?? "record";
  const { data, error } = await sb.from(table).select("*").eq(idColumn, id).maybeSingle();
  if (error) return { ok: false, error: `the ${what} could not be read for the data-quality gate (${error.message}) — nothing was changed` };
  if (!data) return { ok: false, error: `that ${what} no longer exists — nothing was changed` };
  const before = data as Record<string, unknown>;
  const gate = await validateRow(sb, table, { ...before, ...patch }, "admin", actor, true, { strict: opts.strict });
  if (opts.strict && gate.blocked) {
    return { ok: false, error: `Data quality refused this change: ${refusalText(gate)}. Nothing was changed.` };
  }
  return { ok: true, before, gate };
}

/**
 * Judge a row that does not exist yet, on the admin channel. Same posture as
 * gateAdminEdit, without the read: there is nothing to merge into and nothing
 * to build a precondition from.
 */
export async function gateAdminInsert(
  sb: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
  actor: { id?: string | null; name?: string | null },
  opts: { strict: boolean; what?: string } = { strict: true },
): Promise<{ ok: true; gate: DqGateResult } | { ok: false; error: string }> {
  const gate = await validateRow(sb, table, row, "admin", actor, true, { strict: opts.strict });
  if (opts.strict && gate.blocked) {
    return { ok: false, error: `Data quality refused this new ${opts.what ?? "record"}: ${refusalText(gate)}. Nothing was created.` };
  }
  return { ok: true, gate };
}

/** What an action returns about the gate, so the console can show it. */
export function gateSummary(gate: DqGateResult): { blocked: boolean; errors: number; issues: number } {
  return { blocked: !!gate.blocked, errors: gate.errors ?? 0, issues: gate.issues.length };
}
