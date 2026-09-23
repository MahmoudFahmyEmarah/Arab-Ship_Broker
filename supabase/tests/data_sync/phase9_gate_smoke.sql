-- Phase 9 (Data Sync hardening phase 3, 18 Sep 2026) — the gate is mandatory
-- smoke test for 20260918130000_sync_phase3_gate_mandatory.sql.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/phase9_gate_smoke.sql
--
-- BEGIN … ROLLBACK: writes to ports transiently. Run as the database owner.

begin;

do $$
declare v_batch uuid; v_row uuid; v_res jsonb; v_status text; v_gs text; v_hash text; v_err text; v_n int;
begin
  if exists (select 1 from public.ports where locode = 'ZZSM9') then raise exception 'port ZZSM9 exists — pick another test key'; end if;

  insert into public.sync_batch (source, label, status) values ('upload', 'SMOKE-9', 'gated') returning id into v_batch;
  insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, row_index)
  values (v_batch, '04_PORTS', 'ports', 'locode', 'ZZSM9', 'new',
          jsonb_build_object('locode', 'ZZSM9', 'trade_name', 'Smoke Nine', 'country', 'Testland', 'zone', 'E.MED'), 1)
  returning id into v_row;

  -- ── S1 · a row the gate never saw is refused ─────────────────────────────
  begin
    perform public.commit_sync_batch(v_batch);
    raise exception 'S1: commit of an ungated row was allowed';
  exception when others then
    v_err := sqlerrm;
    if v_err not like 'GATE_STALE:%' or v_err not like '%never checked by the gate%' then raise; end if;
  end;

  -- ── S2 · the gate persists its verdict ───────────────────────────────────
  v_res := public.regate_sync_batch(v_batch, 'sync', 'smoke');
  select gate_status, gate_payload_hash into v_gs, v_hash from public.sync_staged_row where id = v_row;
  if v_gs is distinct from 'ok' then raise exception 'S2: expected gate_status ok, got % (%)', v_gs, v_res; end if;
  if v_hash <> md5((select payload::text from public.sync_staged_row where id = v_row)) then raise exception 'S2: hash mismatch'; end if;
  select status into v_status from public.sync_batch where id = v_batch;
  if v_status <> 'gated' then raise exception 'S2: expected gated, got %', v_status; end if;
  if (select counts->'04_PORTS'->>'new' from public.sync_batch where id = v_batch)::int <> 1 then raise exception 'S2: recount wrong: %', (select counts from public.sync_batch where id = v_batch); end if;

  -- ── S3 · an edit after the gate makes the row stale ─────────────────────
  update public.sync_staged_row set payload = payload || '{"trade_name": "Smoke Nine (edited)"}'::jsonb where id = v_row;
  begin
    perform public.commit_sync_batch(v_batch);
    raise exception 'S3: commit of an edited row was allowed';
  exception when others then
    if sqlerrm not like 'GATE_STALE:%edited since the gate checked it%' then raise; end if;
  end;

  -- ── S4 · re-gating the row makes it committable again ───────────────────
  perform public.fn_dq_gate_batch(v_batch, 'sync', 'smoke', v_row);
  v_res := public.commit_sync_batch(v_batch);
  if (v_res->>'inserted')::int <> 1 then raise exception 'S4: expected 1 inserted, got %', v_res; end if;
  if (select trade_name from public.ports where locode = 'ZZSM9') <> 'Smoke Nine (edited)' then raise exception 'S4: edited value not committed'; end if;

  -- ── S5 · a gate error is fail-closed ─────────────────────────────────────
  insert into public.sync_batch (source, label, status) values ('upload', 'SMOKE-9b', 'gated') returning id into v_batch;
  insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, row_index, gate_status, gate_payload_hash, gate_rules_version)
  values (v_batch, '04_PORTS', 'ports', 'locode', 'ZZSM8', 'new',
          jsonb_build_object('locode', 'ZZSM8', 'trade_name', 'Smoke Eight', 'country', 'Testland', 'zone', 'E.MED'), 1,
          'error', md5(jsonb_build_object('locode', 'ZZSM8', 'trade_name', 'Smoke Eight', 'country', 'Testland', 'zone', 'E.MED')::text), now());
  begin
    perform public.commit_sync_batch(v_batch);
    raise exception 'S5: commit of a gate-error row was allowed';
  exception when others then
    if sqlerrm not like 'GATE_STALE:%could not be evaluated%' then raise; end if;
  end;

  -- ── S6 · a rules change makes every verdict stale ───────────────────────
  update public.sync_staged_row set gate_status = 'ok', gate_rules_version = '2000-01-01'::timestamptz where batch_id = v_batch;
  select count(*) into v_n from public.fn_sync_gate_stale(v_batch);
  if v_n <> 1 then raise exception 'S6: expected the old-rules row to be stale, got %', v_n; end if;

  -- ── S7 · a live edit names its channel ──────────────────────────────────
  perform public.edit_live_record('ports', 'ZZSM9', '{"country": "Testland 2"}'::jsonb, null);
  if current_setting('dq.channel', true) is distinct from 'admin' then raise exception 'S7: dq.channel was not set to admin (got %)', current_setting('dq.channel', true); end if;
  if (select country from public.ports where locode = 'ZZSM9') <> 'Testland 2' then raise exception 'S7: edit not applied'; end if;

  raise notice 'PHASE 9 SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
