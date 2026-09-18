-- Phase 10 (Data Sync hardening phase 4, 18 Sep 2026) — fidelity smoke test
-- for 20260918140000_sync_phase4_fidelity.sql.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/phase10_fidelity_smoke.sql
--
-- BEGIN … ROLLBACK. Run as the database owner.

begin;

do $$
declare v_up uuid; v_em uuid; v_n int; v_pl jsonb; v_unknown text[];
begin
  -- ── S1 · the baseline is scoped to the source ────────────────────────────
  insert into public.sync_batch (source, label, status) values ('upload', 'SMOKE-10 upload', 'committed') returning id into v_up;
  insert into public.sync_batch (source, label, status) values ('email',  'SMOKE-10 email',  'committed') returning id into v_em;
  insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, committed, created_at)
  values (v_up, '04_PORTS', 'ports', 'locode', 'ZZS10', 'new', '{"trade_name": "from the workbook"}', true, now() - interval '2 hours'),
         (v_em, '04_PORTS', 'ports', 'locode', 'ZZS10', 'updated', '{"trade_name": "from a circular"}', true, now() - interval '1 hour');
  -- the trigger filled source from the batch
  select count(*) into v_n from public.sync_staged_row where batch_id in (v_up, v_em) and source is not null;
  if v_n <> 2 then raise exception 'S1: source not defaulted from the batch (%)', v_n; end if;

  select payload into v_pl from public.fn_sync_previous_payloads('ports', 'upload', array['ZZS10']);
  if v_pl->>'trade_name' <> 'from the workbook' then raise exception 'S1: upload baseline should be the workbook payload, got %', v_pl; end if;
  select payload into v_pl from public.fn_sync_previous_payloads('ports', 'email', array['ZZS10']);
  if v_pl->>'trade_name' <> 'from a circular' then raise exception 'S1: email baseline should be the circular payload, got %', v_pl; end if;
  select count(*) into v_n from public.fn_sync_previous_payloads('ports', 'whatsapp', array['ZZS10']);
  if v_n <> 0 then raise exception 'S1: a source with no history should return nothing'; end if;

  -- latest per key wins within a source
  insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, committed, created_at)
  values (v_up, '04_PORTS', 'ports', 'locode', 'ZZS10', 'updated', '{"trade_name": "workbook, later"}', true, now());
  select payload into v_pl from public.fn_sync_previous_payloads('ports', 'upload', array['ZZS10']);
  if v_pl->>'trade_name' <> 'workbook, later' then raise exception 'S1: latest committed payload should win, got %', v_pl; end if;

  -- ── S2 · unknown ports are named ─────────────────────────────────────────
  v_unknown := public.fn_sync_unknown_ports('{"load_port_locode": "ZZNOP", "disch_port_locode": "ZZOK1", "load_port_2_locode": ""}'::jsonb, array['ZZOK1']);
  if v_unknown <> array['load_port_locode=ZZNOP'] then raise exception 'S2: expected the unknown load port only, got %', v_unknown; end if;
  v_unknown := public.fn_sync_unknown_ports('{"load_port_locode": null}'::jsonb, '{}');
  if coalesce(array_length(v_unknown, 1), 0) <> 0 then raise exception 'S2: blanks must not count'; end if;

  raise notice 'PHASE 10 SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
