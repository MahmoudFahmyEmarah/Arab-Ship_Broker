"use server";

// Pre-submit data-quality check for the member forms (workstream E, 19 Sep 2026)
// and the refusal report (20 Sep 2026).
//
// Members post through RPCs; the database gate on the forms channel judges
// the row when it lands (shadow until enforced). validateMemberDraft lets the
// form ask FIRST, so a refusal is shown inline before the post instead of
// after it, with the same rule messages the Gate preview shows. It never
// logs, never blocks on its own: the form decides what to do with the answer.
//
// Every verdict carries a correlation id. When the post is then refused by
// the trigger (a DQ_GATE error), the trigger's own gate-log line is written
// inside the refused statement and rolls back with it — so the form reports
// the refusal afterwards through reportGateRefusal, a separate transaction
// tagged with that id. That line is the one that survives; nothing here
// claims the trigger's does.
//
// Callable by any signed-in member; validateMemberDraft evaluates only the
// draft the member sends and returns rule messages, nothing from the
// database; reportGateRefusal writes one gate-log line and returns nothing.

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DqGateResult } from "./types";

export type MemberDraftTable = "cargo_listings" | "vessel_availability" | "vessels";

export interface MemberDraftVerdict {
  /** the forms channel is enforcing: a block refuses the post */
  enforcing: boolean;
  blocked: boolean;
  /** rules that could not evaluate — under enforcement the post is refused */
  errors: number;
  issues: DqGateResult["issues"];
  /** quote it back in reportGateRefusal when the post is refused */
  correlation_id: string;
}

const TABLES: MemberDraftTable[] = ["cargo_listings", "vessel_availability", "vessels"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function validateMemberDraft(table: MemberDraftTable, row: Record<string, unknown>): Promise<{ ok: true; data: MemberDraftVerdict } | { ok: false; error: string }> {
  try {
    if (!TABLES.includes(table)) return { ok: false, error: "Unknown form." };
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to check a draft." };
    const sb = getSupabaseAdminClient();
    const [gate, settings] = await Promise.all([
      sb.rpc("fn_dq_validate", { p_table: table, p_row: row, p_channel: "forms", p_actor: user.email ?? null, p_actor_id: user.id, p_log: false }),
      sb.from("dq_settings").select("gate_forms_enforce").eq("id", 1).maybeSingle(),
    ]);
    if (gate.error) return { ok: false, error: gate.error.message };
    const g = gate.data as DqGateResult;
    return { ok: true, data: {
      enforcing: !!(settings.data as { gate_forms_enforce?: boolean } | null)?.gate_forms_enforce, blocked: !!g.blocked, errors: g.errors ?? 0, issues: g.issues ?? [],
      correlation_id: crypto.randomUUID(),
    } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The check could not run." };
  }
}

/** The rule code the trigger names in a refusal ("… (DQ-C05)"), when it names one. */
export async function refusalRuleCode(message: string): Promise<string> {
  const m = /\((DQ-[A-Z0-9-]+)\)/.exec(message);
  return m ? m[1] : "DQ_GATE";
}

/**
 * Record a refused publication attempt in its own transaction. Only the
 * signed-in member's own attempt, only a DQ_GATE refusal, never anything
 * from the database — and never thrown: a failed report must not hide the
 * refusal message from the member.
 */
export async function reportGateRefusal(table: MemberDraftTable, correlationId: string, message: string): Promise<{ ok: boolean }> {
  try {
    if (!TABLES.includes(table) || !UUID_RE.test(correlationId) || !/DQ_GATE/.test(message)) return { ok: false };
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false };
    const sb = getSupabaseAdminClient();
    const { error } = await sb.from("dq_gate_log").insert({
      channel: "forms", rule_code: await refusalRuleCode(message), table_name: table, row_key: null, actor: user.email ?? user.id, actor_id: user.id,
      mode: "block", message: message.slice(0, 500), correlation_id: correlationId,
    });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
