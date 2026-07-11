-- Phase 4 smoke — exercises the audited edit/bulk/delete/undo path and the
-- commodity resolver against real tables, then rolls everything back.
-- Run inside a transaction:  psql ... -f phase4_smoke.sql   (wrapped BEGIN/ROLLBACK)
-- or paste the DO block into the SQL editor (it self-aborts with SMOKE_OK).

begin;
do $$
declare v_a jsonb; v_aid uuid; v_grp uuid; v_qid uuid; v_res jsonb;
        v_tn text; v_country text; v_lat numeric;
begin
  if exists (select 1 from public.ports where locode in ('ZZTST','ZZTS2')) then
    raise exception 'ABORT: test ports already exist'; end if;

  insert into public.ports(locode,trade_name,country,zone) values
    ('ZZTST','Orig Name','Testland','AG'),('ZZTS2','Second','Testland','AG');

  -- single audited partial edit + before-image
  v_a := public.edit_live_record('ports','ZZTST', jsonb_build_object('trade_name','Renamed','latitude',12.5));
  v_aid := (v_a->>'audit_id')::uuid;
  select trade_name,country,latitude into v_tn,v_country,v_lat from public.ports where locode='ZZTST';
  assert v_tn='Renamed' and v_lat=12.5, 'edit not applied';
  assert v_country='Testland', 'partial edit clobbered an untouched column';
  assert (select before->>'trade_name' from public.record_edit_audit where id=v_aid)='Orig Name', 'before-image wrong';

  -- undo single
  assert public.undo_record_edits(p_audit_id => v_aid) = jsonb_build_object('restored',1,'reinserted',0), 'undo failed';
  select trade_name,latitude into v_tn,v_lat from public.ports where locode='ZZTST';
  assert v_tn='Orig Name' and v_lat is null, 'undo did not restore';

  -- bulk edit + group undo
  v_res := public.bulk_update_live_records('ports', array['ZZTST','ZZTS2'], jsonb_build_object('zone','R.SEA'));
  v_grp := (v_res->>'group_id')::uuid;
  assert (v_res->>'updated')::int = 2, 'bulk count wrong';
  assert (select count(*) from public.ports where locode in ('ZZTST','ZZTS2') and zone='R.SEA')=2, 'zones not set';
  assert (public.undo_record_edits(p_group_id => v_grp)->>'restored')::int = 2, 'group undo failed';
  assert (select count(*) from public.ports where locode in ('ZZTST','ZZTS2') and zone='AG')=2, 'group not restored';

  -- delete + undo (re-insert from before-image)
  assert public.delete_live_record('ports','ZZTS2') = jsonb_build_object('deleted',1), 'delete failed';
  assert not exists (select 1 from public.ports where locode='ZZTS2'), 'not deleted';
  select id into v_aid from public.record_edit_audit where business_key='ZZTS2' and op='delete';
  assert (public.undo_record_edits(p_audit_id => v_aid)->>'reinserted')::int = 1, 'delete-undo failed';
  assert exists (select 1 from public.ports where locode='ZZTS2' and trade_name='Second'), 'not reinserted';

  -- commodity resolve
  insert into public.commodity_review_queue(raw_name,sample_ref) values ('ZZ Test Meal','CM-ZZ1') returning id into v_qid;
  perform public.resolve_commodity_review(v_qid,'ZZ Test Meal','Dry Bulk','Cat_C', p_category=>'Meals', p_is_grain=>true);
  assert exists (select 1 from public.commodities where canonical_name='ZZ Test Meal' and is_grain and imsbc_category='Cat_C'), 'commodity not created';
  assert (select status from public.commodity_review_queue where id=v_qid)='mapped', 'queue not mapped';

  -- guards
  begin perform public.edit_live_record('users','x','{"a":1}'::jsonb); assert false, 'disallowed table allowed';
  exception when sqlstate '42501' then null; end;
  begin perform public.edit_live_record('ports','NOPE', jsonb_build_object('trade_name','x')); assert false, 'missing record allowed';
  exception when sqlstate 'P0002' then null; end;

  raise notice 'SMOKE_OK: all Phase 4 paths passed';
end $$;
rollback;
