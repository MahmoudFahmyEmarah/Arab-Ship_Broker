-- Fixture Room · STORED RECAP PDF body (O2ALL-005, 9 Oct 2026): the records of 20261009300000. The PDF bytes are
-- rendered by the server (scripts/fixture-recap-pdf-check.ts proves them); this suite proves the database side.
--   P1  the source is the published, masked recap with a side label for the publisher (service only)
--   P2  the record is set-once: a replay with the same digest returns it; another digest or a bad path is refused
--   P3  the record can never be edited
--   P4  a party reads it for their room; a member outside the room is told it does not exist
--   P5  nothing is reachable from the API roles directly

do $$
declare v jsonb; s jsonb; v_room uuid; v_recap uuid; v_sha text := repeat('ab', 32); v_path text; e text; n int;
begin
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'pdf-create', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'pdf-accept');
  perform pg_temp.fx_as('u_ch1');
  -- the first figure opens the negotiation (a recap needs negotiating, on subjects or fixed)
  v := public.submit_fixture_proposal(v_room, pg_temp.fx_term(v_room, 'quantity'), '{"num": 26000}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'pdf-bid-qty');
  v := public.publish_fixture_recap(v_room, pg_temp.fx_ver(v_room), 'pdf-recap-1');
  v_recap := (v->'data'->>'recapVersionId')::uuid;

  -- P1 · the source
  perform pg_temp.fx_owner();
  s := public.fixture_recap_pdf_source(v_recap);
  if s->>'roomId' <> v_room::text or (s->>'versionNo')::int <> 1 or s->>'publisherLabel' <> 'Charterer side' or s->'content' is null
     or s->>'contentHash' is distinct from (select content_hash from public.fixture_recap_versions where id = v_recap) then
    raise exception 'P1: the source must be the published recap with a side label: %', s; end if;
  if exists (select 1 from jsonb_array_elements(s->'content'->'parties') p where p->>'name' is not null and not coalesce((p->>'isPlatform')::boolean, false)
               and (s->'content'->>'counterpartyDisclosed')::boolean is not true and p->>'label' not ilike '%shipbroker%') then
    raise exception 'P1: an undisclosed party name reached the PDF source'; end if;
  raise notice 'P1 ok: the PDF source is the published, masked recap; the publisher is a side label';

  -- P2 · set-once
  v_path := v_room::text || '/recap-v1-' || left(v_sha, 16) || '.pdf';
  v := public.record_fixture_recap_pdf(v_recap, v_path, v_sha, 3915, 'recap-pdf/1');
  if v->>'sha256' <> v_sha or v->>'path' <> v_path then raise exception 'P2: record expected: %', v; end if;
  v := public.record_fixture_recap_pdf(v_recap, v_path, v_sha, 3915, 'recap-pdf/1');
  if (select count(*) from public.fixture_recap_pdfs where recap_version_id = v_recap) <> 1 then raise exception 'P2: a replay must not add a row'; end if;
  e := pg_temp.fx_err(format('select public.record_fixture_recap_pdf(%L, %L, %L, 4000, %L)', v_recap, v_room::text || '/recap-v1-' || repeat('cd', 8) || '.pdf', repeat('cd', 32), 'recap-pdf/1'));
  if e <> 'FX_CONFLICT' then raise exception 'P2: another digest for the same version must be FX_CONFLICT, got %', e; end if;
  e := pg_temp.fx_err(format('select public.record_fixture_recap_pdf(%L, %L, %L, 4000, %L)', v_recap, 'elsewhere/x.pdf', repeat('ef', 32), 'recap-pdf/1'));
  if e <> 'FX_VALIDATION' then raise exception 'P2: a path outside <room>/recap-v<n>-<digest>.pdf must be refused, got %', e; end if;
  e := pg_temp.fx_err(format('select public.record_fixture_recap_pdf(%L, %L, %L, 4000, %L)', v_recap, v_path, 'NOT-HEX', 'recap-pdf/1'));
  if e <> 'FX_VALIDATION' then raise exception 'P2: a malformed digest must be refused, got %', e; end if;
  raise notice 'P2 ok: set-once — a replay returns the record; another digest, a foreign path or a bad digest is refused';

  -- P3 · never edited
  begin
    update public.fixture_recap_pdfs set sha256 = repeat('00', 32) where recap_version_id = v_recap;
    raise exception 'P3: a stored PDF record was edited';
  exception when others then
    if sqlerrm not like 'FX_IMMUTABLE%' then raise; end if;
  end;
  raise notice 'P3 ok: a stored PDF record cannot be changed';

  -- P4 · who may read it
  perform pg_temp.fx_as('u_ow1');
  v := public.get_fixture_recap_pdf(v_room, 1);
  if (v->>'stored')::boolean is not true or v->>'sha256' <> v_sha or v->>'path' <> v_path or v->>'recapVersionId' <> v_recap::text then
    raise exception 'P4: the counterparty reads the stored PDF record: %', v; end if;
  perform pg_temp.fx_as('u_out');
  e := pg_temp.fx_err(format('select public.get_fixture_recap_pdf(%L, 1)', v_room));
  if e <> 'FX_NOT_FOUND' then raise exception 'P4: a member outside the room must get FX_NOT_FOUND, got %', e; end if;
  perform pg_temp.fx_as('u_ch1');
  e := pg_temp.fx_err(format('select public.get_fixture_recap_pdf(%L, 9)', v_room));
  if e <> 'FX_NOT_FOUND' then raise exception 'P4: an unknown version is FX_NOT_FOUND, got %', e; end if;
  raise notice 'P4 ok: a party reads the record of its room; an outsider and an unknown version are not found';

  -- P5 · grants
  perform pg_temp.fx_owner();
  if has_table_privilege('authenticated', 'public.fixture_recap_pdfs', 'select') or has_table_privilege('service_role', 'public.fixture_recap_pdfs', 'insert')
     or has_function_privilege('authenticated', 'public.fixture_recap_pdf_source(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.record_fixture_recap_pdf(uuid, text, text, integer, text)', 'execute')
     or has_function_privilege('anon', 'public.get_fixture_recap_pdf(uuid, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_fixture_recap_pdf(uuid, integer)', 'execute')
     or not has_function_privilege('service_role', 'public.record_fixture_recap_pdf(uuid, text, text, integer, text)', 'execute') then
    raise exception 'P5: grants are not private-by-default'; end if;
  raise notice 'P5 ok: the table is private; source and record are service-only; members get the read';
end $$;
