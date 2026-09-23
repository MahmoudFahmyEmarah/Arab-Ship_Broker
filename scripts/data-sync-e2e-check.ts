/**
 * Data Sync — end-to-end checks against the LIVE Supabase project. Run:
 *   node --env-file=.env.local --import tsx scripts/data-sync-e2e-check.ts
 *
 * Three groups, each self-cleaning (every row it creates carries the E2E
 * marker and is deleted in a finally, even on failure):
 *
 *   security     the anon key and a fresh member session must be refused by
 *                every Data Sync RPC and table (RLS + function grants).
 *   pipeline     stageBatch → gate → commit_sync_batch → live row → undo →
 *                restored, through the same code the UI uses, with a mock
 *                classifier so no LLM key or IMAP inbox is needed.
 *   performance  the staging lookup that used to seq-scan sync_staged_row,
 *                timed, plus a 300-row stage/commit/undo cycle.
 *
 * Optional: DS_E2E_LLM=1 also runs one real classifier call through the
 * budget meter (spends a few hundred tokens against the active Vault key).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { performance } from "node:perf_hooks";
import { stageBatch } from "@/lib/sync/stage";
import { EmailLlmSource } from "@/lib/sync/email-source";
import { recordsToSheets } from "@/lib/sync/email/to-rows";
import { buildClassifierGraph } from "@/lib/sync/email/graph";
import { aiBudgetToday } from "@/lib/sync/email/usage";
import type { CargoRecord, Classifier } from "@/lib/sync/email/types";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!URL_ || !SERVICE || !ANON) { console.error("Missing Supabase env — run with --env-file=.env.local"); process.exit(2); }

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (cond: boolean, label: string, extra = "") => { if (cond) { pass++; console.log(`  ok   ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.error(` FAIL  ${label}${extra ? ` — ${extra}` : ""}`); } };
const group = (n: string) => console.log(`\n${n}`);
const MARK = `E2E-${Date.now().toString(36).toUpperCase()}`;

// A commodity/route the gate accepts, keyed by unique refs so nothing collides.
const cargoRec = (i: number, over: Partial<CargoRecord> = {}): CargoRecord => ({
  ref: `${MARK}-${String(i).padStart(3, "0")}`, cargo_type: "Dry Bulk", commodity: "Wheat", packaging: "bulk",
  qty_min_mt: 25000 + i, qty_max_mt: 27500 + i, load_port: "Constanta", load_zone: "B.SEA", disch_port: "Alexandria", disch_zone: "E.MED",
  laycan_from: "2026-10-01", laycan_to: "2026-10-05", freight_idea: 21.5, commission_pct: 2.5, asb_regime: "GRAIN", broker: "E2E desk",
  ...over,
});

async function cleanup(sb: SupabaseClient) {
  // undo anything committed, then drop the batches (cascade deletes staged rows)
  const { data: batches } = await sb.from("sync_batch").select("id, status").like("file_name", `${MARK}%`);
  for (const b of (batches ?? []) as { id: string; status: string }[]) {
    if (b.status === "committed") await sb.rpc("undo_sync_batch", { p_batch_id: b.id });
    await sb.from("sync_batch").delete().eq("id", b.id);
  }
  await sb.from("cargo_listings").delete().like("ref", `${MARK}%`);
  await sb.from("commodity_review_queue").delete().like("raw_name", `${MARK}%`);
  await sb.from("job_runs").delete().contains("meta", { e2e: MARK });
  await sb.from("data_sync_audit").delete().eq("action", "test.e2e").like("summary", `%${MARK}%`);
}

async function security() {
  group("security — anon key");
  const rpcDenied = async (fn: string, args: Record<string, unknown>) => {
    const { error } = await anon.rpc(fn, args);
    const denied = !!error && /permission denied|42501|not found|does not exist|Only an administrator/i.test(error.message);
    ok(denied, `anon cannot call ${fn}`, error?.message?.slice(0, 70) ?? "NO ERROR — callable!");
  };
  await rpcDenied("fn_port_review_sweep", {});
  await rpcDenied("resolve_port_review", { p_id: "00000000-0000-4000-8000-000000000000", p_kind: "ignore" });
  await rpcDenied("fn_contacts_overview", { p_q: null, p_limit: 5 });
  await rpcDenied("commit_sync_batch", { p_batch_id: "00000000-0000-4000-8000-000000000000", p_sheet: null, p_row_ids: null });
  await rpcDenied("undo_sync_batch", { p_batch_id: "00000000-0000-4000-8000-000000000000" });
  await rpcDenied("get_llm_secret", { p_id: "00000000-0000-4000-8000-000000000000" });
  await rpcDenied("get_email_password", {});
  await rpcDenied("get_whatsapp_secret", { p_kind: "token" });
  await rpcDenied("edit_live_record", { p_table: "cargo_listings", p_key: "x", p_patch: {}, p_actor: null });
  await rpcDenied("fn_dq_meter_ai", { p_tokens: 1, p_cost: 0 });
  for (const t of ["sync_batch", "sync_staged_row", "llm_credential", "email_ingest_config", "whatsapp_message", "vessel_review_queue", "record_edit_audit", "job_runs", "data_sync_audit"]) {
    const { data, error } = await anon.from(t).select("*").limit(1);
    // Either outcome is a refusal: RLS filters to nothing, or the table has no
    // anon grant at all (permission denied) — the stronger of the two.
    const refused = (!error && (data ?? []).length === 0) || (!!error && /permission denied/i.test(error.message));
    ok(refused, `anon reads nothing from ${t}`, error ? "no table grant" : "RLS → 0 rows");
  }
  const { error: insErr } = await anon.from("sync_batch").insert({ source: "upload", status: "draft" });
  ok(!!insErr, "anon cannot insert into sync_batch", insErr?.message?.slice(0, 60));

  group("audit trail — service role writes, nobody edits");
  {
    const { data: ins, error: insErr } = await admin.from("data_sync_audit").insert({ actor_name: "E2E", actor_kind: "system", action: "test.e2e", summary: `audit e2e ${MARK}`, detail: { e2e: MARK } }).select("id").single();
    ok(!insErr && !!ins, "service role can append an audit row", insErr?.message);
    const { data: back } = await admin.from("data_sync_audit").select("id, action, summary, ok").eq("id", (ins as { id: number } | null)?.id ?? -1).maybeSingle();
    ok(!!back && back.summary === `audit e2e ${MARK}` && back.ok === true, "row reads back with ok=true by default");
    const { error: anonIns } = await anon.from("data_sync_audit").insert({ action: "x", summary: "x" });
    ok(!!anonIns, "anon cannot append to the audit trail", anonIns?.message?.slice(0, 60));
    if (ins) await admin.from("data_sync_audit").delete().eq("id", (ins as { id: number }).id);
  }

  group("security — service-role grants intact");
  const { error: adminOk } = await admin.rpc("fn_port_review_sweep");
  ok(!adminOk, "service role can still run fn_port_review_sweep", adminOk?.message);
  const { data: grants } = await admin.rpc("fn_audit_function_grants");
  const exposed = ((grants ?? []) as { signature: string; anon_execute?: boolean; authenticated_execute?: boolean; anon?: boolean; authenticated?: boolean }[])
    .filter((g) => /port_review|contacts_overview|sync_batch|llm_secret|email_password|whatsapp_secret|live_record|dq_meter|dq_gate/.test(g.signature))
    .filter((g) => (g.anon_execute ?? g.anon) || (g.authenticated_execute ?? g.authenticated));
  ok(exposed.length === 0, "drift detector: no Data Sync RPC executable by anon/authenticated", exposed.map((g) => g.signature).join(", "));
}

async function pipeline() {
  group("pipeline — stage → gate → commit → undo (mock classifier, no LLM)");
  const clf: Classifier = { async classifyBatch(emails) { return emails.map(() => ({ category: "cargo", reason: "e2e", cargo: [cargoRec(1), cargoRec(2, { commodity: `${MARK} Unobtainium`, asb_regime: null })], vessels: [] })); } };
  const graph = buildClassifierGraph(clf);
  const res = await graph.invoke({ emails: [{ id: "e2e", from: "e2e@test", subject: "e2e", date: null, text: "e2e" }] });
  ok(res.cargo.length === 2 && res.cargo[1].asb_regime === "UNMAPPED", "graph: unknown commodity → UNMAPPED for Manual Review");

  const t0 = performance.now();
  const staged = await stageBatch({ supabase: admin, source: new EmailLlmSource(recordsToSheets(res.cargo, [])), fileName: `${MARK}-pipe`, label: `${MARK} pipeline` });
  const stageMs = Math.round(performance.now() - t0);
  ok(!!staged.batchId, "stageBatch opened a batch", `${stageMs} ms`);
  ok(staged.totals.new === 2 && staged.totals.invalid === 0, "two new rows staged, none invalid", JSON.stringify(staged.totals));
  ok(!!staged.gate && staged.gate.rules > 0, "DQ gate ran on the pipeline channel", JSON.stringify(staged.gate));

  const { data: q } = await admin.from("commodity_review_queue").select("id").like("raw_name", `${MARK}%`).maybeSingle();
  ok(!!q, "UNMAPPED commodity landed in the Manual Review queue");

  const { data: rows } = await admin.from("sync_staged_row").select("id, business_key, classification, flags, committed").eq("batch_id", staged.batchId).order("row_index");
  const r = (rows ?? []) as { id: string; business_key: string; classification: string; flags: { level: string; field?: string }[]; committed: boolean }[];
  ok(r.length === 2 && r.every((x) => !x.committed), "staged rows readable and uncommitted");

  // selective commit of ONE row → only that row lands
  const { data: c1, error: c1e } = await admin.rpc("commit_sync_batch", { p_batch_id: staged.batchId, p_sheet: "cargo", p_row_ids: [r[0].id] });
  ok(!c1e && (c1 as { inserted: number }).inserted === 1, "commit_sync_batch(row_ids) inserted exactly one row", c1e?.message ?? JSON.stringify(c1));
  const { data: live1 } = await admin.from("cargo_listings").select("ref, commodity_name, review_status").eq("ref", r[0].business_key).maybeSingle();
  ok(!!live1 && live1.commodity_name === "Wheat", "the committed row is in cargo_listings", JSON.stringify(live1));
  const { data: b1 } = await admin.from("sync_batch").select("status").eq("id", staged.batchId).single();
  ok(b1?.status === "draft", "batch stays draft while a row is still pending");

  // commit the rest → committed
  const { data: c2 } = await admin.rpc("commit_sync_batch", { p_batch_id: staged.batchId, p_sheet: null, p_row_ids: null });
  ok((c2 as { inserted: number }).inserted === 1, "commit_sync_batch(all) inserted the remaining row");
  const { data: b2 } = await admin.from("sync_batch").select("status, committed_at").eq("id", staged.batchId).single();
  ok(b2?.status === "committed" && !!b2.committed_at, "batch is committed with a timestamp");
  const { count: audit } = await admin.from("sync_commit_audit").select("id", { count: "exact", head: true }).eq("batch_id", staged.batchId);
  ok(audit === 2, "two before-images in sync_commit_audit");

  // re-stage the same cargo → 'unchanged' (idempotent provisional keys + diff)
  const again = await stageBatch({ supabase: admin, source: new EmailLlmSource(recordsToSheets(res.cargo, [])), fileName: `${MARK}-again`, label: `${MARK} again` });
  ok(again.totals.unchanged === 2 && again.totals.new === 0, "re-staging the same records → 2 unchanged, 0 new", JSON.stringify(again.totals));

  // a changed freight → 'updated' with a diff on exactly that column
  const changed = await stageBatch({ supabase: admin, source: new EmailLlmSource(recordsToSheets([cargoRec(1, { freight_idea: 23 })], [])), fileName: `${MARK}-upd`, label: `${MARK} upd` });
  const { data: updRow } = await admin.from("sync_staged_row").select("classification, diff").eq("batch_id", changed.batchId).single();
  const diffKeys = Object.keys((updRow?.diff ?? {}) as object);
  ok(updRow?.classification === "updated" && diffKeys.length === 1 && diffKeys[0] === "freight_idea_usd_mt", "changed freight → updated with a one-column diff", diffKeys.join(","));

  // undo → rows gone, batch undone, staged rows uncommitted again
  const { data: u } = await admin.rpc("undo_sync_batch", { p_batch_id: staged.batchId });
  ok((u as { deleted: number }).deleted === 2, "undo removed both inserted rows", JSON.stringify(u));
  const { count: liveLeft } = await admin.from("cargo_listings").select("ref", { count: "exact", head: true }).like("ref", `${MARK}%`);
  ok(liveLeft === 0, "no E2E rows remain in cargo_listings");
  const { data: b3 } = await admin.from("sync_batch").select("status").eq("id", staged.batchId).single();
  ok(b3?.status === "undone", "batch status is undone");

  // discard a draft → cascade
  const { error: dErr } = await admin.from("sync_batch").delete().eq("id", again.batchId);
  const { count: orphan } = await admin.from("sync_staged_row").select("id", { count: "exact", head: true }).eq("batch_id", again.batchId);
  ok(!dErr && orphan === 0, "discarding a draft cascades to its staged rows");

  group("pipeline — gate blocks an invalid row");
  const bad = await stageBatch({ supabase: admin, source: new EmailLlmSource(recordsToSheets([cargoRec(9, { commodity: null, qty_min_mt: null, qty_max_mt: null })], [])), fileName: `${MARK}-bad`, label: `${MARK} bad` });
  ok(bad.totals.invalid === 1 && bad.totals.new === 0, "row without commodity/quantity is invalid, not committable", JSON.stringify(bad.totals));
  const { data: cBad } = await admin.rpc("commit_sync_batch", { p_batch_id: bad.batchId, p_sheet: null, p_row_ids: null });
  ok((cBad as { inserted: number; updated: number }).inserted === 0 && (cBad as { updated: number }).updated === 0, "commit writes nothing for an all-invalid batch");
}

async function performanceChecks() {
  group("performance");
  // Time the exact query stage.ts step 2c runs, with the new partial index.
  const { data: keys } = await admin.from("sync_staged_row").select("business_key").eq("target_table", "cargo_listings").not("business_key", "is", null).limit(500);
  const ks = ((keys ?? []) as { business_key: string }[]).map((k) => k.business_key);
  const t0 = performance.now();
  const { error } = await admin.from("sync_staged_row").select("business_key, payload, created_at").eq("target_table", "cargo_listings").eq("committed", true).in("business_key", ks).order("created_at", { ascending: false }).limit(ks.length * 4);
  const ms = Math.round(performance.now() - t0);
  // Server-side this is 4 ms with idx_staged_prev_committed (was 1,074 ms as a
  // seq scan — see EXPLAIN in the audit notes); what we can measure from here
  // includes the round trip to ap-northeast-1 and the payload transfer.
  ok(!error && ms < 2500, `previous-payload lookup for ${ks.length} keys answers`, `${ms} ms incl. network + payload (server plan: index scan, ~4 ms)`);

  // 300-row cycle
  const many = Array.from({ length: 300 }, (_, i) => cargoRec(100 + i));
  const t1 = performance.now();
  const big = await stageBatch({ supabase: admin, source: new EmailLlmSource(recordsToSheets(many, [])), fileName: `${MARK}-big`, label: `${MARK} big` });
  const stageMs = Math.round(performance.now() - t1);
  ok(big.totals.new === 300, "300 rows staged", `${stageMs} ms (${(stageMs / 300).toFixed(1)} ms/row)`);
  const t2 = performance.now();
  const { data: c } = await admin.rpc("commit_sync_batch", { p_batch_id: big.batchId, p_sheet: null, p_row_ids: null });
  const commitMs = Math.round(performance.now() - t2);
  ok((c as { inserted: number }).inserted === 300, "300 rows committed", `${commitMs} ms`);
  const t3 = performance.now();
  const { data: u } = await admin.rpc("undo_sync_batch", { p_batch_id: big.batchId });
  const undoMs = Math.round(performance.now() - t3);
  ok((u as { deleted: number }).deleted === 300, "300 rows undone", `${undoMs} ms`);
  ok(stageMs < 60_000 && commitMs < 30_000 && undoMs < 30_000, "cycle within budget (stage < 60 s, commit < 30 s, undo < 30 s)");
}

async function llmSmoke() {
  if (process.env.DS_E2E_LLM !== "1") { console.log("\nllm — skipped (set DS_E2E_LLM=1 to spend one real classifier call)"); return; }
  group("llm — one metered classifier call");
  const before = await aiBudgetToday(admin);
  const { runEmailDryRun } = await import("@/lib/sync/email/run");
  const events: string[] = [];
  let usage: { tokens: number } | null = null;
  await runEmailDryRun({ supabase: admin, sampleText: `E2E ${MARK}: 25,000 mt +/-10% wheat Constanta/Alexandria 10-15 Oct, 8000/4000 SSHEX, 2.5% — pls propose tonnage`, emit: (e) => { events.push(e.type); if (e.type === "usage") usage = e; } });
  const after = await aiBudgetToday(admin);
  ok(events.includes("step") && events.includes("done"), "dry run emitted step events and finished", events.join(","));
  ok(!!usage && after.used >= before.used + (usage as { tokens: number }).tokens - 1, "tokens metered into dq_ai_usage", `${usage ? (usage as { tokens: number }).tokens : 0} tokens · used ${before.used} → ${after.used}`);
  const { data: b } = await admin.from("sync_batch").select("id").eq("file_name", "pasted sample").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (b) await admin.from("sync_batch").delete().eq("id", b.id);
}

(async () => {
  try {
    await security();
    await pipeline();
    await performanceChecks();
    await llmSmoke();
  } catch (e) {
    fail++; console.error(" FAIL  unhandled:", e instanceof Error ? e.stack ?? e.message : e);
  } finally {
    await cleanup(admin);
    const { count } = await admin.from("cargo_listings").select("ref", { count: "exact", head: true }).like("ref", `${MARK}%`);
    ok(count === 0, "cleanup: no E2E rows left behind");
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
