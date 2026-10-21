-- PDA · Tariff Packs library and pack record (20261019130000, design B2ALL-061). BEGIN … ROLLBACK; run as the database owner.
--   K1  one pack per source document cited by a tariff in force: the port and its terminal edition, exact charge-line
--       counts per port and in total, authority, official first; the reference is 16 hex and stable
--   K2  a superseding edition that cites a new document moves the port to the new pack; the old pack keeps only the
--       editions still published (publish marks the overlapped version superseded, and superseded is never read)
--   K3  the record: editions with their lines (code, basis, figures, services, page, excerpt); no source URI, no
--       storage path, no internal id key or value anywhere
--   K4  an unknown, malformed or not-in-force reference is PDA_VALIDATION (no existence oracle)
--   K5  gates: signed out → PDA_AUTH; T2 → PDA_TIER; null date → PDA_VALIDATION; grants authenticated + service_role
--       only; the reference helper is not callable by members
--   K6  governance: an inactive terminal drops its edition from the pack; an unverified port drops every pack at it
--       (the Ports tab's rule); both come back when restored
--   K7  a draft or in-review version and an inactive set are never read
begin;

do $$
declare
  maker uuid := gen_random_uuid();
  checker uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  basic uuid := gen_random_uuid();
  port_code text;
  publisher uuid;
  source1 uuid;
  source2 uuid;
  terminal uuid;
  v1 uuid;
  v2 uuid;
  tv uuid;
  ref1 text;
  ref2 text;
  packs jsonb;
  k jsonb;
  rec jsonb;
  ed jsonb;
  e text;
  bad text;
  v3 uuid;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, f.id, 'authenticated', 'authenticated', f.email,
         crypt('PdaPacks1!', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from (values (maker, 'pda-tp-maker@example.test'), (checker, 'pda-tp-checker@example.test'),
               (member, 'pda-tp-member@example.test'), (basic, 'pda-tp-basic@example.test')) as f(id, email);
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier) values
    (maker, maker, 'pda-tp-maker@example.test', 'TP Maker', 'admin', true, null, 'T4'),
    (checker, checker, 'pda-tp-checker@example.test', 'TP Checker', 'admin', true, null, 'T4'),
    (member, member, 'pda-tp-member@example.test', 'TP Member', 'cargo_owner', true, null, 'T3'),
    (basic, basic, 'pda-tp-basic@example.test', 'TP Basic', 'cargo_owner', true, null, 'T2');

  select p2.locode into port_code from public.ports p2
   where p2.is_active and p2.is_verified
     and not exists (select 1 from public.port_tariff_sets s where s.port_locode = p2.locode and s.is_active)
   order by p2.locode limit 1;
  if port_code is null then raise exception 'K0: a verified port without an active tariff set is required'; end if;

  publisher := public.pda_upsert_tariff_publisher(maker, jsonb_build_object('name','TP Test Port Authority','publisherType','port_authority','country','Test'));
  source1 := public.pda_register_tariff_source(maker, jsonb_build_object(
    'publisherId',publisher,'title','TP Tariff 2026','sourceFilename','tp-2026.pdf','mimeType','application/pdf',
    'sha256',repeat('d',64),'authority','official','effectiveFrom','2026-01-01','sourceUri','https://example.test/tp-2026.pdf',
    'currentnessNote','Tariff packs fixture'));
  source2 := public.pda_register_tariff_source(maker, jsonb_build_object(
    'publisherId',publisher,'title','TP Tariff 2026 amendment','sourceFilename','tp-2026b.pdf','mimeType','application/pdf',
    'sha256',repeat('e',64),'authority','official','effectiveFrom','2026-07-01','currentnessNote','Tariff packs fixture'));
  terminal := public.pda_upsert_port_terminal(maker, jsonb_build_object('portLocode',port_code,'name','TP Test Terminal'));
  perform public.pda_verify_port_terminal(checker, terminal);

  -- port-wide v1 (2 lines) and a terminal edition (1 line), both citing source1, both in force from 2026-01-01
  v1 := public.pda_create_tariff_draft(maker, jsonb_build_object(
    'portLocode',port_code,'publisherId',publisher,'name','TP Port Call','scope','port_call','versionNo',1,'currency','USD',
    'effectiveFrom','2026-01-01','roundingMode','half_up','decimalPlaces',2,'primarySourceId',source1));
  perform public.pda_replace_tariff_rules(maker, v1, jsonb_build_array(
    jsonb_build_object('code','port_dues','label','Port dues','basis','per_gt','rate',0.12,'minimumAmount',150,'priority',10,
                       'sourceId',source1,'sourcePage','4','sourceExcerpt','Port dues per GT'),
    jsonb_build_object('code','tug_assist','label','Tug assistance','basis','per_call','amount',300,'priority',20,
                       'applicability',jsonb_build_object('requestedServices',jsonb_build_array('towage')),
                       'sourceId',source1,'sourcePage','5','sourceExcerpt','Towage per call')));
  perform public.pda_submit_tariff_version(maker, v1);
  perform public.pda_publish_tariff_version(checker, v1);
  tv := public.pda_create_tariff_draft(maker, jsonb_build_object(
    'portLocode',port_code,'terminalId',terminal,'publisherId',publisher,'name','TP Terminal','scope','terminal',
    'versionNo',1,'currency','USD','effectiveFrom','2026-01-01','roundingMode','half_up','decimalPlaces',2,'primarySourceId',source1));
  perform public.pda_replace_tariff_rules(maker, tv, jsonb_build_array(
    jsonb_build_object('code','cargo_handling','label','Cargo handling','basis','per_cargo_mt','rate',1.5,'unit','MT','priority',10,
                       'sourceId',source1,'sourcePage','7','sourceExcerpt','Cargo handling per tonne')));
  perform public.pda_submit_tariff_version(maker, tv);
  perform public.pda_publish_tariff_version(checker, tv);

  -- K5 · gates
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  begin perform public.list_pda_tariff_packs('2026-06-01'); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'K5: signed out list must be PDA_AUTH, got %', e; end if;
  begin perform public.get_pda_tariff_pack(repeat('a',16), '2026-06-01'); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'K5: signed out record must be PDA_AUTH, got %', e; end if;

  perform set_config('request.jwt.claim.sub', basic::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',basic,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  begin perform public.list_pda_tariff_packs('2026-06-01'); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_TIER' then raise exception 'K5: a T2 member must be PDA_TIER, got %', e; end if;

  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  begin perform public.list_pda_tariff_packs(null); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'K5: a null date must be PDA_VALIDATION, got %', e; end if;

  -- K1 · the pack for source1
  ref1 := public.fn_pda_tariff_pack_ref(source1);
  ref2 := public.fn_pda_tariff_pack_ref(source2);
  if ref1 !~ '^[0-9a-f]{16}$' or ref1 = ref2 or ref1 <> public.fn_pda_tariff_pack_ref(source1) then
    raise exception 'K1: the reference must be 16 hex, distinct per source and stable: % %', ref1, ref2; end if;
  packs := public.list_pda_tariff_packs('2026-06-01');
  select x into k from jsonb_array_elements(packs) x where x->>'packRef' = ref1;
  if k is null or k->>'authority' <> 'TP Test Port Authority' or k->>'sourceAuthority' <> 'official' or k->>'sourceTitle' <> 'TP Tariff 2026'
     or k->>'currency' <> 'USD' or (k->>'lines')::int <> 3 or jsonb_array_length(k->'ports') <> 2
     or not exists (select 1 from jsonb_array_elements(k->'ports') y where y->>'locode' = port_code and y->>'terminal' is null and (y->>'lines')::int = 2)
     or not exists (select 1 from jsonb_array_elements(k->'ports') y where y->>'locode' = port_code and y->>'terminal' = 'TP Test Terminal' and (y->>'lines')::int = 1) then
    raise exception 'K1: the pack is wrong: %', k; end if;
  if exists (select 1 from jsonb_array_elements(packs) x where x->>'packRef' = ref2) then
    raise exception 'K1: a source no edition in force cites must not be a pack'; end if;
  -- official documents come first
  if exists (select 1 from jsonb_array_elements(packs) with ordinality a(x, n)
              join jsonb_array_elements(packs) with ordinality b(y, m) on m > n
             where a.x->>'sourceAuthority' <> 'official' and b.y->>'sourceAuthority' = 'official') then
    raise exception 'K1: official packs must be listed first'; end if;

  -- K3 · the record
  rec := public.get_pda_tariff_pack(ref1, '2026-06-01');
  if rec->>'packRef' <> ref1 or rec->'source'->>'title' <> 'TP Tariff 2026' or rec->'source'->>'currentness' <> 'Tariff packs fixture'
     or jsonb_array_length(rec->'editions') <> 2 then raise exception 'K3: the record header is wrong: %', rec; end if;
  select x into ed from jsonb_array_elements(rec->'editions') x where x->>'terminal' is null;
  if ed->>'port' <> port_code or (ed->>'version')::int <> 1 or jsonb_array_length(ed->'lines') <> 2
     or ed->'lines'->0->>'code' <> 'port_dues' or ed->'lines'->0->>'basis' <> 'per_gt' or (ed->'lines'->0->>'rate')::numeric <> 0.12
     or (ed->'lines'->0->>'minimum')::numeric <> 150 or ed->'lines'->0->>'page' <> '4' or ed->'lines'->0->>'excerpt' <> 'Port dues per GT'
     or ed->'lines'->1->'services' <> '["towage"]'::jsonb or (ed->'lines'->1->>'manual')::boolean then
    raise exception 'K3: the port-wide edition is wrong: %', ed; end if;
  if rec::text ~ '"[A-Za-z]*[iI]d"\s*:' or packs::text ~ '"[A-Za-z]*[iI]d"\s*:' then raise exception 'K3: an internal id key is exposed'; end if;
  if position('example.test/tp-2026' in rec::text) > 0 or position('tp-2026.pdf' in rec::text) > 0 then
    raise exception 'K3: the source URI or file name is exposed'; end if;
  if position(v1::text in rec::text || packs::text) > 0 or position(tv::text in rec::text || packs::text) > 0
     or position(source1::text in rec::text || packs::text) > 0 or position(publisher::text in rec::text || packs::text) > 0
     or position(terminal::text in rec::text || packs::text) > 0 then
    raise exception 'K3: an internal id value is exposed'; end if;

  -- K4 · unknown, malformed, not in force
  foreach bad in array array[repeat('0',16), 'ABCDEF0123456789', 'short', ref2] loop
    begin perform public.get_pda_tariff_pack(bad, '2026-06-01'); e := 'returned';
    exception when others then e := split_part(sqlerrm, ':', 1); end;
    if e is distinct from 'PDA_VALIDATION' then raise exception 'K4: a bad reference must be PDA_VALIDATION, got %', e; end if;
  end loop;
  begin perform public.get_pda_tariff_pack(ref1, '2025-06-01'); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'K4: a pack not in force on the date must be PDA_VALIDATION, got %', e; end if;

  -- K2 · v2 of the port-wide set cites source2 from 2026-07-01 and supersedes v1
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  v2 := public.pda_create_tariff_draft(maker, jsonb_build_object(
    'tariffSetId',(select tariff_set_id from public.port_tariff_versions where id = v1),'supersedesId',v1,
    'portLocode',port_code,'publisherId',publisher,'name','TP Port Call','scope','port_call','versionNo',2,'currency','USD',
    'effectiveFrom','2026-07-01','roundingMode','half_up','decimalPlaces',2,'primarySourceId',source2));
  perform public.pda_replace_tariff_rules(maker, v2, jsonb_build_array(
    jsonb_build_object('code','port_dues','label','Port dues','basis','per_gt','rate',0.13,'priority',10,
                       'sourceId',source2,'sourcePage','2','sourceExcerpt','Port dues per GT, amended')));
  perform public.pda_submit_tariff_version(maker, v2);
  perform public.pda_publish_tariff_version(checker, v2);
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);

  packs := public.list_pda_tariff_packs('2026-08-01');
  select x into k from jsonb_array_elements(packs) x where x->>'packRef' = ref2;
  if k is null or (k->>'lines')::int <> 1 or jsonb_array_length(k->'ports') <> 1 or k->'ports'->0->>'terminal' is not null then
    raise exception 'K2: the new pack must price the port-wide set: %', k; end if;
  select x into k from jsonb_array_elements(packs) x where x->>'packRef' = ref1;
  if k is null or (k->>'lines')::int <> 1 or jsonb_array_length(k->'ports') <> 1 or k->'ports'->0->>'terminal' <> 'TP Test Terminal' then
    raise exception 'K2: the old pack keeps only the terminal edition: %', k; end if;
  rec := public.get_pda_tariff_pack(ref1, '2026-08-01');
  if jsonb_array_length(rec->'editions') <> 1 or rec->'editions'->0->>'terminal' <> 'TP Test Terminal' then
    raise exception 'K2: the old record must hold only the terminal edition: %', rec; end if;
  rec := public.get_pda_tariff_pack(ref2, '2026-08-01');
  if (rec->'editions'->0->>'supersedes')::boolean is not true or (rec->'editions'->0->>'version')::int <> 2 then
    raise exception 'K2: the new edition must show it supersedes: %', rec; end if;

  -- K6 · governance (on 2026-08-01: ref2 = port-wide v2, ref1 = the terminal edition)
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  update public.port_terminals set is_active = false where id = terminal;
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  packs := public.list_pda_tariff_packs('2026-08-01');
  if exists (select 1 from jsonb_array_elements(packs) x where x->>'packRef' = ref1) then
    raise exception 'K6: an inactive terminal must drop its edition, and with it the pack it alone cited'; end if;
  begin perform public.get_pda_tariff_pack(ref1, '2026-08-01'); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'K6: the record of a pack with no governed edition must be PDA_VALIDATION, got %', e; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  update public.port_terminals set is_active = true where id = terminal;
  update public.ports set is_verified = false where locode = port_code;
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  packs := public.list_pda_tariff_packs('2026-08-01');
  if exists (select 1 from jsonb_array_elements(packs) x where x->>'packRef' in (ref1, ref2)) then
    raise exception 'K6: an unverified port must drop every pack at it'; end if;
  begin perform public.get_pda_tariff_pack(ref2, '2026-08-01'); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'K6: a pack at an unverified port must be PDA_VALIDATION, got %', e; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  update public.ports set is_verified = true where locode = port_code;
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  packs := public.list_pda_tariff_packs('2026-08-01');
  if (select count(*) from jsonb_array_elements(packs) x where x->>'packRef' in (ref1, ref2)) <> 2 then
    raise exception 'K6: both packs must be back once the port and terminal are restored'; end if;
  raise notice 'K6 ok: an inactive terminal and an unverified port are never read; restored, both packs return';

  -- K7 · a draft, an in-review version and an inactive set are never read (v3 of the port-wide set cites source2 from 2026-09-01)
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  v3 := public.pda_create_tariff_draft(maker, jsonb_build_object(
    'tariffSetId',(select tariff_set_id from public.port_tariff_versions where id = v1),
    'portLocode',port_code,'publisherId',publisher,'name','TP Port Call','scope','port_call','versionNo',3,'currency','USD',
    'effectiveFrom','2026-09-01','roundingMode','half_up','decimalPlaces',2,'primarySourceId',source2));
  perform public.pda_replace_tariff_rules(maker, v3, jsonb_build_array(
    jsonb_build_object('code','port_dues','label','Port dues','basis','per_gt','rate',0.14,'priority',10,'sourceId',source2,'sourcePage','3','sourceExcerpt','Draft rate'),
    jsonb_build_object('code','mooring','label','Mooring','basis','per_call','amount',50,'priority',20,'sourceId',source2,'sourcePage','3','sourceExcerpt','Draft mooring')));
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  select x into k from jsonb_array_elements(public.list_pda_tariff_packs('2026-09-15')) x where x->>'packRef' = ref2;
  if k is null or (k->>'lines')::int <> 1 then raise exception 'K7: a draft version must not be read (v2 still prices the port): %', k; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  perform public.pda_submit_tariff_version(maker, v3);
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  select x into k from jsonb_array_elements(public.list_pda_tariff_packs('2026-09-15')) x where x->>'packRef' = ref2;
  if k is null or (k->>'lines')::int <> 1 then raise exception 'K7: an in-review version must not be read: %', k; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  update public.port_tariff_sets set is_active = false where id = (select tariff_set_id from public.port_tariff_versions where id = tv);
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  if exists (select 1 from jsonb_array_elements(public.list_pda_tariff_packs('2026-08-01')) x where x->>'packRef' = ref1) then
    raise exception 'K7: an inactive set must not be read'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  update public.port_tariff_sets set is_active = true where id = (select tariff_set_id from public.port_tariff_versions where id = tv);
  raise notice 'K7 ok: draft, in-review and inactive-set editions are never read';

  -- K5 · grants
  if has_function_privilege('anon', 'public.list_pda_tariff_packs(date)', 'execute')
     or has_function_privilege('anon', 'public.get_pda_tariff_pack(text, date)', 'execute')
     or not has_function_privilege('authenticated', 'public.list_pda_tariff_packs(date)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_pda_tariff_pack(text, date)', 'execute')
     or not has_function_privilege('service_role', 'public.get_pda_tariff_pack(text, date)', 'execute')
     or not has_function_privilege('service_role', 'public.list_pda_tariff_packs(date)', 'execute')
     or has_function_privilege('authenticated', 'public.fn_pda_tariff_pack_ref(uuid)', 'execute')
     or has_function_privilege('anon', 'public.fn_pda_tariff_pack_ref(uuid)', 'execute') then
    raise exception 'K5: grants must be authenticated + service_role on the reads, nobody on the helper'; end if;

  raise notice 'K1–K7 ok: one pack per cited document, superseding moves the port, record without ids or URIs, opaque refs, gated, governed';
end $$;

do $m$ begin raise notice 'PDA TARIFF PACKS: ALL ASSERTIONS PASSED'; end $m$;
rollback;
