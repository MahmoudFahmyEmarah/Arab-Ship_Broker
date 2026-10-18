-- PDA tariff edition label (20261013300000, C2O-120): every tariff VERSION carries a frozen member-facing label set at
-- creation; get_pda_calculation_context returns it; two versions of one set never share it; renaming the set never
-- relabels a version; published labels are immutable; a 300-character set name fits; tier and role gates hold.
-- Rolled back.
begin;

do $$
declare
  maker uuid := gen_random_uuid(); checker uuid := gen_random_uuid(); m3 uuid := gen_random_uuid(); m1 uuid := gen_random_uuid();
  v_port text; v_pub uuid; v_src uuid; v1 uuid; v2 uuid; v_set uuid; v_name text := repeat('N', 296) || ' end';
  l1 text; l2 text; ctx jsonb; denied boolean;
  rules jsonb;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, f.id, 'authenticated', 'authenticated', f.email, crypt('PdaEd1!', gen_salt('bf')), now(), '{}', '{}', now(), now()
    from (values (maker, 'ed-maker@example.test'), (checker, 'ed-checker@example.test'), (m3, 'ed-t3@example.test'), (m1, 'ed-t1@example.test')) f(id, email);
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier) values
    (maker, maker, 'ed-maker@example.test', 'Edition maker', 'admin', true, null, 'T4'),
    (checker, checker, 'ed-checker@example.test', 'Edition checker', 'admin', true, null, 'T4'),
    (m3, m3, 'ed-t3@example.test', 'Edition T3', 'cargo_owner', true, null, 'T3'),
    (m1, m1, 'ed-t1@example.test', 'Edition T1', 'cargo_owner', true, null, 'T1');

  select p.locode into v_port from public.ports p
   where p.is_active and p.is_verified and not exists (select 1 from public.port_tariff_sets s where s.port_locode = p.locode)
   order by p.locode limit 1;
  if v_port is null then raise exception 'setup: no free active verified port'; end if;
  if char_length(v_name) <> 300 then raise exception 'setup: the set name must be exactly 300 characters'; end if;

  v_pub := public.pda_upsert_tariff_publisher(maker, '{"name":"Edition test publisher","publisherType":"other","country":"Egypt"}');
  v_src := public.pda_register_tariff_source(maker, jsonb_build_object('publisherId', v_pub, 'title', 'Edition test decree',
    'sourceFilename', 'edition.pdf', 'mimeType', 'application/pdf', 'sha256', repeat('ed', 32), 'authority', 'official'));
  rules := jsonb_build_array(jsonb_build_object('code', 'edition_fee', 'label', 'Edition test fee', 'basis', 'per_call', 'amount', 10,
    'priority', 10, 'applicability', '{"requestedServices":["port_dues"]}'::jsonb, 'sourceId', v_src, 'sourcePage', 'p. 1', 'sourceExcerpt', 'fee 10'));

  -- version 1, set name exactly 300 characters
  v1 := public.pda_create_tariff_draft(maker, jsonb_build_object('portLocode', v_port, 'publisherId', v_pub, 'name', v_name,
    'scope', 'port_call', 'versionNo', 1, 'currency', 'USD', 'effectiveFrom', '2026-01-01', 'roundingMode', 'half_up',
    'decimalPlaces', 2, 'primarySourceId', v_src));
  perform public.pda_replace_tariff_rules(maker, v1, rules);
  perform public.pda_submit_tariff_version(maker, v1);
  perform public.pda_publish_tariff_version(checker, v1);
  select edition_label, tariff_set_id into l1, v_set from public.port_tariff_versions where id = v1;
  -- E1 · the label is fixed at creation: set name · v1 (from date); a 300-character name fits
  if l1 <> v_name || ' · v1 (from 2026-01-01)' then raise exception 'E1: unexpected label %', left(l1, 80); end if;

  -- E2 · the governed read returns it to an entitled member (T3), exactly
  perform set_config('request.jwt.claims', jsonb_build_object('sub', m3, 'role', 'authenticated')::text, true);
  ctx := public.get_pda_calculation_context(v_port, null, date '2026-03-01');
  if ctx->>'coverage' <> 'published' or ctx->'tariffVersion'->>'editionLabel' is distinct from l1 then
    raise exception 'E2: context label wrong: %', left(coalesce(ctx->'tariffVersion'->>'editionLabel', '<null>'), 80); end if;

  -- E3 · a second version of the same set gets its own label
  perform set_config('request.jwt.claims', '', true);
  v2 := public.pda_create_tariff_draft(maker, jsonb_build_object('tariffSetId', v_set, 'portLocode', v_port, 'publisherId', v_pub,
    'name', v_name, 'scope', 'port_call', 'versionNo', 2, 'currency', 'USD', 'effectiveFrom', '2026-07-01', 'roundingMode', 'half_up',
    'decimalPlaces', 2, 'primarySourceId', v_src, 'supersedesId', v1));
  perform public.pda_replace_tariff_rules(maker, v2, rules);
  perform public.pda_submit_tariff_version(maker, v2);
  perform public.pda_publish_tariff_version(checker, v2);
  select edition_label into l2 from public.port_tariff_versions where id = v2;
  if l2 = l1 or l2 <> v_name || ' · v2 (from 2026-07-01)' then raise exception 'E3: version labels not distinct'; end if;

  -- E4 · renaming the set never relabels an existing version
  update public.port_tariff_sets set name = 'Renamed edition test set' where id = v_set;
  if (select edition_label from public.port_tariff_versions where id = v1) <> l1
     or (select edition_label from public.port_tariff_versions where id = v2) <> l2 then
    raise exception 'E4: a set rename relabelled a version'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', m3, 'role', 'authenticated')::text, true);
  if public.get_pda_calculation_context(v_port, null, date '2026-08-01')->'tariffVersion'->>'editionLabel' <> l2 then
    raise exception 'E4: the read did not keep the version label after the rename'; end if;
  perform set_config('request.jwt.claims', '', true);

  -- E5 · a published label is immutable
  denied := false;
  begin update public.port_tariff_versions set edition_label = 'relabelled' where id = v2;
  exception when others then if sqlerrm like 'PDA_IMMUTABLE:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'E5: a published edition label was changed'; end if;

  -- E6 · a blank label is filled at creation; exactly 400 characters is accepted; 401 is refused (C2O-126 P2)
  if (select count(*) from public.port_tariff_versions where btrim(edition_label) = '') <> 0 then raise exception 'E6: blank label stored'; end if;
  perform public.pda_create_tariff_draft(maker, jsonb_build_object('tariffSetId', v_set, 'portLocode', v_port, 'publisherId', v_pub,
    'name', v_name, 'scope', 'port_call', 'versionNo', 3, 'currency', 'USD', 'effectiveFrom', '2026-09-01', 'roundingMode', 'half_up',
    'decimalPlaces', 2, 'primarySourceId', v_src, 'supersedesId', v2));
  update public.port_tariff_versions set edition_label = repeat('x', 400) where tariff_set_id = v_set and version_no = 3;
  if (select char_length(edition_label) from public.port_tariff_versions where tariff_set_id = v_set and version_no = 3) <> 400 then
    raise exception 'E6: an exactly-400-character label was not stored'; end if;
  denied := false;
  begin update public.port_tariff_versions set edition_label = repeat('x', 401) where tariff_set_id = v_set and version_no = 3;
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'E6: a 401-character label was accepted'; end if;

  -- E7 · gates: T1 refused by tier; anon cannot execute; authenticated and service_role can
  perform set_config('request.jwt.claims', jsonb_build_object('sub', m1, 'role', 'authenticated')::text, true);
  denied := false;
  begin perform public.get_pda_calculation_context(v_port, null, date '2026-03-01');
  exception when others then if sqlerrm like 'PDA_TIER:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'E7: a T1 member read the context'; end if;
  perform set_config('request.jwt.claims', '', true);
  if has_function_privilege('anon', 'public.get_pda_calculation_context(text, uuid, date)', 'execute') then raise exception 'E7: anon can read'; end if;
  if not has_function_privilege('authenticated', 'public.get_pda_calculation_context(text, uuid, date)', 'execute')
     or not has_function_privilege('service_role', 'public.get_pda_calculation_context(text, uuid, date)', 'execute') then
    raise exception 'E7: authenticated/service_role lost the read'; end if;
  if has_function_privilege('authenticated', 'public.fn_pda_version_edition_label()', 'execute') then raise exception 'E7: trigger function exposed'; end if;
end $$;

do $m$ begin raise notice 'PDA TARIFF EDITION LABEL: ALL ASSERTIONS PASSED'; end $m$;
rollback;
