/**
 * Inbox cron mechanics — arms a due schedule, calls /api/cron/email-sync on a running
 * server (BASE, default localhost:3000) with the bearer, verifies job_runs + audit +
 * next_run_at advanced, then restores email_ingest_config exactly. Run:
 *   node --env-file=.env.local --import tsx scripts/email-cron-check.ts
 */
// Arms a due schedule, calls the cron on the dev server, verifies job_runs +
// audit + next_run_at advanced, then restores the config exactly as it was.
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const ok = (c: boolean, l: string, x = "") => console.log(`${c ? "  ok  " : " FAIL "} ${l}${x ? ` — ${x}` : ""}`);
(async () => {
  const { data: before } = await sb.from("email_ingest_config").select("is_enabled, schedule_enabled, schedule_kind, schedule_hour_utc, next_run_at, last_scheduled_run_at").eq("only_one", true).single();
  const t0 = new Date().toISOString();
  try {
    // 1 · not due → skipped
    await sb.from("email_ingest_config").update({ is_enabled: true, schedule_enabled: true, schedule_kind: "daily", schedule_hour_utc: 2, next_run_at: new Date(Date.now() + 3600_000).toISOString() }).eq("only_one", true);
    let r = await fetch(`${process.env.BASE ?? "http://localhost:3000"}/api/cron/email-sync`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    let j = await r.json();
    ok(r.status === 200 && j.skipped === "not due", "future next_run_at → skipped: not due", JSON.stringify(j));
    // 2 · due → runs (no inbox password here, so the run fails fast) and advances
    await sb.from("email_ingest_config").update({ next_run_at: new Date(Date.now() - 60_000).toISOString() }).eq("only_one", true);
    r = await fetch(`${process.env.BASE ?? "http://localhost:3000"}/api/cron/email-sync`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    j = await r.json();
    ok(r.status === 200 && j.skipped === undefined, "past next_run_at → the cron ran", `${JSON.stringify(j).slice(0, 160)}`);
    const { data: after } = await sb.from("email_ingest_config").select("next_run_at, last_scheduled_run_at").eq("only_one", true).single();
    ok(!!after?.next_run_at && new Date(after.next_run_at).getTime() > Date.now(), "next_run_at advanced into the future", after?.next_run_at ?? "");
    ok(!!after?.last_scheduled_run_at && after.last_scheduled_run_at >= t0, "last_scheduled_run_at stamped", after?.last_scheduled_run_at ?? "");
    const { data: jr } = await sb.from("job_runs").select("id, status, error, trigger, meta").eq("job", "email-sync").gte("started_at", t0).order("started_at", { ascending: false }).limit(1).maybeSingle();
    ok(!!jr && jr.status !== "running", "job_runs row settled", `${jr?.status} · ${jr?.error ?? ""} · trigger ${jr?.trigger}`);
    const { data: au } = await sb.from("data_sync_audit").select("id, actor_kind, actor_name, action, ok, summary, ip").eq("action", "run.email.cron").gte("at", t0).order("id", { ascending: false }).limit(1).maybeSingle();
    ok(!!au && au.actor_kind === "cron", "audit row written by actor kind cron", `${au?.actor_name} · ok=${au?.ok} · ${au?.summary} · ip ${au?.ip}`);
    // cleanup of the rows this test produced
    if (jr) await sb.from("job_runs").delete().eq("id", jr.id);
    if (au) await sb.from("data_sync_audit").delete().eq("id", au.id);
  } finally {
    await sb.from("email_ingest_config").update({ is_enabled: before?.is_enabled ?? false, schedule_enabled: before?.schedule_enabled ?? false, schedule_kind: before?.schedule_kind ?? "daily", schedule_hour_utc: before?.schedule_hour_utc ?? 2, next_run_at: before?.next_run_at ?? null, last_scheduled_run_at: before?.last_scheduled_run_at ?? null }).eq("only_one", true);
    const { data: restored } = await sb.from("email_ingest_config").select("is_enabled, schedule_enabled, next_run_at").eq("only_one", true).single();
    ok(restored?.is_enabled === (before?.is_enabled ?? false) && restored?.schedule_enabled === (before?.schedule_enabled ?? false), "config restored exactly", JSON.stringify(restored));
  }
})();
