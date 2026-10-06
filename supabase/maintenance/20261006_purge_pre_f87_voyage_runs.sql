-- Stream S · one-off purge of saved voyage estimates that carry a person's id inside their sealed snapshots
-- (C2O-050 #6). Saves before f87a560 stamped manual values with the actor's user id; from f87a560 on they name
-- the run's own actor column ("run-actor"), so deleting the user leaves no identifier behind.
--
-- These runs exist only on TEST databases (shared local, isolated proofs, staging): Stream S has never been
-- applied to production. Before the release the owner checks production with the count query at the bottom
-- (it must be 0, or the tables do not exist yet). The runs are immutable by design and sealed by SHA-256, so
-- they cannot be rewritten in place; they are deleted, with their lines.
--
-- Run as ONE transaction, with the acknowledgement in the same session:
--   psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -1 \
--     -c "select set_config('asb.voyage_purge', 'test-data-only', false)" \
--     -f supabase/maintenance/20261006_purge_pre_f87_voyage_runs.sql
savepoint purge_requires_a_transaction;
release savepoint purge_requires_a_transaction;

do $purge$
declare v_n integer; v_ack text := coalesce(current_setting('asb.voyage_purge', true), '');
begin
  perform set_config('asb.voyage_purge', '', false);   -- spent here
  if to_regclass('public.voyage_estimate_runs') is null then raise notice 'no voyage_estimate_runs table: nothing to purge'; return; end if;
  create temp table purge_runs on commit drop as
    select r.id from public.voyage_estimate_runs r
     where concat_ws(' ', r.fuel_index_snapshot::text, r.route_eca_snapshot::text, r.suez_cost_snapshot::text, r.port_cost_snapshot::text, r.input_snapshot::text, r.result_snapshot::text)
           ~ '"actorUserId": *"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"';
  select count(*) into v_n from purge_runs;
  if v_n = 0 then raise notice 'no run carries a person''s id in its snapshots'; return; end if;
  if v_ack <> 'test-data-only' then
    raise exception 'VOYAGE_PURGE_REFUSED: % run(s) carry a person''s id in their snapshots. This is a test-database purge: set asb.voyage_purge = ''test-data-only'' in this session and rerun.', v_n using errcode = '55000';
  end if;
  alter table public.voyage_estimate_lines disable trigger trg_voyage_lines_immutable;
  alter table public.voyage_estimate_runs disable trigger trg_voyage_run_immutable;
  delete from public.voyage_estimate_lines where run_id in (select id from purge_runs);
  delete from public.voyage_estimate_runs where id in (select id from purge_runs);
  alter table public.voyage_estimate_runs enable trigger trg_voyage_run_immutable;
  alter table public.voyage_estimate_lines enable trigger trg_voyage_lines_immutable;
  if to_regclass('public.schema_rollback_evidence') is not null then
    insert into public.schema_rollback_evidence (module, db_user, confirmation, used_state)
    values ('stream-s-purge-pre-f87-runs', session_user, 'test-data-only', jsonb_build_object('deletedRuns', v_n, 'at', now()));
  end if;
  raise notice 'purged % pre-f87 run(s) and their lines', v_n;
end
$purge$;

-- Production pre-release check (read-only; the owner runs it): must return 0 or "relation does not exist".
-- select count(*) from public.voyage_estimate_runs r
--  where concat_ws(' ', r.fuel_index_snapshot::text, r.route_eca_snapshot::text, r.suez_cost_snapshot::text, r.port_cost_snapshot::text, r.input_snapshot::text, r.result_snapshot::text)
--        ~ '"actorUserId": *"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"';
