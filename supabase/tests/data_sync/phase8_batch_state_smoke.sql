-- Phase 8 (Data Sync hardening phase 2, 18 Sep 2026) — batch state machine
-- smoke test for 20260918120000_sync_phase2_batch_state_machine.sql.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/phase8_batch_state_smoke.sql
--
-- BEGIN … ROLLBACK: writes to ports transiently, leaves nothing behind. Run
-- as the database owner. Prints PHASE 8 SMOKE: ALL ASSERTIONS PASSED or
-- raises at the first failure.

begin;

do $$
declare
  v_batch uuid; v_row1 uuid; v_row2 uuid; v_res jsonb; v_status text; v_name text; v_n int; v_err text;
begin
  if exists (select 1 from public.ports where locode in ('ZZSM1', 'ZZSM2')) then
    raise exception 'ports ZZSM1/ZZSM2 exist — pick another test key';
  end if;

  -- a gated batch with two new ports
  insert into public.sync_batch (source, label, status) values ('upload', 'SMOKE-8', 'gated') returning id into v_batch;
  insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, row_index)
  values (v_batch, '04_PORTS', 'ports', 'locode', 'ZZSM1', 'new',
          jsonb_build_object('locode', 'ZZSM1', 'trade_name', 'Smoke One', 'country', 'Testland', 'zone', 'E.MED'), 1)
  returning id into v_row1;
  insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, row_index)
  values (v_batch, '04_PORTS', 'ports', 'locode', 'ZZSM2', 'new',
          jsonb_build_object('locode', 'ZZSM2', 'trade_name', 'Smoke Two', 'country', 'Testland', 'zone', 'E.MED'), 2)
  returning id into v_row2;
  -- phase 3 refuses rows the gate has not passed: gate the batch first
  perform public.regate_sync_batch(v_batch, 'sync', 'smoke');

  -- ── S1 · partial commit → 'partial' ──────────────────────────────────────
  v_res := public.commit_sync_batch(v_batch, null, array[v_row1]);
  if (v_res->>'inserted')::int <> 1 then raise exception 'S1: expected 1 inserted, got %', v_res; end if;
  select status into v_status from public.sync_batch where id = v_batch;
  if v_status <> 'partial' then raise exception 'S1: expected partial, got %', v_status; end if;

  -- ── S2 · discard is refused by the guard ─────────────────────────────────
  begin
    delete from public.sync_batch where id = v_batch;
    raise exception 'S2: discard of a partial batch was allowed';
  exception when others then
    v_err := sqlerrm;
    if v_err not like 'DISCARD_GUARD:%' then raise; end if;
  end;
  if not exists (select 1 from public.sync_commit_audit where batch_id = v_batch) then raise exception 'S2: audit trail lost'; end if;

  -- ── S3 · a second commit of the same rows writes nothing twice ───────────
  v_res := public.commit_sync_batch(v_batch, null, array[v_row1]);
  if (v_res->>'inserted')::int <> 0 or (v_res->>'updated')::int <> 0 then raise exception 'S3: re-commit wrote rows: %', v_res; end if;
  select count(*) into v_n from public.sync_commit_audit where batch_id = v_batch and undone_at is null;
  if v_n <> 1 then raise exception 'S3: expected 1 active audit row, got %', v_n; end if;

  -- ── S4 · the rest commits → 'committed' ──────────────────────────────────
  v_res := public.commit_sync_batch(v_batch);
  if (v_res->>'inserted')::int <> 1 then raise exception 'S4: expected 1 inserted, got %', v_res; end if;
  select status into v_status from public.sync_batch where id = v_batch;
  if v_status <> 'committed' then raise exception 'S4: expected committed, got %', v_status; end if;

  -- ── S5 · committing again is refused by the precondition ─────────────────
  begin
    perform public.commit_sync_batch(v_batch);
    raise exception 'S5: commit of a committed batch was allowed';
  exception when others then
    if sqlerrm not like 'BATCH_STATE:%' then raise; end if;
  end;

  -- ── S6 · a later edit makes undo report a conflict and touch nothing ─────
  update public.ports set trade_name = 'Smoke One (edited)' where locode = 'ZZSM1';
  v_res := public.undo_sync_batch(v_batch, false, 'smoke');
  if (v_res->>'ok')::boolean then raise exception 'S6: undo should have reported a conflict: %', v_res; end if;
  if jsonb_array_length(v_res->'conflicts') <> 1 then raise exception 'S6: expected 1 conflict, got %', v_res; end if;
  if (v_res->'conflicts'->0->'changed') <> '["trade_name"]'::jsonb then raise exception 'S6: conflict should name trade_name: %', v_res; end if;
  select trade_name into v_name from public.ports where locode = 'ZZSM1';
  if v_name <> 'Smoke One (edited)' then raise exception 'S6: undo touched the row'; end if;
  select status into v_status from public.sync_batch where id = v_batch;
  if v_status <> 'committed' then raise exception 'S6: status changed on a refused undo: %', v_status; end if;

  -- ── S7 · force undo restores, and records the override ───────────────────
  v_res := public.undo_sync_batch(v_batch, true, 'smoke');
  if not (v_res->>'ok')::boolean or (v_res->>'deleted')::int <> 2 or (v_res->>'forced')::int <> 1 then raise exception 'S7: unexpected result %', v_res; end if;
  if exists (select 1 from public.ports where locode in ('ZZSM1', 'ZZSM2')) then raise exception 'S7: inserted rows still present'; end if;
  select count(*) into v_n from public.sync_commit_audit where batch_id = v_batch and undone_at is not null and undo_conflict is not null;
  if v_n <> 1 then raise exception 'S7: the forced override should be recorded once, got %', v_n; end if;
  select status into v_status from public.sync_batch where id = v_batch;
  if v_status <> 'undone' then raise exception 'S7: expected undone, got %', v_status; end if;

  -- ── S8 · an undone batch cannot be committed again, nor discarded ────────
  begin
    perform public.commit_sync_batch(v_batch);
    raise exception 'S8: commit of an undone batch was allowed';
  exception when others then
    if sqlerrm not like 'BATCH_STATE:%' then raise; end if;
  end;
  begin
    delete from public.sync_batch where id = v_batch;
    raise exception 'S8: discard of an undone batch was allowed';
  exception when others then
    if sqlerrm not like 'DISCARD_GUARD:%' then raise; end if;
  end;

  -- ── S9 · a batch nothing was written from can be discarded ───────────────
  insert into public.sync_batch (source, label, status) values ('upload', 'SMOKE-8b', 'gated') returning id into v_batch;
  delete from public.sync_batch where id = v_batch;
  if exists (select 1 from public.sync_batch where id = v_batch) then raise exception 'S9: clean batch not discarded'; end if;

  -- ── S10 · gate_failed is refused ─────────────────────────────────────────
  insert into public.sync_batch (source, label, status) values ('upload', 'SMOKE-8c', 'gate_failed') returning id into v_batch;
  begin
    perform public.commit_sync_batch(v_batch);
    raise exception 'S10: commit of a gate_failed batch was allowed';
  exception when others then
    if sqlerrm not like 'BATCH_STATE:%' then raise; end if;
  end;

  raise notice 'PHASE 8 SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
