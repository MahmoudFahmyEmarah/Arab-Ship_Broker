-- ---------------------------------------------------------------------------
-- Phase 1 smoke test — commit_sync_batch / undo_sync_batch mechanics.
--
-- Safe by construction: the whole script runs inside BEGIN … ROLLBACK, so it
-- writes a throwaway port (locode ZZTST) transiently and leaves the database
-- byte-for-byte as it found it. Run against a dev branch or local stack as the
-- database owner or service_role:
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/phase1_smoke.sql
--
-- Success prints: PHASE 1 SMOKE: ALL ASSERTIONS PASSED
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_batch1 uuid;
  v_batch2 uuid;
  v_res    jsonb;
  v_name   text;
  v_before jsonb;
  v_exists boolean;
begin
  -- guard: never run against a real ZZTST port
  if exists (select 1 from public.ports where locode = 'ZZTST') then
    raise exception 'ZZTST already exists — aborting to avoid clobbering real data';
  end if;

  -- ── Scenario 1 — insert a new row ───────────────────────────────────────
  insert into public.sync_batch (source, label, status)
    values ('upload','SMOKE', 'draft') returning id into v_batch1;

  insert into public.sync_staged_row
    (batch_id, sheet, target_table, key_column, business_key, classification, payload, row_index)
  values
    (v_batch1, '04_PORTS', 'ports', 'locode', 'ZZTST', 'new',
     jsonb_build_object('locode','ZZTST','trade_name','Test Port',
                        'country','Testland','zone','E.MED'), 1);

  v_res := public.commit_sync_batch(v_batch1);
  if v_res <> jsonb_build_object('inserted',1,'updated',0,'skipped',0) then
    raise exception 'S1 FAIL: unexpected commit result %', v_res;
  end if;

  select trade_name into v_name from public.ports where locode = 'ZZTST';
  if v_name is distinct from 'Test Port' then
    raise exception 'S1 FAIL: port not inserted (trade_name=%)', v_name;
  end if;

  if not exists (
    select 1 from public.sync_commit_audit
    where batch_id = v_batch1 and op = 'insert' and before is null and business_key = 'ZZTST'
  ) then raise exception 'S1 FAIL: insert audit row missing/incorrect'; end if;

  if not exists (
    select 1 from public.sync_batch where id = v_batch1 and status = 'committed'
  ) then raise exception 'S1 FAIL: batch not marked committed'; end if;
  raise notice 'S1 pass — insert + audit + batch status';

  -- ── Scenario 2 — partial, typed update ──────────────────────────────────
  insert into public.sync_batch (source, label, status)
    values ('upload','SMOKE2','draft') returning id into v_batch2;

  insert into public.sync_staged_row
    (batch_id, sheet, target_table, key_column, business_key, classification, payload,
     diff, row_index)
  values
    (v_batch2, '04_PORTS', 'ports', 'locode', 'ZZTST', 'updated',
     jsonb_build_object('locode','ZZTST','trade_name','Renamed'),
     jsonb_build_object('trade_name', jsonb_build_object('old','Test Port','new','Renamed')), 1);

  v_res := public.commit_sync_batch(v_batch2);
  if v_res <> jsonb_build_object('inserted',0,'updated',1,'skipped',0) then
    raise exception 'S2 FAIL: unexpected update result %', v_res;
  end if;

  select trade_name into v_name from public.ports where locode = 'ZZTST';
  if v_name is distinct from 'Renamed' then
    raise exception 'S2 FAIL: trade_name not updated (%)', v_name;
  end if;
  -- partial upsert must not touch other columns
  if (select country from public.ports where locode = 'ZZTST') is distinct from 'Testland' then
    raise exception 'S2 FAIL: partial upsert clobbered country';
  end if;

  select before into v_before from public.sync_commit_audit
    where batch_id = v_batch2 and op = 'update' and business_key = 'ZZTST';
  if v_before is null or v_before->>'trade_name' is distinct from 'Test Port' then
    raise exception 'S2 FAIL: update before-image wrong (%)', v_before;
  end if;
  raise notice 'S2 pass — partial update + before-image';

  -- ── Scenario 5 — undo restores update, then deletes insert ──────────────
  v_res := public.undo_sync_batch(v_batch2);
  if v_res <> jsonb_build_object('reverted',1,'deleted',0) then
    raise exception 'S5 FAIL: undo(batch2) result %', v_res;
  end if;
  select trade_name into v_name from public.ports where locode = 'ZZTST';
  if v_name is distinct from 'Test Port' then
    raise exception 'S5 FAIL: undo did not restore trade_name (%)', v_name;
  end if;

  v_res := public.undo_sync_batch(v_batch1);
  if v_res <> jsonb_build_object('reverted',0,'deleted',1) then
    raise exception 'S5 FAIL: undo(batch1) result %', v_res;
  end if;
  select exists(select 1 from public.ports where locode = 'ZZTST') into v_exists;
  if v_exists then raise exception 'S5 FAIL: undo did not delete inserted port'; end if;

  if not exists (select 1 from public.sync_batch where id = v_batch1 and status = 'undone')
     or not exists (select 1 from public.sync_batch where id = v_batch2 and status = 'undone') then
    raise exception 'S5 FAIL: batches not marked undone';
  end if;
  raise notice 'S5 pass — undo restore + delete + status';

  -- ── Scenario 8 — target table allow-list ────────────────────────────────
  begin
    insert into public.sync_batch (source, status) values ('upload','draft')
      returning id into v_batch1;
    insert into public.sync_staged_row
      (batch_id, sheet, target_table, key_column, business_key, classification, payload)
    values (v_batch1, 'X', 'users', 'id', '00000000-0000-0000-0000-000000000000', 'new',
            jsonb_build_object('id','00000000-0000-0000-0000-000000000000'));
    perform public.commit_sync_batch(v_batch1);
    raise exception 'S8 FAIL: commit to disallowed table did not raise';
  exception when others then
    if sqlerrm not like '%not permitted%' then
      raise exception 'S8 FAIL: wrong error: %', sqlerrm;
    end if;
  end;
  raise notice 'S8 pass — target table allow-list';

  raise notice 'PHASE 1 SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
