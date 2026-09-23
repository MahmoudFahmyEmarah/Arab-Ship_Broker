-- DOWN for 20260919150000_dq_f_performance.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260919_dq_f_down.sql
--   supabase migration repair --status reverted 20260919150000
-- Self-contained: every function body below is verbatim from the migration that last defined it.
-- History-bearing tables are renamed to *_bak_20260919150000, never dropped.
-- Deploy the pre-F application first (it calls the reservation functions).
-- Reservations are renamed, not dropped; the three-argument retention of workstream C comes back verbatim.
set local lock_timeout = '5s';
set local statement_timeout = '10min';

drop function if exists public.fn_dq_reserve_ai(integer, text, uuid, integer);
drop function if exists public.fn_dq_settle_ai(uuid, integer, numeric);
drop function if exists public.fn_dq_release_ai(uuid);
drop function if exists public.fn_dq_reclaim_ai();
drop function if exists public.fn_dq_open_by_severity(text);
drop function if exists public.fn_dq_retention(integer, integer, integer, integer);
do $$ begin
  if to_regclass('public.dq_ai_reservations') is not null then
    execute 'alter table public.dq_ai_reservations rename to dq_ai_reservations_bak_20260919150000';
-- the constraints (and their indexes) follow the table into the backup name, so nothing keeps the live name
alter table public.dq_ai_reservations_bak_20260919150000 rename constraint dq_ai_reservations_pkey to dq_ai_reservations_pkey_bak_20260919150000;
alter table public.dq_ai_reservations_bak_20260919150000 rename constraint dq_ai_reservations_idem_key_key to dq_ai_reservations_idem_key_key_bak_20260919150000;
alter table public.dq_ai_reservations_bak_20260919150000 rename constraint dq_ai_reservations_status_check to dq_ai_reservations_status_check_bak_20260919150000;
    execute 'alter table public.dq_ai_reservations_bak_20260919150000 disable row level security';
    execute 'revoke all on public.dq_ai_reservations_bak_20260919150000 from service_role';
  end if;
end $$;
drop index if exists public.dq_ai_reservations_open_idx;
alter table public.dq_settings drop constraint if exists dq_settings_ai_output_ck;
alter table public.dq_settings drop column if exists ai_max_output_tokens;
alter table public.dq_ai_usage drop column if exists reserved;
alter table public.dq_run_batches drop column if exists ai_state;
drop index if exists public.idx_trgm_dq_issues_row_label, public.idx_trgm_dq_issues_row_key, public.idx_trgm_dq_issues_rule_code, public.idx_trgm_dq_issues_field, public.idx_trgm_dq_issues_observed, public.dq_issues_rule_status_idx;
-- fn_dq_retention as of workstream C
CREATE OR REPLACE FUNCTION "public"."fn_dq_retention"("p_issue_days" integer DEFAULT 90, "p_gate_days" integer DEFAULT 30, "p_snapshot_days" integer DEFAULT 180) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare a int; b int; c int; d int; e int;
begin
  delete from public.dq_issues where status <> 'open' and coalesce(resolved_at, last_seen) < now() - make_interval(days => p_issue_days);
  get diagnostics a = row_count;
  delete from public.dq_gate_log where at < now() - make_interval(days => p_gate_days);
  get diagnostics b = row_count;
  delete from public.dq_health_snapshots where at < now() - make_interval(days => p_snapshot_days);
  get diagnostics c = row_count;
  delete from public.dq_run_rule_keys k using public.dq_runs r where r.id = k.run_id and r.status not in ('queued', 'running', 'paused') and coalesce(r.finished_at, r.created_at) < now() - interval '7 days';
  get diagnostics d = row_count;
  delete from public.dq_run_keys k using public.dq_runs r where r.id = k.run_id and r.status not in ('queued', 'running', 'paused') and coalesce(r.finished_at, r.created_at) < now() - interval '7 days';
  get diagnostics e = row_count;
  return jsonb_build_object('issues', a, 'gate_log', b, 'snapshots', c, 'run_keys', d + e);
end $$;
revoke all on function public.fn_dq_retention(integer, integer, integer) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_retention(integer, integer, integer) to service_role;
