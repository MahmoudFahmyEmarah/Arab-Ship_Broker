-- Data Sync hardening — direct-edit undo matrix for
-- 20260920120000_sync_undo_edits_truthful.sql (20 Sep 2026).
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/undo_edits_matrix_smoke.sql
--   supabase db query --local  --file supabase/tests/data_sync/undo_edits_matrix_smoke.sql
--
-- BEGIN … ROLLBACK on ports. Every operation × state combination:
--   update / unchanged · update / changed · update / subsequently deleted
--   delete / still absent · delete / subsequently recreated
--   insert / unchanged · insert / changed · insert / already deleted
--   force = false touches nothing on a conflict; force = true reaches the documented final state
--   + a bulk group undo

begin;

do $$
declare
  v_res jsonb; v_audit uuid; v_group uuid; v_row jsonb; v_name text; v_n int;
  v_before jsonb;
  k1 text := 'ZZUE1'; k2 text := 'ZZUE2'; k3 text := 'ZZUE3'; k4 text := 'ZZUE4'; k5 text := 'ZZUE5'; k6 text := 'ZZUE6'; k7 text := 'ZZUE7'; k8 text := 'ZZUE8';
  k9 text := 'ZZUE9'; k10 text := 'ZZUEA';
begin
  if exists (select 1 from public.ports where locode like 'ZZUE_') then raise exception 'ports ZZUE* exist — pick another test key'; end if;
  -- seed rows that the update / delete cases start from
  insert into public.ports (locode, trade_name, country, zone) values
    (k1, 'Undo One', 'Testland', 'E.MED'), (k2, 'Undo Two', 'Testland', 'E.MED'), (k3, 'Undo Three', 'Testland', 'E.MED'),
    (k4, 'Undo Four', 'Testland', 'E.MED'), (k5, 'Undo Five', 'Testland', 'E.MED'), (k9, 'Undo Nine', 'Testland', 'E.MED'), (k10, 'Undo Ten', 'Testland', 'E.MED');

  -- ── update / unchanged ───────────────────────────────────────────────────
  v_res := public.edit_live_record('ports', k1, '{"trade_name": "Undo One edited"}'::jsonb, null);
  v_audit := (v_res->>'audit_id')::uuid;
  v_res := public.undo_record_edits(v_audit, null, null, false);
  if not (v_res->>'ok')::boolean or (v_res->>'restored')::int <> 1 then raise exception 'update/unchanged: %', v_res; end if;
  select trade_name into v_name from public.ports where locode = k1;
  if v_name <> 'Undo One' then raise exception 'update/unchanged: row not restored (%)', v_name; end if;
  if not (select undone from public.record_edit_audit where id = v_audit) then raise exception 'update/unchanged: audit not marked undone'; end if;

  -- ── update / changed: force=false touches nothing, force=true restores ───
  v_res := public.edit_live_record('ports', k2, '{"trade_name": "Undo Two edited"}'::jsonb, null);
  v_audit := (v_res->>'audit_id')::uuid;
  update public.ports set trade_name = 'Undo Two changed later' where locode = k2;
  v_res := public.undo_record_edits(v_audit, null, null, false);
  if (v_res->>'ok')::boolean then raise exception 'update/changed: must report a conflict: %', v_res; end if;
  if jsonb_array_length(v_res->'conflicts') <> 1 or (v_res->'conflicts'->0->'changed') <> '["trade_name"]'::jsonb then raise exception 'update/changed: conflict shape %', v_res; end if;
  select trade_name into v_name from public.ports where locode = k2;
  if v_name <> 'Undo Two changed later' then raise exception 'update/changed: force=false changed the row'; end if;
  if (select undone from public.record_edit_audit where id = v_audit) then raise exception 'update/changed: audit marked undone without force'; end if;
  v_res := public.undo_record_edits(v_audit, null, null, true);
  if not (v_res->>'ok')::boolean or (v_res->>'restored')::int <> 1 or (v_res->>'forced')::int <> 1 then raise exception 'update/changed forced: %', v_res; end if;
  select trade_name into v_name from public.ports where locode = k2;
  if v_name <> 'Undo Two' then raise exception 'update/changed forced: row not restored (%)', v_name; end if;
  if (select undo_conflict from public.record_edit_audit where id = v_audit) is null then raise exception 'update/changed forced: override not recorded'; end if;

  -- ── update / subsequently deleted: the complete before-image comes back ──
  v_res := public.edit_live_record('ports', k3, '{"trade_name": "Undo Three edited"}'::jsonb, null);
  v_audit := (v_res->>'audit_id')::uuid;
  select before into v_before from public.record_edit_audit where id = v_audit;
  delete from public.ports where locode = k3;
  v_res := public.undo_record_edits(v_audit, null, null, false);
  if (v_res->>'ok')::boolean then raise exception 'update/deleted: must report the deletion: %', v_res; end if;
  if exists (select 1 from public.ports where locode = k3) then raise exception 'update/deleted: force=false re-created the row'; end if;
  v_res := public.undo_record_edits(v_audit, null, null, true);
  if not (v_res->>'ok')::boolean or (v_res->>'reinserted')::int <> 1 or (v_res->>'restored')::int <> 0 then raise exception 'update/deleted forced: %', v_res; end if;
  select to_jsonb(p) into v_row from public.ports p where locode = k3;
  if v_row is null then raise exception 'update/deleted forced: row not re-created'; end if;
  if coalesce(array_length(public.fn_sync_row_conflicts(v_before, v_row), 1), 0) > 0 then
    raise exception 'update/deleted forced: re-created row differs from the before-image: %', public.fn_sync_row_conflicts(v_before, v_row);
  end if;

  -- ── delete / still absent ────────────────────────────────────────────────
  perform public.delete_live_record('ports', k4, null);
  select id, before into v_audit, v_before from public.record_edit_audit where table_name = 'ports' and business_key = k4 and op = 'delete' and not undone;
  v_res := public.undo_record_edits(v_audit, null, null, false);
  if not (v_res->>'ok')::boolean or (v_res->>'reinserted')::int <> 1 then raise exception 'delete/absent: %', v_res; end if;
  select to_jsonb(p) into v_row from public.ports p where locode = k4;
  if v_row is null or coalesce(array_length(public.fn_sync_row_conflicts(v_before, v_row), 1), 0) > 0 then raise exception 'delete/absent: row not restored to its before-image'; end if;

  -- ── delete / subsequently recreated: force overwrites deterministically ──
  perform public.delete_live_record('ports', k5, null);
  select id, before into v_audit, v_before from public.record_edit_audit where table_name = 'ports' and business_key = k5 and op = 'delete' and not undone;
  insert into public.ports (locode, trade_name, country, zone) values (k5, 'Undo Five re-created', 'Elsewhere', 'W.MED');
  v_res := public.undo_record_edits(v_audit, null, null, false);
  if (v_res->>'ok')::boolean then raise exception 'delete/recreated: must report the re-creation: %', v_res; end if;
  select trade_name into v_name from public.ports where locode = k5;
  if v_name <> 'Undo Five re-created' then raise exception 'delete/recreated: force=false changed the row'; end if;
  v_res := public.undo_record_edits(v_audit, null, null, true);
  if not (v_res->>'ok')::boolean or (v_res->>'reinserted')::int <> 1 or (v_res->>'forced')::int <> 1 then raise exception 'delete/recreated forced: %', v_res; end if;
  select to_jsonb(p) into v_row from public.ports p where locode = k5;
  if coalesce(array_length(public.fn_sync_row_conflicts(v_before, v_row), 1), 0) > 0 then raise exception 'delete/recreated forced: row is not the before-image: %', public.fn_sync_row_conflicts(v_before, v_row); end if;
  select count(*) into v_n from public.ports where locode = k5;
  if v_n <> 1 then raise exception 'delete/recreated forced: expected exactly one row, got %', v_n; end if;

  -- ── insert / unchanged ───────────────────────────────────────────────────
  v_res := public.insert_live_record('ports', jsonb_build_object('locode', k6, 'trade_name', 'Undo Six', 'country', 'Testland', 'zone', 'E.MED'), null);
  v_audit := (v_res->>'audit_id')::uuid;
  v_res := public.undo_record_edits(v_audit, null, null, false);
  if not (v_res->>'ok')::boolean or (v_res->>'removed')::int <> 1 then raise exception 'insert/unchanged: %', v_res; end if;
  if exists (select 1 from public.ports where locode = k6) then raise exception 'insert/unchanged: row still present'; end if;

  -- ── insert / changed ─────────────────────────────────────────────────────
  v_res := public.insert_live_record('ports', jsonb_build_object('locode', k7, 'trade_name', 'Undo Seven', 'country', 'Testland', 'zone', 'E.MED'), null);
  v_audit := (v_res->>'audit_id')::uuid;
  update public.ports set trade_name = 'Undo Seven changed' where locode = k7;
  v_res := public.undo_record_edits(v_audit, null, null, false);
  if (v_res->>'ok')::boolean then raise exception 'insert/changed: must report a conflict: %', v_res; end if;
  if not exists (select 1 from public.ports where locode = k7) then raise exception 'insert/changed: force=false removed the row'; end if;
  v_res := public.undo_record_edits(v_audit, null, null, true);
  if not (v_res->>'ok')::boolean or (v_res->>'removed')::int <> 1 or (v_res->>'forced')::int <> 1 then raise exception 'insert/changed forced: %', v_res; end if;
  if exists (select 1 from public.ports where locode = k7) then raise exception 'insert/changed forced: row still present'; end if;

  -- ── insert / already deleted: nothing to remove, the final state holds ───
  v_res := public.insert_live_record('ports', jsonb_build_object('locode', k8, 'trade_name', 'Undo Eight', 'country', 'Testland', 'zone', 'E.MED'), null);
  v_audit := (v_res->>'audit_id')::uuid;
  delete from public.ports where locode = k8;
  v_res := public.undo_record_edits(v_audit, null, null, false);
  if not (v_res->>'ok')::boolean or (v_res->>'removed')::int <> 0 or (v_res->>'skipped')::int <> 1 then raise exception 'insert/already deleted: %', v_res; end if;
  if not (select undone from public.record_edit_audit where id = v_audit) then raise exception 'insert/already deleted: audit must be marked undone (final state confirmed)'; end if;

  -- ── a bulk group ─────────────────────────────────────────────────────────
  v_res := public.bulk_update_live_records('ports', array[k9, k10], '{"country": "Groupland"}'::jsonb, null);
  v_group := (v_res->>'group_id')::uuid;
  v_res := public.undo_record_edits(null, v_group, null, false);
  if not (v_res->>'ok')::boolean or (v_res->>'restored')::int <> 2 then raise exception 'group undo: %', v_res; end if;
  select count(*) into v_n from public.ports where locode in (k9, k10) and country = 'Testland';
  if v_n <> 2 then raise exception 'group undo: rows not restored'; end if;

  -- ── an undone audit cannot be undone again ───────────────────────────────
  begin
    perform public.undo_record_edits(v_audit, null, null, true);
    raise exception 'undone twice: an undone audit row was accepted again';
  exception when others then
    if sqlerrm not like 'nothing to undo%' then raise; end if;
  end;

  raise notice 'UNDO EDITS MATRIX SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
