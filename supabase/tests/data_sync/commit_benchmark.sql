-- Data Sync hardening — commit duration at 100, 1,000 and 5,000 staged rows
-- (P2, 20 Sep 2026). BEGIN … ROLLBACK: nothing persists. The numbers come
-- back in the final RAISE EXCEPTION message (the only channel that survives
-- a rollback when run through the Management API); with psql they are also
-- printed as NOTICEs.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/commit_benchmark.sql
--
-- Stages N new ports rows (gate columns pre-set to ok — the gate itself is
-- benchmarked by its own run), commits the batch, undoes it, and times each.

begin;
do $$
declare
  sizes int[] := array[100, 1000, 5000]; n int; i int; v_batch uuid; v_ver timestamptz := public.fn_dq_rules_version();
  t0 timestamptz; v_commit_ms int; v_undo_ms int; v_stage_ms int; v_res jsonb; v_out jsonb := '[]'::jsonb;
begin
  foreach n in array sizes loop
    if exists (select 1 from public.ports where locode like 'ZB%') then raise exception 'ports ZB* exist — pick another test prefix'; end if;
    insert into public.sync_batch (source, label, status) values ('upload', 'BENCH-' || n, 'gated') returning id into v_batch;
    t0 := clock_timestamp();
    insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, row_index, gate_status, gate_payload_hash, gate_rules_version, gated_at)
    select v_batch, '04_PORTS', 'ports', 'locode', k, 'new', p, g, 'ok', md5(p::text), v_ver, now()
      from (select g, 'ZB' || chr(65 + (g / 676) % 26) || chr(65 + (g / 26) % 26) || chr(65 + g % 26) as k from generate_series(1, n) g) s
      cross join lateral (select jsonb_build_object('locode', s.k, 'trade_name', 'Bench ' || s.g, 'country', 'Testland', 'zone', 'E.MED') as p) x;
    v_stage_ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;

    t0 := clock_timestamp();
    v_res := public.commit_sync_batch(v_batch);
    v_commit_ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
    if (v_res->>'inserted')::int <> n or v_res->>'status' <> 'committed' then raise exception 'bench %: unexpected commit result %', n, v_res; end if;

    t0 := clock_timestamp();
    v_res := public.undo_sync_batch(v_batch, false, 'bench');
    v_undo_ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
    if not (v_res->>'ok')::boolean or (v_res->>'deleted')::int <> n then raise exception 'bench %: unexpected undo result %', n, v_res; end if;

    v_out := v_out || jsonb_build_object('rows', n, 'stage_insert_ms', v_stage_ms, 'commit_ms', v_commit_ms, 'commit_ms_per_row', round(v_commit_ms::numeric / n, 2), 'undo_ms', v_undo_ms);
    raise notice 'bench rows=% stage_insert=% ms commit=% ms (% ms/row) undo=% ms', n, v_stage_ms, v_commit_ms, round(v_commit_ms::numeric / n, 2), v_undo_ms;
    -- the audit rows keep the batch (discard guard); leave them for the rollback
  end loop;
  raise exception using message = 'COMMIT BENCHMARK (rolled back): ' || v_out::text, errcode = 'P0001';
end $$;
rollback;
