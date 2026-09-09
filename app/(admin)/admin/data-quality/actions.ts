"use server";

// Admin → Data quality: server actions. Access model:
//   · section "dataquality" view  → read everything, run audits
//   · section "dataquality" edit  → rules, gate matrix, fixes, suggestions, settings, registry
// Every write runs on the service role after requireAdmin(); the browser never
// touches a dq_* table. Fixes go through dq_apply_fix (audited, gated, undoable).
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { canAccess } from "@/lib/admin/sections";
import { dqDb, getSettings, kickEngine, processOneBatch, STALL_MS } from "@/lib/dq/engine";
import type {
  DqChannel, DqDriftRow, DqGateLogRow, DqGateResult, DqHealthTile, DqIssue, DqIssueStatus, DqMode, DqPortException, DqRule, DqRuleVersion, DqRun,
  DqRunBatch, DqRunMode, DqScope, DqSettings, DqSuggestion, DqTableInfo,
} from "@/lib/dq/types";

type Result<T = undefined> = ({ success: true } & (T extends undefined ? object : { data: T })) | { success: false; error: string };
const fail = (e: unknown, fallback: string): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : fallback });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function gate(level: "view" | "edit") {
  const u = await requireAdmin({ section: "dataquality", edit: level === "edit" });
  return { sb: dqDb(), actor: u.rowId, actorName: u.fullName, tier: u.tier, canEdit: canAccess("dataquality", u.tier, u.perms) === "edit" };
}
const bust = () => revalidatePath("/admin/data-quality");

