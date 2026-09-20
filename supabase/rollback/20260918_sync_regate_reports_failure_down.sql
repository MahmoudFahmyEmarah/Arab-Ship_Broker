-- DOWN for 20260918160000_sync_regate_reports_failure.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260918_sync_regate_reports_failure_down.sql
--   supabase migration repair --status reverted 20260918160000
-- Restores regate_sync_batch exactly as 20260918130000 (phase 3) defined it — the version that RAISES
-- GATE_FAILED after recording gate_failed (the status write is rolled back by the raise; that is the
-- behaviour 20260918160000 fixed). Roll back only together with a pre-160000 application.

create or replace function public.regate_sync_batch(p_batch_id uuid, p_channel text default 'sync', p_actor text default null)
 returns jsonb language plpgsql volatile security definer set search_path to ''
as $$
declare b public.sync_batch%rowtype; g jsonb;
begin
  select * into b from public.sync_batch where id = p_batch_id for update;
  if not found then raise exception 'sync batch % not found', p_batch_id; end if;
  if b.status in ('committed', 'undone', 'committing') then
    raise exception 'BATCH_STATE: a % batch has nothing left to gate', b.status using errcode = '55000';
  end if;
  begin
    g := public.fn_dq_gate_batch(p_batch_id, p_channel, p_actor, null);
  exception when others then
    update public.sync_batch set status = 'gate_failed', error = left('gate: ' || sqlerrm, 2000) where id = p_batch_id;
    raise exception 'GATE_FAILED: the data-quality gate could not run — %', sqlerrm using errcode = '55000';
  end;
  update public.sync_batch
     set counts = public.fn_sync_batch_recount(p_batch_id),
         status = case when b.status in ('draft', 'gated', 'gate_failed', 'failed') then 'gated' else b.status end,
         error  = null
   where id = p_batch_id;
  return g;
end $$;
revoke all on function public.regate_sync_batch(uuid, text, text) from public, anon, authenticated;
grant execute on function public.regate_sync_batch(uuid, text, text) to service_role;
