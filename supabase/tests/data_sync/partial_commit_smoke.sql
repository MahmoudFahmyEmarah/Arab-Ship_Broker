-- Data Sync hardening — partial-commit behavioural test for
-- 20260920110000_sync_commit_serialization.sql (20 Sep 2026).
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/partial_commit_smoke.sql
--   supabase db query --local  --file supabase/tests/data_sync/partial_commit_smoke.sql
--
-- BEGIN … ROLLBACK: writes to ports transiently, leaves nothing behind.
-- Prints PARTIAL COMMIT SMOKE: ALL ASSERTIONS PASSED or raises.
--   S1  9 valid + 1 blocked → 9 committed, status partial, remaining says so
--   S2  the blocked row stays uncommitted and editable
--   S3  fix + re-gate + commit the last row → committed
--   S4  transitions gated → partial → committed
--   S5  undo from partial restores and marks the batch undone
--   S6  a whole-batch commit with blocked rows says "partial", never "committed"

begin;

do $$
declare
  v_batch uuid; v_res jsonb; v_status text; v_n int; v_row10 uuid; v_ids uuid[] := '{}'; i int; v_key text;
  v_ver timestamptz := public.fn_dq_rules_version();
begin
  if exists (select 1 from public.ports where locode like 'ZZPC_' or locode = 'ZZPCX') then
    raise exception 'ports ZZPC* exist — pick another test key';
  end if;

  insert into public.sync_batch (source, label, status) values ('upload', 'SMOKE-PARTIAL', 'gated') returning id into v_batch;
  for i in 1..9 loop
    v_key := 'ZZPC' || i;
    insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, row_index,
                                        gate_status, gate_payload_hash, gate_rules_version, gated_at)
    select v_batch, '04_PORTS', 'ports', 'locode', v_key, 'new', p, i, 'ok', md5(p::text), v_ver, now()
      from (select jsonb_build_object('locode', v_key, 'trade_name', 'Partial ' || i, 'country', 'Testland', 'zone', 'E.MED') as p) x;
  end loop;
  -- row 10: blocked by the gate (classification invalid, GATE flag remembers it was new)
  insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, row_index, flags,
                                      gate_status, gate_payload_hash, gate_rules_version, gated_at)
  select v_batch, '04_PORTS', 'ports', 'locode', 'ZZPCX', 'invalid', p, 10,
         '[{"level":"error","rule":"DQ-SMOKE","field":"trade_name","msg":"smoke block"},{"level":"info","rule":"GATE","prev":"new","msg":"blocked by the data-quality gate on channel sync"}]'::jsonb,
         'blocked', md5(p::text), v_ver, now()
    from (select jsonb_build_object('locode', 'ZZPCX', 'trade_name', 'Partial X', 'country', 'Testland', 'zone', 'E.MED') as p) x
  returning id into v_row10;

  -- ── S1 · commit the whole batch: 9 in, status partial ────────────────────
  v_res := public.commit_sync_batch(v_batch);
  if (v_res->>'inserted')::int <> 9 then raise exception 'S1: expected 9 inserted, got %', v_res; end if;
  if v_res->>'status' <> 'partial' then raise exception 'S1: expected status partial in the result, got %', v_res; end if;
  if (v_res->'remaining'->>'unresolved')::int <> 1 or (v_res->'remaining'->>'invalid')::int <> 1 or (v_res->'remaining'->>'blocked')::int <> 1 then
    raise exception 'S1: remaining counts wrong: %', v_res->'remaining';
  end if;
  select status into v_status from public.sync_batch where id = v_batch;
  if v_status <> 'partial' then raise exception 'S1: batch must be partial, got %', v_status; end if;
  select count(*) into v_n from public.ports where locode like 'ZZPC_';
  if v_n <> 9 then raise exception 'S1: expected 9 live ports, got %', v_n; end if;

  -- ── S2 · the blocked row stays uncommitted (editable) ────────────────────
  if (select committed from public.sync_staged_row where id = v_row10) then raise exception 'S2: the blocked row was marked committed'; end if;
  if exists (select 1 from public.ports where locode = 'ZZPCX') then raise exception 'S2: the blocked row reached the live table'; end if;

  -- ── S3 · fix, re-gate, commit the last row ───────────────────────────────
  update public.sync_staged_row set payload = payload || '{"trade_name": "Partial X fixed"}'::jsonb where id = v_row10;
  v_res := public.regate_sync_batch(v_batch, 'sync', 'smoke');
  if not (v_res->>'ok')::boolean then raise exception 'S3: regate failed: %', v_res; end if;
  select status into v_status from public.sync_batch where id = v_batch;
  if v_status <> 'partial' then raise exception 'S3: a partial batch must stay partial after the gate, got %', v_status; end if;
  select classification, gate_status into v_key, v_status from public.sync_staged_row where id = v_row10;
  if v_key <> 'new' or v_status <> 'ok' then raise exception 'S3: after the fix the row must be new/ok, got %/%', v_key, v_status; end if;
  v_res := public.commit_sync_batch(v_batch);
  if (v_res->>'inserted')::int <> 1 or v_res->>'status' <> 'committed' then raise exception 'S3: expected 1 inserted and committed, got %', v_res; end if;
  if (v_res->'remaining'->>'unresolved')::int <> 0 then raise exception 'S3: nothing should remain: %', v_res; end if;

  -- ── S4 · the transitions ─────────────────────────────────────────────────
  select status into v_status from public.sync_batch where id = v_batch;
  if v_status <> 'committed' then raise exception 'S4: expected committed, got %', v_status; end if;
  select count(*) into v_n from public.sync_commit_audit where batch_id = v_batch and undone_at is null;
  if v_n <> 10 then raise exception 'S4: expected 10 active audit rows, got %', v_n; end if;
  select count(*) into v_n from (select staged_row_id from public.sync_commit_audit where batch_id = v_batch and undone_at is null group by 1 having count(*) > 1) d;
  if v_n <> 0 then raise exception 'S4: duplicate active audit rows'; end if;

  -- ── S5 · undo from a partial batch ───────────────────────────────────────
  insert into public.sync_batch (source, label, status) values ('upload', 'SMOKE-PARTIAL-2', 'gated') returning id into v_batch;
  for i in 1..2 loop
    v_key := 'ZZPU' || i;
    insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, row_index,
                                        gate_status, gate_payload_hash, gate_rules_version, gated_at)
    select v_batch, '04_PORTS', 'ports', 'locode', v_key, 'new', p, i, 'ok', md5(p::text), v_ver, now()
      from (select jsonb_build_object('locode', v_key, 'trade_name', 'Undo ' || i, 'country', 'Testland', 'zone', 'E.MED') as p) x;
  end loop;
  insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, row_index, flags, gate_status, gate_payload_hash, gate_rules_version, gated_at)
  select v_batch, '04_PORTS', 'ports', 'locode', 'ZZPUX', 'invalid', p, 3,
         '[{"level":"error","rule":"DQ-SMOKE","msg":"smoke block"},{"level":"info","rule":"GATE","prev":"new","msg":"blocked"}]'::jsonb, 'blocked', md5(p::text), v_ver, now()
    from (select jsonb_build_object('locode', 'ZZPUX', 'trade_name', 'Undo X', 'country', 'Testland', 'zone', 'E.MED') as p) x;
  v_res := public.commit_sync_batch(v_batch);
  if v_res->>'status' <> 'partial' or (v_res->>'inserted')::int <> 2 then raise exception 'S5: expected partial with 2 inserted, got %', v_res; end if;
  v_res := public.undo_sync_batch(v_batch, false, 'smoke');
  if not (v_res->>'ok')::boolean or (v_res->>'deleted')::int <> 2 then raise exception 'S5: undo from partial failed: %', v_res; end if;
  if exists (select 1 from public.ports where locode like 'ZZPU_') then raise exception 'S5: inserted rows still present after undo'; end if;
  select status into v_status from public.sync_batch where id = v_batch;
  if v_status <> 'undone' then raise exception 'S5: expected undone, got %', v_status; end if;
  select count(*) into v_n from public.sync_staged_row where batch_id = v_batch and committed;
  if v_n <> 0 then raise exception 'S5: staged rows still marked committed'; end if;
  select count(*) into v_n from public.sync_commit_audit where batch_id = v_batch and undone_at is null;
  if v_n <> 0 then raise exception 'S5: active audit rows left after undo'; end if;

  -- ── S6 · nothing committable + blocked rows: never "committed" ───────────
  insert into public.sync_batch (source, label, status) values ('upload', 'SMOKE-PARTIAL-3', 'gated') returning id into v_batch;
  insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, row_index, flags, gate_status, gate_payload_hash, gate_rules_version, gated_at)
  select v_batch, '04_PORTS', 'ports', 'locode', 'ZZPBX', 'invalid', p, 1,
         '[{"level":"error","rule":"DQ-SMOKE","msg":"smoke block"},{"level":"info","rule":"GATE","prev":"new","msg":"blocked"}]'::jsonb, 'blocked', md5(p::text), v_ver, now()
    from (select jsonb_build_object('locode', 'ZZPBX', 'trade_name', 'Blocked', 'country', 'Testland', 'zone', 'E.MED') as p) x;
  v_res := public.commit_sync_batch(v_batch);
  if v_res->>'status' <> 'gated' or (v_res->>'inserted')::int <> 0 then raise exception 'S6: expected gated with nothing written, got %', v_res; end if;
  select status into v_status from public.sync_batch where id = v_batch;
  if v_status = 'committed' then raise exception 'S6: a batch with only blocked rows became committed'; end if;

  raise notice 'PARTIAL COMMIT SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
