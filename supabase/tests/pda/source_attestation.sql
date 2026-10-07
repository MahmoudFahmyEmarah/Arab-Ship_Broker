-- PDA source attestation (20261007330000): an owner-only admin raises a reference/unverified source to a
-- trusted authority with a stated provenance; upgrade only; append-only audit; then a draft citing it can be
-- submitted (before, the trusted-evidence gate refused it). Rolled back.
begin;

do $$
declare
  admin uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  v_pub uuid; v_src uuid; v_trusted uuid; v_version uuid; v_att uuid; v_port text;
  denied boolean;
  bad jsonb;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, f.id, 'authenticated', 'authenticated', f.email,
         crypt('PdaAttest1!', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
    from (values (admin, 'pda-attest-admin@example.test'), (member, 'pda-attest-member@example.test')) f(id, email);
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier) values
    (admin, admin, 'pda-attest-admin@example.test', 'PDA Attest Admin', 'admin', true, null, 'T4'),
    (member, member, 'pda-attest-member@example.test', 'PDA Attest Member', 'cargo_owner', true, null, 'T3');

  v_pub := public.pda_upsert_tariff_publisher(admin, '{"name":"Attestation test publisher","publisherType":"other","country":"Turkey"}');
  v_src := public.pda_register_tariff_source(admin, jsonb_build_object('publisherId', v_pub, 'title', 'Attestation test document',
    'sourceFilename', 'attest.docx', 'mimeType', 'application/pdf', 'sha256', repeat('ab', 32), 'authority', 'reference'));
  v_trusted := public.pda_register_tariff_source(admin, jsonb_build_object('publisherId', v_pub, 'title', 'Already official document',
    'sourceFilename', 'official.pdf', 'mimeType', 'application/pdf', 'sha256', repeat('cd', 32), 'authority', 'official'));

  -- A1 · a draft citing the reference source is refused at submission (the gate this feature unlocks)
  select locode into v_port from public.ports where is_active and is_verified order by locode limit 1;
  if v_port is null then raise exception 'A1: no active verified port to draft on'; end if;
  v_version := public.pda_create_tariff_draft(admin, jsonb_build_object('portLocode', v_port, 'publisherId', v_pub,
    'name', 'Attestation test tariff', 'scope', 'port_call', 'versionNo', 1, 'currency', 'USD', 'effectiveFrom', '2026-01-01',
    'roundingMode', 'half_up', 'decimalPlaces', 2, 'primarySourceId', v_src));
  perform public.pda_replace_tariff_rules(admin, v_version, jsonb_build_array(jsonb_build_object(
    'code', 'attest_fee', 'label', 'Attestation test fee', 'basis', 'per_call', 'amount', 10, 'priority', 10,
    'applicability', '{"requestedServices":["port_dues"]}'::jsonb, 'sourceId', v_src, 'sourcePage', 'p. 1', 'sourceExcerpt', 'fee 10')));
  denied := false;
  begin perform public.pda_submit_tariff_version(admin, v_version);
  exception when others then if sqlerrm like 'PDA_SOURCE:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'A1: a reference-backed version was submitted'; end if;

  -- A2 · only an owner-tier admin attests
  denied := false;
  begin perform public.pda_attest_tariff_source(member, jsonb_build_object('sourceId', v_src, 'authority', 'agent',
    'provenance', 'Received from the port agent by email on 7 Oct 2026'));
  exception when others then if sqlerrm like 'PDA_AUTH:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'A2: a member attested a source'; end if;

  -- A3 · input validation: authority, provenance length, unknown source, bad id
  foreach bad in array array[
    jsonb_build_object('sourceId', v_src, 'authority', 'reference', 'provenance', 'Received from the port agent by email'),
    jsonb_build_object('sourceId', v_src, 'authority', 'owner', 'provenance', 'Received from the port agent by email'),
    jsonb_build_object('sourceId', v_src, 'authority', 'agent', 'provenance', 'from an agent'),
    jsonb_build_object('sourceId', gen_random_uuid(), 'authority', 'agent', 'provenance', 'Received from the port agent by email'),
    jsonb_build_object('sourceId', 'not-a-uuid', 'authority', 'agent', 'provenance', 'Received from the port agent by email')
  ] loop
    denied := false;
    begin perform public.pda_attest_tariff_source(admin, bad);
    exception when others then if sqlerrm like 'PDA_ATTEST:%' or sqlerrm like 'PDA_INPUT:%' then denied := true; else raise; end if; end;
    if not denied then raise exception 'A3: an invalid attestation was accepted: %', bad; end if;
  end loop;
  if (select authority from public.tariff_sources where id = v_src) <> 'reference' then raise exception 'A3: a refused attestation changed the source'; end if;

  -- A4 · a valid attestation raises the source and records who, from, to and why
  v_att := public.pda_attest_tariff_source(admin, jsonb_build_object('sourceId', v_src, 'authority', 'Agent',
    'provenance', '  Received from the port agent by email on 7 Oct 2026  '));
  if (select authority from public.tariff_sources where id = v_src) <> 'agent' then raise exception 'A4: the source was not raised'; end if;
  if not exists (select 1 from public.tariff_source_attestations where id = v_att and source_id = v_src and from_authority = 'reference'
      and to_authority = 'agent' and attested_by = admin and provenance = 'Received from the port agent by email on 7 Oct 2026') then
    raise exception 'A4: the attestation row is wrong'; end if;

  -- A5 · upgrade only: an attested or already trusted source is not attested again (no downgrade, no relabel)
  foreach bad in array array[
    jsonb_build_object('sourceId', v_src, 'authority', 'official', 'provenance', 'A second opinion on the same document'),
    jsonb_build_object('sourceId', v_trusted, 'authority', 'agent', 'provenance', 'Trying to relabel an official source')
  ] loop
    denied := false;
    begin perform public.pda_attest_tariff_source(admin, bad);
    exception when others then if sqlerrm like 'PDA_ATTEST:%already%' then denied := true; else raise; end if; end;
    if not denied then raise exception 'A5: a trusted source was attested again: %', bad; end if;
  end loop;

  -- A6 · attestations are append-only
  denied := false;
  begin update public.tariff_source_attestations set provenance = 'rewritten provenance text here' where id = v_att;
  exception when others then if sqlerrm like 'PDA_ATTEST:%append-only%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'A6: an attestation was edited'; end if;
  denied := false;
  begin delete from public.tariff_source_attestations where id = v_att;
  exception when others then if sqlerrm like 'PDA_ATTEST:%append-only%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'A6: an attestation was deleted'; end if;

  -- A7 · the same draft now submits (the trusted-evidence gate accepts the attested source)
  perform public.pda_submit_tariff_version(admin, v_version);
  if (select status from public.port_tariff_versions where id = v_version) <> 'in_review' then
    raise exception 'A7: the attested version was not submitted'; end if;

  -- A8 · grants: service_role only; members never read the table
  if has_function_privilege('authenticated', 'public.pda_attest_tariff_source(uuid, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.pda_attest_tariff_source(uuid, jsonb)', 'execute') then
    raise exception 'A8: members can attest'; end if;
  if not has_function_privilege('service_role', 'public.pda_attest_tariff_source(uuid, jsonb)', 'execute') then
    raise exception 'A8: service_role cannot attest'; end if;
  if has_table_privilege('authenticated', 'public.tariff_source_attestations', 'select')
     or has_table_privilege('anon', 'public.tariff_source_attestations', 'select')
     or has_table_privilege('service_role', 'public.tariff_source_attestations', 'insert') then
    raise exception 'A8: the attestation table is over-granted'; end if;
end $$;

do $m$ begin raise notice 'PDA SOURCE ATTESTATION: ALL ASSERTIONS PASSED'; end $m$;
rollback;
