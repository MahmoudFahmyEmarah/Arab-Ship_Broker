-- ════════════════════════════════════════════════════════════════════════
-- Data Sync hardening · regate_sync_batch reports failure instead of
-- raising (18 Sep 2026, found by the phase-3 rollout)
--
-- The first version set the batch to 'gate_failed' and then RAISED — the
-- same flaw phase 0 fixed in commit_sync_batch: the raise rolls back the
-- status write, so a batch whose gate could not run stayed 'draft' and the
-- console never learned why. Now the function returns {ok:false, error}
-- after recording gate_failed, and the application reads ok. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.regate_sync_batch(p_batch_id uuid, p_channel text default 'sync', p_actor text default null)
 returns jsonb language plpgsql volatile security definer set search_path to ''
as $$
declare b public.sync_batch%rowtype; g jsonb; v_err text;
begin
  select * into b from public.sync_batch where id = p_batch_id for update;
  if not found then raise exception 'sync batch % not found', p_batch_id; end if;
  if b.status in ('committed', 'undone', 'committing') then
    raise exception 'BATCH_STATE: a % batch has nothing left to gate', b.status using errcode = '55000';
  end if;
  begin
    g := public.fn_dq_gate_batch(p_batch_id, p_channel, p_actor, null);
  exception when others then
    v_err := sqlerrm;
    -- the gate's own writes are rolled back by the exception block; this
    -- status write is OUTSIDE it, so it persists with the function's return
    update public.sync_batch set status = 'gate_failed', error = left('gate: ' || v_err, 2000) where id = p_batch_id;
    return jsonb_build_object('ok', false, 'error', v_err, 'blocked', 0, 'warned', 0, 'rules', 0, 'errors', jsonb_build_array(v_err));
  end;
  update public.sync_batch
     set counts = public.fn_sync_batch_recount(p_batch_id),
         status = case when b.status in ('draft', 'gated', 'gate_failed', 'failed') then 'gated' else b.status end,
         error  = null
   where id = p_batch_id;
  return g || jsonb_build_object('ok', true);
end $$;

revoke all on function public.regate_sync_batch(uuid, text, text) from public, anon, authenticated;
grant execute on function public.regate_sync_batch(uuid, text, text) to service_role;