async function siteBase(): Promise<string> {
  if (process.env.DQ_ENGINE_URL) return process.env.DQ_ENGINE_URL.replace(/\/$/, "");
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

// ── bootstrap / overview ────────────────────────────────────────────────
export interface DqBootstrap {
  tables: DqTableInfo[]; settings: DqSettings; canEdit: boolean; viewerName: string; tier: string;
  activeModel: { vendor: string; model: string } | null; counts: { rules: number; openIssues: number; pendingSuggestions: number };
  activeRun: DqRun | null; aiToday: { tokens: number; cost: number };
}
export async function getDqBootstrap(): Promise<Result<DqBootstrap>> {
  try {
    const { sb, actorName, tier, canEdit } = await gate("view");
    const day = new Date().toISOString().slice(0, 10);
    const [tables, settings, cred, rules, issues, sugg, run, usage] = await Promise.all([
      sb.from("dq_tables").select("table_name, label, key_column, admin_href, sort_order").order("sort_order"),
      getSettings(sb),
      sb.from("llm_credential").select("vendor, model").eq("is_active", true).maybeSingle(),
      sb.from("dq_rules").select("id", { count: "exact", head: true }).is("deleted_at", null),
      sb.from("dq_issues").select("id", { count: "exact", head: true }).eq("status", "open"),
      sb.from("dq_ai_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending"),
      sb.from("dq_runs").select("*").in("status", ["running", "paused", "queued"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("dq_ai_usage").select("tokens, cost").eq("day", day).maybeSingle(),
    ]);
    return { success: true, data: {
      tables: (tables.data ?? []) as DqTableInfo[], settings, canEdit, viewerName: actorName, tier,
      activeModel: cred.data ? { vendor: String((cred.data as { vendor: string }).vendor), model: String((cred.data as { model: string }).model) } : null,
      counts: { rules: rules.count ?? 0, openIssues: issues.count ?? 0, pendingSuggestions: sugg.count ?? 0 },
      activeRun: (run.data as DqRun | null) ?? null,
      aiToday: { tokens: Number((usage.data as { tokens?: number } | null)?.tokens ?? 0), cost: Number((usage.data as { cost?: number } | null)?.cost ?? 0) },
    } };
  } catch (e) { return fail(e, "Could not load Data quality"); }
}

export interface DqOverview {
  health: DqHealthTile[];
  sev: { error: number; warn: number; info: number };
  checks: { label: string; n: number; source: string; severity: "error" | "warn" | "info"; table: string }[];
  lastRun: DqRun | null; previousRun: DqRun | null;
  changes: { kind: "new" | "fixed" | "regressed" | "rule"; title: string; meta: string; table?: string; view?: string; rule?: string }[];
  aiRules: number; aiFixes: number; noisyRules: { code: string; name: string; fp: number }[];
}
export async function getOverview(): Promise<Result<DqOverview>> {
  try {
    const { sb } = await gate("view");
    const since14 = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const [healthRes, snaps, sev, runs, sugg, flags, crq, vrq, sanctioned, syncFlags] = await Promise.all([
      sb.rpc("fn_dq_health"),
      sb.from("dq_health_snapshots").select("table_name, at, score").gte("at", since14).order("at"),
      sb.from("dq_issues").select("severity").eq("status", "open"),
      sb.from("dq_runs").select("*").in("status", ["completed", "failed", "cancelled"]).order("created_at", { ascending: false }).limit(2),
      sb.from("dq_ai_suggestions").select("kind").eq("status", "pending"),
      sb.from("v_vessel_flag_issues").select("*", { count: "exact", head: true }),
      sb.from("commodity_review_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
      sb.from("vessel_review_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
      sb.from("vessels").select("id", { count: "exact", head: true }).or("is_sanctioned.eq.true,risk_level.eq.HIGH"),
      sb.from("sync_staged_row").select("id", { count: "exact", head: true }).eq("classification", "invalid").eq("committed", false),
    ]);
    if (healthRes.error) throw new Error(healthRes.error.message);
    const trendBy = new Map<string, number[]>();
    for (const s of (snaps.data ?? []) as { table_name: string; score: number }[]) { const a = trendBy.get(s.table_name) ?? []; a.push(Number(s.score)); trendBy.set(s.table_name, a); }
    const health = ((healthRes.data ?? []) as Omit<DqHealthTile, "trend">[]).map((h) => {
      const t = (trendBy.get(h.table) ?? []).slice(-13); return { ...h, score: Number(h.score), trend: [...t, Number(h.score)] };
    });
    const counts = { error: 0, warn: 0, info: 0 };
    for (const r of (sev.data ?? []) as { severity: "error" | "warn" | "info" }[]) counts[r.severity] += 1;
    const [lastRun, previousRun] = ((runs.data ?? []) as DqRun[]);
    const cnt = async (rule: string) => { const { count } = await sb.from("dq_issues").select("id", { count: "exact", head: true }).eq("status", "open").eq("rule_code", rule); return count ?? 0; };
    const [a01, c05] = await Promise.all([cnt("DQ-A01"), cnt("DQ-C05")]);
    const checks: DqOverview["checks"] = [
      { label: "Positions without port or zone (cannot match)", n: a01, source: "vessel_availability · DQ-A01", severity: "error", table: "vessel_availability" },
      { label: "Commodities to map (Manual Review)", n: crq.count ?? 0, source: "commodity_review_queue", severity: "warn", table: "market_names" },
      { label: "Live cargo not resolved to a LOCODE", n: c05, source: "cargo_listings.load_port_locode is null · DQ-C05", severity: "error", table: "cargo_listings" },
      { label: "Vessels without IMO (Manual Review)", n: vrq.count ?? 0, source: "vessel_review_queue", severity: "warn", table: "vessels" },
      { label: 'Sync rows "Needs fixing" (uncommitted)', n: syncFlags.count ?? 0, source: "sync_staged_row.classification = invalid", severity: "error", table: "sync_staged_row" },
      { label: "Vessels with an unknown flag", n: flags.count ?? 0, source: "v_vessel_flag_issues", severity: "error", table: "vessels" },
      { label: "Sanctioned / high-risk vessels", n: sanctioned.count ?? 0, source: "vessels.is_sanctioned, risk_level", severity: "error", table: "vessels" },
    ];
    // what changed since the last completed run
    const changes: DqOverview["changes"] = [];
    if (lastRun?.finished_at) {
      const since = lastRun.finished_at;
      const [newIss, fixedIss, regress] = await Promise.all([
        sb.from("dq_issues").select("source", { count: "exact" }).eq("status", "open").gte("first_seen", since).limit(500),
        sb.from("dq_issues").select("reason", { count: "exact" }).eq("status", "fixed").gte("resolved_at", since).limit(500),
        sb.from("dq_issues").select("rule_code, table_name").eq("status", "open").gte("first_seen", since).eq("severity", "error").limit(500),
      ]);
      const ai = ((newIss.data ?? []) as { source: string }[]).filter((x) => x.source === "ai").length;
      if ((newIss.count ?? 0) > 0) changes.push({ kind: "new", title: `${newIss.count} new issue${newIss.count === 1 ? "" : "s"} since ${lastRun.code}`, meta: ai ? `${ai} found by AI review` : "raised by rules", view: "open" });
      const auto = ((fixedIss.data ?? []) as { reason: string | null }[]).filter((x) => x.reason?.startsWith("No longer")).length;
      if ((fixedIss.count ?? 0) > 0) changes.push({ kind: "fixed", title: `${fixedIss.count} issue${fixedIss.count === 1 ? "" : "s"} fixed`, meta: `${(fixedIss.count ?? 0) - auto} applied in the module · ${auto} fixed outside and cleared on re-check`, view: "fixed" });
      const byRule = new Map<string, { n: number; table: string }>();
      for (const r of (regress.data ?? []) as { rule_code: string; table_name: string }[]) { const c = byRule.get(r.rule_code) ?? { n: 0, table: r.table_name }; c.n += 1; byRule.set(r.rule_code, c); }
      for (const [code, c] of Array.from(byRule.entries()).sort((a, b) => b[1].n - a[1].n).slice(0, 2)) changes.push({ kind: "regressed", title: `${c.n} row${c.n === 1 ? "" : "s"} now fail ${code}`, meta: `on ${c.table} — new errors since the last run`, table: c.table, rule: code });
    }
    const { data: recentRules } = await sb.from("dq_rules").select("code, name, created_at").is("deleted_at", null).gte("created_at", since14).order("created_at", { ascending: false }).limit(2);
    for (const r of (recentRules ?? []) as { code: string; name: string }[]) changes.push({ kind: "rule", title: `New rule ${r.code}`, meta: r.name, rule: r.code });
    // noisy rules (false-positive rate > 10 %)
    const { data: fpRows } = await sb.from("dq_issues").select("rule_code, status").in("status", ["open", "fixed", "false_positive", "ignored", "escalated"]).limit(5000);
    const fpBy = new Map<string, { raised: number; fp: number }>();
    for (const r of (fpRows ?? []) as { rule_code: string; status: string }[]) { const c = fpBy.get(r.rule_code) ?? { raised: 0, fp: 0 }; c.raised += 1; if (r.status === "false_positive") c.fp += 1; fpBy.set(r.rule_code, c); }
    const { data: names } = await sb.from("dq_rules").select("code, name");
    const nameBy = new Map(((names ?? []) as { code: string; name: string }[]).map((r) => [r.code, r.name]));
    const noisyRules = Array.from(fpBy.entries()).filter(([, c]) => c.raised >= 5 && c.fp / c.raised > 0.1).map(([code, c]) => ({ code, name: nameBy.get(code) ?? code, fp: Math.round((c.fp / c.raised) * 100) }));
    const s = (sugg.data ?? []) as { kind: string }[];
    return { success: true, data: { health, sev: counts, checks, lastRun: lastRun ?? null, previousRun: previousRun ?? null, changes, aiRules: s.filter((x) => x.kind === "rule").length, aiFixes: s.filter((x) => x.kind === "fix").length, noisyRules } };
  } catch (e) { return fail(e, "Could not load the overview"); }
}

// ── rules ────────────────────────────────────────────────────────────────
export async function listRules(): Promise<Result<DqRule[]>> {
  try {
    const { sb } = await gate("view");
    const [rules, channels, stats, lastRun] = await Promise.all([
      sb.from("dq_rules").select("*").is("deleted_at", null).order("code"),
      sb.from("dq_rule_channels").select("rule_id, channel, mode"),
      sb.from("dq_issues").select("rule_code, status").limit(10000),
      sb.from("dq_runs").select("scope, total_rows, tables").eq("status", "completed").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (rules.error) throw new Error(rules.error.message);
    const chBy = new Map<string, Partial<Record<DqChannel, DqMode>>>();
    for (const c of (channels.data ?? []) as { rule_id: string; channel: DqChannel; mode: DqMode }[]) { const m = chBy.get(c.rule_id) ?? {}; m[c.channel] = c.mode; chBy.set(c.rule_id, m); }
    const st = new Map<string, { open: number; raised: number; fp: number }>();
    for (const i of (stats.data ?? []) as { rule_code: string; status: string }[]) { const s = st.get(i.rule_code) ?? { open: 0, raised: 0, fp: 0 }; s.raised += 1; if (i.status === "open") s.open += 1; if (i.status === "false_positive") s.fp += 1; st.set(i.rule_code, s); }
    const counts = new Map<string, number>();
    for (const c of ((lastRun.data as { scope?: DqScope } | null)?.scope?.counts ?? [])) counts.set(c.table, c.rows);
    const out = (rules.data as DqRule[]).map((r) => ({
      ...r, channels: chBy.get(r.id) ?? {},
      stats: { ...(st.get(r.code) ?? { open: 0, raised: 0, fp: 0 }), checked: r.tables.reduce((a, t) => a + (counts.get(t) ?? 0), 0) },
    }));
    return { success: true, data: out };
  } catch (e) { return fail(e, "Could not load rules"); }
}

export async function saveRule(rule: Partial<DqRule>, note?: string): Promise<Result<DqRule>> {
  try {
    const { sb, actor, actorName } = await gate("edit");
    const { data, error } = await sb.rpc("dq_save_rule", { p_rule: rule, p_actor: actor, p_actor_name: actorName, p_note: note ?? null });
    if (error) throw new Error(error.message);
    bust();
    return { success: true, data: data as DqRule };
  } catch (e) { return fail(e, "Could not save the rule"); }
}

export async function toggleRule(id: string, enabled: boolean): Promise<Result> {
  try {
    const { sb } = await gate("edit");
    if (!UUID_RE.test(id)) throw new Error("Invalid rule id");
    const { error } = await sb.from("dq_rules").update({ enabled }).eq("id", id);
    if (error) throw new Error(error.message);
    bust(); return { success: true };
  } catch (e) { return fail(e, "Could not update the rule"); }
}

export async function deleteRule(id: string, restore = false): Promise<Result> {
  try {
    const { sb } = await gate("edit");
    if (!UUID_RE.test(id)) throw new Error("Invalid rule id");
    const { error } = await sb.from("dq_rules").update({ deleted_at: restore ? null : new Date().toISOString(), enabled: false }).eq("id", id);
    if (error) throw new Error(error.message);
    bust(); return { success: true };
  } catch (e) { return fail(e, "Could not delete the rule"); }
}

export async function duplicateRule(id: string): Promise<Result<DqRule>> {
  try {
    const { sb, actor, actorName } = await gate("edit");
    const { data: src, error } = await sb.from("dq_rules").select("*").eq("id", id).single();
    if (error || !src) throw new Error("Rule not found");
    const r = src as DqRule;
    const { count } = await sb.from("dq_rules").select("id", { count: "exact", head: true }).like("code", `${r.code}-copy%`);
    const copy = { ...r, id: undefined, code: `${r.code}-copy${(count ?? 0) > 0 ? (count ?? 0) + 1 : ""}`, name: `${r.name} (copy)`, enabled: false, source: "admin", version: 0, owner: actorName };
    const { data, error: sErr } = await sb.rpc("dq_save_rule", { p_rule: copy, p_actor: actor, p_actor_name: actorName, p_note: `Duplicated from ${r.code}` });
    if (sErr) throw new Error(sErr.message);
    bust(); return { success: true, data: data as DqRule };
  } catch (e) { return fail(e, "Could not duplicate the rule"); }
}

export async function setChannelMode(ruleId: string, channel: DqChannel, mode: DqMode): Promise<Result> {
  try {
    const { sb, actor } = await gate("edit");
    const { error } = await sb.from("dq_rule_channels").upsert({ rule_id: ruleId, channel, mode, updated_by: actor, updated_at: new Date().toISOString() }, { onConflict: "rule_id,channel" });
    if (error) throw new Error(error.message);
    bust(); return { success: true };
  } catch (e) { return fail(e, "Could not change the channel mode"); }
}

export async function testRule(ruleId: string, table?: string | null, limit = 200): Promise<Result<{ rows: { table: string; key: string; label: string; field: string | null; observed: string | null; expected: string | null }[]; matches: number; checked: number; ms: number; cost: { table: string; total_cost?: string; node?: string; rows?: string; error?: string }[] }>> {
  try {
    const { sb } = await gate("view");
    const [prev, cost] = await Promise.all([
      sb.rpc("fn_dq_rule_preview", { p_rule_id: ruleId, p_table: table ?? null, p_limit: limit }),
      sb.rpc("fn_dq_rule_cost", { p_rule_id: ruleId }),
    ]);
    if (prev.error) throw new Error(prev.error.message);
    const p = prev.data as { rows: { table: string; key: string; label: string; field: string | null; observed: string | null; expected: string | null }[]; matches: number; checked: number; ms: number };
    return { success: true, data: { rows: p.rows ?? [], matches: p.matches ?? 0, checked: p.checked ?? 0, ms: p.ms ?? 0, cost: (cost.data ?? []) as { table: string; total_cost?: string; node?: string; rows?: string; error?: string }[] } };
  } catch (e) { return fail(e, "Test failed"); }
}

export async function getRuleVersions(ruleId: string): Promise<Result<DqRuleVersion[]>> {
  try {
    const { sb } = await gate("view");
    const { data, error } = await sb.from("dq_rule_versions").select("id, rule_id, version, snapshot, note, changed_by_name, changed_at").eq("rule_id", ruleId).order("version", { ascending: false }).limit(30);
    if (error) throw new Error(error.message);
    return { success: true, data: data as DqRuleVersion[] };
  } catch (e) { return fail(e, "Could not load versions"); }
}

export async function restoreRuleVersion(ruleId: string, version: number): Promise<Result<DqRule>> {
  try {
    const { sb, actor, actorName } = await gate("edit");
    const { data: v } = await sb.from("dq_rule_versions").select("snapshot").eq("rule_id", ruleId).eq("version", version).single();
    if (!v) throw new Error("Version not found");
    const snap = (v as { snapshot: Partial<DqRule> }).snapshot;
    const patch = { id: ruleId, name: snap.name, description: snap.description, category: snap.category, severity: snap.severity, kind: snap.kind, definition: snap.definition, checks: snap.checks, ai_prompt: snap.ai_prompt, tables: snap.tables, autofix: snap.autofix, enabled: snap.enabled };
    const { data, error } = await sb.rpc("dq_save_rule", { p_rule: patch, p_actor: actor, p_actor_name: actorName, p_note: `Restored v${version}` });
    if (error) throw new Error(error.message);
    bust(); return { success: true, data: data as DqRule };
  } catch (e) { return fail(e, "Could not restore the version"); }
}

export async function exportRulesJson(): Promise<Result<string>> {
  try {
    const { sb } = await gate("view");
    const [rules, channels] = await Promise.all([sb.from("dq_rules").select("*").is("deleted_at", null).order("code"), sb.from("dq_rule_channels").select("rule_id, channel, mode")]);
    return { success: true, data: JSON.stringify({ exported_at: new Date().toISOString(), dq_rules: rules.data, dq_rule_channels: channels.data }, null, 2) };
  } catch (e) { return fail(e, "Export failed"); }
}

export async function importWorkbookRules(): Promise<Result<{ inserted: number }>> {
  try {
    const { sb } = await gate("edit");
    const { data, error } = await sb.rpc("fn_dq_seed_rules");
    if (error) throw new Error(error.message);
    bust(); return { success: true, data: { inserted: Number(data ?? 0) } };
  } catch (e) { return fail(e, "Import failed"); }
}

// ── runs ─────────────────────────────────────────────────────────────────
export async function estimateScope(scope: DqScope, batch: number): Promise<Result<{ tables: { table: string; rows: number }[]; table_names: string[]; total_rows: number; batches: number }>> {
  try {
    const { sb } = await gate("view");
    const { data, error } = await sb.rpc("fn_dq_estimate_scope", { p_scope: scope, p_batch: batch });
    if (error) throw new Error(error.message);
    return { success: true, data: data as never };
  } catch (e) { return fail(e, "Could not estimate the scope"); }
}

export async function createRun(input: { scope: DqScope; mode: DqRunMode; batch: number; ruleIds: string[] | null; when: "now" | "nightly"; notify: boolean }): Promise<Result<DqRun>> {
  try {
    const { sb, actor, actorName } = await gate("view"); // every admin with access may run audits
    if (input.when === "nightly") {
      const { error } = await sb.from("dq_settings").update({ nightly_enabled: true, nightly_mode: input.mode, batch_size: input.batch, updated_at: new Date().toISOString() }).eq("id", 1);
      if (error) throw new Error(error.message);
      const { data, error: rErr } = await sb.from("dq_runs").insert({ scope: input.scope, mode: input.mode, batch_size: input.batch, rule_ids: input.ruleIds, status: "queued", trigger: "scheduler", started_by: actor, started_by_name: `${actorName} (scheduled)`, notify: input.notify, scheduled_for: nextNightly() }).select("*").single();
      if (rErr) throw new Error(rErr.message);
      bust(); return { success: true, data: data as DqRun };
    }
    const { data, error } = await sb.from("dq_runs").insert({ scope: input.scope, mode: input.mode, batch_size: Math.max(100, Math.min(5000, input.batch)), rule_ids: input.ruleIds, status: "queued", trigger: "admin", started_by: actor, started_by_name: actorName, notify: input.notify }).select("*").single();
    if (error) throw new Error(error.message);
    const run = data as DqRun;
    // first batch synchronously (instant feedback), the rest server-side
    const step = await processOneBatch(sb, run.id);
    if (!step.done) { const base = await siteBase(); after(() => kickEngine(run.id, base)); }
    const { data: fresh } = await sb.from("dq_runs").select("*").eq("id", run.id).single();
    bust(); return { success: true, data: (fresh ?? run) as DqRun };
  } catch (e) { return fail(e, "Could not start the run"); }
}

function nextNightly(): string {
  const d = new Date(); d.setUTCHours(22, 0, 0, 0); if (d.getTime() < Date.now()) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString();
}

/** Poll a run; if the server chain stalled, re-kick it (or step it once in dev). */
export async function tickRun(runId: string): Promise<Result<{ run: DqRun; batches: DqRunBatch[] }>> {
  try {
    const { sb } = await gate("view");
    const { data, error } = await sb.from("dq_runs").select("*").eq("id", runId).single();
    if (error || !data) throw new Error("Run not found");
    let run = data as DqRun;
    const last = run.last_batch_at ?? run.started_at ?? run.created_at;
    if (run.status === "running" && Date.now() - new Date(last).getTime() > STALL_MS) {
      const step = await processOneBatch(sb, run.id);
      if (!step.done) { const base = await siteBase(); after(() => kickEngine(run.id, base)); }
      const { data: fresh } = await sb.from("dq_runs").select("*").eq("id", runId).single();
      run = (fresh ?? run) as DqRun;
    }
    const { data: batches } = await sb.from("dq_run_batches").select("*").eq("run_id", runId).order("n");
    return { success: true, data: { run, batches: (batches ?? []) as DqRunBatch[] } };
  } catch (e) { return fail(e, "Could not read the run"); }
}

export async function controlRun(runId: string, action: "pause" | "resume" | "cancel"): Promise<Result<DqRun>> {
  try {
    const { sb } = await gate("view");
    const { data: cur } = await sb.from("dq_runs").select("status").eq("id", runId).single();
    const status = (cur as { status: string } | null)?.status;
    if (action === "pause") {
      if (status !== "running") throw new Error("Only a running run can be paused");
      await sb.from("dq_runs").update({ status: "paused" }).eq("id", runId);
    } else if (action === "cancel") {
      if (!["running", "paused", "queued"].includes(status ?? "")) throw new Error("This run is already finished");
      await sb.rpc("fn_dq_finish_run", { p_run_id: runId, p_status: "cancelled", p_error: null });
    } else {
      if (!["paused", "cancelled", "failed", "queued"].includes(status ?? "")) throw new Error("Nothing to resume");
      await sb.from("dq_runs").update({ status: status === "queued" ? "queued" : "paused", finished_at: null, trigger: "resume" }).eq("id", runId);
      const step = await processOneBatch(sb, runId);
      if (!step.done) { const base = await siteBase(); after(() => kickEngine(runId, base)); }
    }
    const { data } = await sb.from("dq_runs").select("*").eq("id", runId).single();
    bust(); return { success: true, data: data as DqRun };
  } catch (e) { return fail(e, "Could not control the run"); }
}

export async function listRuns(limit = 30): Promise<Result<DqRun[]>> {
  try {
    const { sb } = await gate("view");
    const { data, error } = await sb.from("dq_runs").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    return { success: true, data: data as DqRun[] };
  } catch (e) { return fail(e, "Could not load runs"); }
}

export async function getRunBatches(runId: string): Promise<Result<DqRunBatch[]>> {
  try {
    const { sb } = await gate("view");
    const { data, error } = await sb.from("dq_run_batches").select("*").eq("run_id", runId).order("n");
    if (error) throw new Error(error.message);
    return { success: true, data: data as DqRunBatch[] };
  } catch (e) { return fail(e, "Could not load batches"); }
}

// ── issues ───────────────────────────────────────────────────────────────
export interface IssueFilter { view?: "all" | "open" | "blocks" | "class" | "ai" | "fixed"; table?: string | null; rule?: string | null; severity?: string | null; q?: string | null; page?: number; pageSize?: number; sort?: "age" | "severity" | "rule" | "table" }
export async function listIssues(f: IssueFilter = {}): Promise<Result<{ rows: DqIssue[]; total: number; counts: { all: number; open: number; blocks: number; class: number; ai: number; fixed: number } }>> {
  try {
    const { sb } = await gate("view");
    const pageSize = Math.min(Math.max(f.pageSize ?? 25, 10), 200); const page = Math.max(f.page ?? 1, 1);
    let q = sb.from("dq_issues").select("*", { count: "exact" });
    if (f.table && f.table !== "all") q = q.eq("table_name", f.table);
    if (f.rule) q = q.eq("rule_code", f.rule);
    if (f.severity && f.severity !== "all") q = q.eq("severity", f.severity);
    if (f.view === "open") q = q.eq("status", "open");
    else if (f.view === "blocks") q = q.eq("status", "open").eq("severity", "error");
    else if (f.view === "class") q = q.eq("status", "open").eq("category", "classification");
    else if (f.view === "ai") q = q.eq("source", "ai");
    else if (f.view === "fixed") q = q.eq("status", "fixed");
    if (f.q) { const s = f.q.replace(/[,()%*\\]/g, " ").trim().slice(0, 60); if (s) q = q.or(`row_label.ilike.%${s}%,row_key.ilike.%${s}%,rule_code.ilike.%${s}%,field.ilike.%${s}%,observed.ilike.%${s}%`); }
    if (f.sort === "severity") q = q.order("severity", { ascending: true }).order("last_seen", { ascending: false });
    else if (f.sort === "rule") q = q.order("rule_code").order("last_seen", { ascending: false });
    else if (f.sort === "table") q = q.order("table_name").order("last_seen", { ascending: false });
    else q = q.order("status", { ascending: true }).order("first_seen", { ascending: false });
    const { data, error, count } = await q.range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    const t = f.table && f.table !== "all" ? f.table : null;
    const c = (filters: Record<string, string>) => { let b = sb.from("dq_issues").select("id", { count: "exact", head: true }); if (t) b = b.eq("table_name", t); for (const [k, v] of Object.entries(filters)) b = b.eq(k, v); return b; };
    const [all, open, blocks, cls, ai, fixed] = await Promise.all([
      c({}), c({ status: "open" }), c({ status: "open", severity: "error" }), c({ status: "open", category: "classification" }), c({ source: "ai" }), c({ status: "fixed" }),
    ]);
    return { success: true, data: { rows: data as DqIssue[], total: count ?? 0, counts: { all: all.count ?? 0, open: open.count ?? 0, blocks: blocks.count ?? 0, class: cls.count ?? 0, ai: ai.count ?? 0, fixed: fixed.count ?? 0 } } };
  } catch (e) { return fail(e, "Could not load issues"); }
}

export async function getIssue(id: string): Promise<Result<{ issue: DqIssue; live: Record<string, unknown> | null; related: DqIssue[]; rule: DqRule | null; ownerHref: string | null }>> {
  try {
    const { sb } = await gate("view");
    const { data, error } = await sb.from("dq_issues").select("*").eq("id", id).single();
    if (error || !data) throw new Error("Issue not found");
    const issue = data as DqIssue;
    const [live, related, rule, tinfo] = await Promise.all([
      sb.rpc("fn_dq_row_snapshot", { p_table: issue.table_name, p_key: issue.row_key }),
      sb.from("dq_issues").select("*").eq("table_name", issue.table_name).eq("row_key", issue.row_key).neq("id", id).order("status").limit(20),
      issue.rule_id ? sb.from("dq_rules").select("*").eq("id", issue.rule_id).maybeSingle() : Promise.resolve({ data: null }),
      sb.from("dq_tables").select("admin_href").eq("table_name", issue.table_name).maybeSingle(),
    ]);
    return { success: true, data: { issue, live: (live.data as Record<string, unknown> | null) ?? null, related: (related.data ?? []) as DqIssue[], rule: (rule.data as DqRule | null) ?? null, ownerHref: (tinfo.data as { admin_href: string | null } | null)?.admin_href ?? null } };
  } catch (e) { return fail(e, "Could not load the issue"); }
}

export async function setIssueStatus(ids: string[], status: DqIssueStatus, reason?: string): Promise<Result<{ updated: number }>> {
  try {
    const { sb, actor, actorName } = await gate("edit");
    if (!ids.length) throw new Error("Select at least one issue");
    const patch: Record<string, unknown> = { status, reason: reason ?? null };
    if (status === "open") Object.assign(patch, { resolved_at: null, resolved_by: null, resolved_by_name: null });
    else Object.assign(patch, { resolved_at: new Date().toISOString(), resolved_by: actor, resolved_by_name: actorName });
    const { data, error } = await sb.from("dq_issues").update(patch).in("id", ids.slice(0, 500)).select("id");
    if (error) throw new Error(error.message);
    bust(); return { success: true, data: { updated: (data ?? []).length } };
  } catch (e) { return fail(e, "Could not update the issues"); }
}

export async function applyFix(id: string, value?: string | null, field?: string | null): Promise<Result<{ audit_id: string | null; noop?: boolean }>> {
  try {
    const { sb, actor, actorName } = await gate("edit");
    const { data, error } = await sb.rpc("dq_apply_fix", { p_issue_id: id, p_actor: actor, p_actor_name: actorName, p_value: value ?? null, p_field: field ?? null });
    if (error) throw new Error(error.message);
    bust(); return { success: true, data: data as { audit_id: string | null; noop?: boolean } };
  } catch (e) { return fail(e, "Could not apply the fix"); }
}

export async function applyFixes(ids: string[], minConfidence?: number): Promise<Result<{ applied: number; skipped: number; errors: string[] }>> {
  try {
    const { sb, actor, actorName } = await gate("edit");
    const settings = await getSettings(sb);
    const threshold = minConfidence ?? Number(settings.auto_apply_threshold);
    const { data: rows } = await sb.from("dq_issues").select("id, fix, status, row_label").in("id", ids.slice(0, 500));
    let applied = 0, skipped = 0; const errors: string[] = [];
    for (const r of (rows ?? []) as { id: string; fix: { confidence?: number; value?: string | null } | null; status: string; row_label: string | null }[]) {
      if (r.status !== "open" || !r.fix || r.fix.value == null || Number(r.fix.confidence ?? 1) < threshold) { skipped += 1; continue; }
      const { error } = await sb.rpc("dq_apply_fix", { p_issue_id: r.id, p_actor: actor, p_actor_name: actorName, p_value: null, p_field: null });
      if (error) errors.push(`${r.row_label ?? r.id}: ${error.message}`); else applied += 1;
    }
    bust(); return { success: true, data: { applied, skipped, errors } };
  } catch (e) { return fail(e, "Could not apply the fixes"); }
}

export async function undoFix(id: string): Promise<Result> {
  try {
    const { sb, actor } = await gate("edit");
    const { error } = await sb.rpc("dq_undo_fix", { p_issue_id: id, p_actor: actor });
    if (error) throw new Error(error.message);
    bust(); return { success: true };
  } catch (e) { return fail(e, "Could not undo the fix"); }
}

export async function exportIssuesCsv(ids: string[] | null, f: IssueFilter = {}): Promise<Result<string>> {
  try {
    const { sb } = await gate("view");
    let q = sb.from("dq_issues").select("rule_code, table_name, row_label, row_key, field, observed, expected, severity, source, confidence, status, assignee, first_seen, why").order("first_seen", { ascending: false }).limit(5000);
    if (ids?.length) q = q.in("id", ids);
    else { if (f.table && f.table !== "all") q = q.eq("table_name", f.table); if (f.view === "open") q = q.eq("status", "open"); }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const cols = ["rule_code", "table_name", "row_label", "row_key", "field", "observed", "expected", "severity", "source", "confidence", "status", "assignee", "first_seen", "why"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return { success: true, data: [cols.join(","), ...((data ?? []) as Record<string, unknown>[]).map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") };
  } catch (e) { return fail(e, "Export failed"); }
}

// ── AI suggestions ───────────────────────────────────────────────────────
export async function listSuggestions(): Promise<Result<DqSuggestion[]>> {
  try {
    const { sb } = await gate("view");
    const { data, error } = await sb.from("dq_ai_suggestions").select("*").order("status").order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return { success: true, data: (data as DqSuggestion[]).map((s) => ({ ...s, evidence: Array.isArray(s.evidence) ? s.evidence : [] })) };
  } catch (e) { return fail(e, "Could not load suggestions"); }
}

export async function acceptSuggestion(id: string): Promise<Result<{ ruleCode?: string; applied?: number; skipped?: number; errors?: string[] }>> {
  try {
    const { sb, actor, actorName } = await gate("edit");
    const { data: s, error } = await sb.from("dq_ai_suggestions").select("*").eq("id", id).single();
    if (error || !s) throw new Error("Suggestion not found");
    const sg = s as DqSuggestion;
    if (sg.status !== "pending") throw new Error("Already resolved");
    if (sg.kind === "rule") {
      const { count } = await sb.from("dq_rules").select("id", { count: "exact", head: true }).like("code", "DQ-AI%").eq("source", "AI-suggested");
      const code = `DQ-AI${String((count ?? 0) + 3).padStart(2, "0")}`;
      const table = sg.tables[0] ?? "cargo_listings";
      const check = sg.sql ? { table, field: null, query_sql: sg.sql.replace(/;\s*$/, ""), expected_text: sg.nl.slice(0, 200) } : null;
      let rule: DqRule;
      try {
        const { data: r, error: rErr } = await sb.rpc("dq_save_rule", { p_rule: { code, name: sg.title, description: sg.nl, category: sg.category ?? "consistency", severity: sg.severity ?? "warn", kind: check ? "sql" : "ai", definition: sg.sql ?? sg.nl, checks: check ? [check] : [], ai_prompt: check ? null : sg.nl, tables: [table], autofix: "none", enabled: false, source: "AI-suggested" }, p_actor: actor, p_actor_name: actorName, p_note: `Accepted from AI suggestion ${sg.id}` });
        if (rErr) throw new Error(rErr.message);
        rule = r as DqRule;
      } catch (e) {
        // the SQL did not compile — keep the natural-language form as an AI-assisted draft
        const { data: r, error: rErr } = await sb.rpc("dq_save_rule", { p_rule: { code, name: sg.title, description: sg.nl, category: sg.category ?? "consistency", severity: sg.severity ?? "warn", kind: "ai", definition: `${sg.sql ?? ""}\n-- did not compile: ${e instanceof Error ? e.message : String(e)}`.trim(), checks: [], ai_prompt: sg.nl, tables: [table], autofix: "none", enabled: false, source: "AI-suggested" }, p_actor: actor, p_actor_name: actorName, p_note: `Accepted from AI suggestion ${sg.id} (SQL kept as note)` });
        if (rErr) throw new Error(rErr.message);
        rule = r as DqRule;
      }
      await sb.from("dq_ai_suggestions").update({ status: "accepted", accepted_rule_id: rule.id, resolved_at: new Date().toISOString(), resolved_by: actor, resolved_by_name: actorName }).eq("id", id);
      bust(); return { success: true, data: { ruleCode: rule.code } };
    }
    const res = await applyFixes(sg.issue_ids, 0);
    if (!res.success) throw new Error(res.error);
    await sb.from("dq_ai_suggestions").update({ status: "accepted", resolved_at: new Date().toISOString(), resolved_by: actor, resolved_by_name: actorName, reason: `${res.data.applied} applied · ${res.data.skipped} skipped` }).eq("id", id);
    bust(); return { success: true, data: res.data };
  } catch (e) { return fail(e, "Could not accept the suggestion"); }
}

export async function dismissSuggestion(id: string, reason: string): Promise<Result> {
  try {
    const { sb, actor, actorName } = await gate("edit");
    const { error } = await sb.from("dq_ai_suggestions").update({ status: "dismissed", reason: reason || "not needed", resolved_at: new Date().toISOString(), resolved_by: actor, resolved_by_name: actorName }).eq("id", id).eq("status", "pending");
    if (error) throw new Error(error.message);
    bust(); return { success: true };
  } catch (e) { return fail(e, "Could not dismiss the suggestion"); }
}

export async function approveAllFixes(): Promise<Result<{ applied: number; skipped: number; errors: string[]; suggestions: number }>> {
  try {
    const { sb, actor, actorName } = await gate("edit");
    const settings = await getSettings(sb);
    const { data } = await sb.from("dq_ai_suggestions").select("id, issue_ids, confidence").eq("kind", "fix").eq("status", "pending").gte("confidence", Number(settings.auto_apply_threshold));
    let applied = 0, skipped = 0; const errors: string[] = [];
    for (const s of (data ?? []) as { id: string; issue_ids: string[] }[]) {
      const r = await applyFixes(s.issue_ids); if (!r.success) { errors.push(r.error); continue; }
      applied += r.data.applied; skipped += r.data.skipped; errors.push(...r.data.errors);
      await sb.from("dq_ai_suggestions").update({ status: "accepted", resolved_at: new Date().toISOString(), resolved_by: actor, resolved_by_name: actorName, reason: `bulk approve · ${r.data.applied} applied` }).eq("id", s.id);
    }
    bust(); return { success: true, data: { applied, skipped, errors, suggestions: (data ?? []).length } };
  } catch (e) { return fail(e, "Bulk approval failed"); }
}

// ── gate ─────────────────────────────────────────────────────────────────
export async function listGateLog(f: { channel?: string | null; q?: string | null; days?: number } = {}): Promise<Result<{ rows: DqGateLogRow[]; total24h: number; formsShare: number }>> {
  try {
    const { sb } = await gate("view");
    const since = new Date(Date.now() - (f.days ?? 1) * 86_400_000).toISOString();
    let q = sb.from("dq_gate_log").select("*").gte("at", since).order("at", { ascending: false }).limit(300);
    if (f.channel && f.channel !== "all") q = q.eq("channel", f.channel);
    if (f.q) { const s = f.q.replace(/[,()%*\\]/g, " ").trim().slice(0, 60); if (s) q = q.or(`rule_code.ilike.%${s}%,actor.ilike.%${s}%,message.ilike.%${s}%`); }
    const [{ data, error }, day] = await Promise.all([q, sb.from("dq_gate_log").select("channel").gte("at", new Date(Date.now() - 86_400_000).toISOString())]);
    if (error) throw new Error(error.message);
    const d = (day.data ?? []) as { channel: string }[];
    return { success: true, data: { rows: data as DqGateLogRow[], total24h: d.length, formsShare: d.length ? Math.round((d.filter((x) => x.channel === "forms").length / d.length) * 100) : 0 } };
  } catch (e) { return fail(e, "Could not load the gate log"); }
}

/** Form-time validation of a draft row (the same rules, channel-aware). */
export async function validateDraft(table: string, row: Record<string, unknown>, channel: DqChannel = "forms"): Promise<Result<DqGateResult>> {
  try {
    const { sb, actorName, actor } = await gate("view");
    const { data, error } = await sb.rpc("fn_dq_validate", { p_table: table, p_row: row, p_channel: channel, p_actor: actorName, p_actor_id: actor, p_log: false });
    if (error) throw new Error(error.message);
    return { success: true, data: data as DqGateResult };
  } catch (e) { return fail(e, "Validation failed"); }
}

// ── ports registry ───────────────────────────────────────────────────────
export async function getPortsRegistry(): Promise<Result<{ settings: Pick<DqSettings, "registry_release" | "registry_imported_at">; drift: DqDriftRow[]; exceptions: DqPortException[]; stats: { ports: number; adopted: number; requested: number; absent: number; registry: number; registryCountries: number } }>> {
  try {
    const { sb } = await gate("view");
    const [settings, drift, exc, ports, reg] = await Promise.all([
      getSettings(sb), sb.rpc("fn_dq_port_drift"), sb.from("dq_port_exceptions").select("*").order("requested_at", { ascending: false }),
      sb.from("ports").select("locode, unlocode_status"), sb.from("unlocode_registry").select("country", { count: "exact" }).limit(20000),
    ]);
    if (drift.error) throw new Error(drift.error.message);
    const p = (ports.data ?? []) as { unlocode_status: string | null }[];
    const countries = new Set(((reg.data ?? []) as { country: string }[]).map((x) => x.country));
    return { success: true, data: {
      settings: { registry_release: settings.registry_release, registry_imported_at: settings.registry_imported_at },
      drift: (drift.data ?? []) as DqDriftRow[], exceptions: (exc.data ?? []) as DqPortException[],
      stats: { ports: p.length, adopted: p.filter((x) => x.unlocode_status?.startsWith("A")).length, requested: p.filter((x) => x.unlocode_status && /^R/.test(x.unlocode_status)).length, absent: p.filter((x) => !x.unlocode_status).length, registry: reg.count ?? 0, registryCountries: countries.size },
    } };
  } catch (e) { return fail(e, "Could not load the ports registry"); }
}

export async function savePortException(locode: string, reason: string, action: "request" | "approve" | "reject"): Promise<Result> {
  try {
    const { sb, actor, actorName } = await gate("edit");
    const code = locode.trim().toUpperCase();
    if (!/^[A-Z]{2}[A-Z2-9]{3}$/.test(code)) throw new Error("A 5-character LOCODE is required");
    if (action === "request") {
      if (!reason.trim()) throw new Error("A reason is required");
      const { error } = await sb.from("dq_port_exceptions").upsert({ locode: code, reason: reason.trim(), requested_by: actor, requested_by_name: actorName, requested_at: new Date().toISOString(), status: "pending", approved_by: null, approved_by_name: null, approved_at: null });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb.from("dq_port_exceptions").update({ status: action === "approve" ? "approved" : "rejected", approved_by: actor, approved_by_name: actorName, approved_at: new Date().toISOString() }).eq("locode", code);
      if (error) throw new Error(error.message);
    }
    bust(); return { success: true };
  } catch (e) { return fail(e, "Could not save the exception"); }
}

// ── settings ─────────────────────────────────────────────────────────────
export async function saveSettings(patch: Partial<DqSettings>): Promise<Result<DqSettings>> {
  try {
    const { sb, actor } = await gate("edit");
    const allowed: (keyof DqSettings)[] = ["batch_size", "ai_sample", "ai_daily_tokens", "ai_price_per_mtok", "auto_apply_threshold", "weights", "nightly_enabled", "nightly_time", "nightly_mode", "notify"];
    const clean: Record<string, unknown> = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    if (typeof clean.batch_size === "number") clean.batch_size = Math.max(100, Math.min(5000, clean.batch_size));
    if (typeof clean.ai_sample === "number") clean.ai_sample = Math.max(5, Math.min(200, clean.ai_sample));
    const cur = await getSettings(sb);
    const { data, error } = await sb.from("dq_settings").update({ ...clean, version: cur.version + 1, updated_by: actor, updated_at: new Date().toISOString() }).eq("id", 1).select("*").single();
    if (error) throw new Error(error.message);
    bust(); return { success: true, data: data as DqSettings };
  } catch (e) { return fail(e, "Could not save settings"); }
}
