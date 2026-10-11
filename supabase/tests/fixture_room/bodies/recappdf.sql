-- Fixture Room · STORED RECAP PDF body (O2ALL-005/006, C2O-101, 9 Oct 2026): the records of 20261009300000. The PDF
-- bytes and the store's order are proven by scripts/fixture-recap-pdf-check.ts; this suite proves the database side.
--   P1  the source is the published, masked recap with a side label for the publisher (service only)
--   P2  binding is set-once (full-digest path); a replay returns it; another digest, renderer or path is refused;
--       finalize moves pending → stored, and a stored record stays stored
--   P3  the binding can never be edited and a record can never be deleted
--   P4  a party reads its room's record; an outsider and an unknown version are not found; an admin read is logged
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
  raise notice 'P1 ok: the PDF source is the published, masked recap; the publisher is a side label';

  -- P2 · set-once binding, then finalize
  v_path := v_room::text || '/recap-v1-' || v_sha || '.pdf';
  v := public.bind_fixture_recap_pdf(v_recap, v_path, v_sha, 1710000, 'recap-pdf/2');
  if v->>'status' <> 'pending' or v->>'path' <> v_path then raise exception 'P2: a new binding is pending: %', v; end if;
  v := public.bind_fixture_recap_pdf(v_recap, v_path, v_sha, 1710000, 'recap-pdf/2');
  if (select count(*) from public.fixture_recap_pdfs where recap_version_id = v_recap) <> 1 then raise exception 'P2: a replay must not add a row'; end if;
  e := pg_temp.fx_err(format('select public.bind_fixture_recap_pdf(%L, %L, %L, 1710000, %L)', v_recap, v_room::text || '/recap-v1-' || repeat('cd', 32) || '.pdf', repeat('cd', 32), 'recap-pdf/2'));
  if e <> 'FX_CONFLICT' then raise exception 'P2: another digest for the same version must be FX_CONFLICT, got %', e; end if;
  e := pg_temp.fx_err(format('select public.bind_fixture_recap_pdf(%L, %L, %L, 1710000, %L)', v_recap, v_path, v_sha, 'recap-pdf/3'));
  if e <> 'FX_CONFLICT' then raise exception 'P2: another renderer for the same version must be FX_CONFLICT, got %', e; end if;
  e := pg_temp.fx_err(format('select public.bind_fixture_recap_pdf(%L, %L, %L, 4000, %L)', v_recap, v_room::text || '/recap-v1-' || left(v_sha, 16) || '.pdf', v_sha, 'recap-pdf/2'));
  if e <> 'FX_VALIDATION' then raise exception 'P2: a path without the full digest must be refused, got %', e; end if;
  e := pg_temp.fx_err(format('select public.finalize_fixture_recap_pdf(%L, %L, true)', v_recap, repeat('cd', 32)));
  if e <> 'FX_CONFLICT' then raise exception 'P2: finalizing another digest must be refused, got %', e; end if;
  v := public.finalize_fixture_recap_pdf(v_recap, v_sha, false, 'upload refused (503)');
  if v->>'status' <> 'failed' then raise exception 'P2: a failed store is recorded as failed: %', v; end if;
  v := public.finalize_fixture_recap_pdf(v_recap, v_sha, true);
  if v->>'status' <> 'stored' then raise exception 'P2: a verified retry moves failed → stored: %', v; end if;
  v := public.finalize_fixture_recap_pdf(v_recap, v_sha, false, 'late failure');
  if v->>'status' <> 'stored' then raise exception 'P2: a stored record stays stored: %', v; end if;
  raise notice 'P2 ok: set-once full-digest binding; other digest, renderer or path refused; failed → stored; stored is final';

  -- P3 · never edited, never deleted
  begin
    update public.fixture_recap_pdfs set sha256 = repeat('00', 32) where recap_version_id = v_recap;
    raise exception 'P3: a binding was edited';
  exception when others then if sqlerrm not like 'FX_IMMUTABLE%' then raise; end if;
  end;
  begin
    delete from public.fixture_recap_pdfs where recap_version_id = v_recap;
    raise exception 'P3: a record was deleted';
  exception when others then if sqlerrm not like 'FX_IMMUTABLE%' then raise; end if;
  end;
  raise notice 'P3 ok: a stored recap PDF binding cannot be edited and a record cannot be deleted';

  -- P4 · who may read it; an admin read is logged
  perform pg_temp.fx_as('u_ow1');
  v := public.get_fixture_recap_pdf(v_room, 1);
  if v->>'status' <> 'stored' or v->>'sha256' <> v_sha or v->>'path' <> v_path or v->>'recapVersionId' <> v_recap::text then
    raise exception 'P4: the counterparty reads the stored PDF record: %', v; end if;
  perform pg_temp.fx_as('u_out');
  e := pg_temp.fx_err(format('select public.get_fixture_recap_pdf(%L, 1)', v_room));
  if e <> 'FX_NOT_FOUND' then raise exception 'P4: a member outside the room must get FX_NOT_FOUND, got %', e; end if;
  perform pg_temp.fx_as('u_ch1');
  e := pg_temp.fx_err(format('select public.get_fixture_recap_pdf(%L, 9)', v_room));
  if e <> 'FX_NOT_FOUND' then raise exception 'P4: an unknown version is FX_NOT_FOUND, got %', e; end if;
  perform pg_temp.fx_owner();
  select count(*) into n from public.fixture_access_log where room_id = v_room and reason = 'recap-pdf';
  perform pg_temp.fx_as('u_adm', true);
  v := public.get_fixture_recap_pdf(v_room, 1);
  perform pg_temp.fx_owner();
  if (select count(*) from public.fixture_access_log where room_id = v_room and reason = 'recap-pdf' and user_id = pg_temp.fx_id('u_adm')) <> n + 1 then
    raise exception 'P4: an admin read of the recap PDF must be written to the access log'; end if;
  raise notice 'P4 ok: a party reads its room''s record; an outsider and an unknown version are not found; an admin read is logged';

  -- P5 · grants
  if has_table_privilege('authenticated', 'public.fixture_recap_pdfs', 'select') or has_table_privilege('service_role', 'public.fixture_recap_pdfs', 'insert')
     or has_function_privilege('authenticated', 'public.fixture_recap_pdf_source(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.bind_fixture_recap_pdf(uuid, text, text, integer, text)', 'execute')
     or has_function_privilege('authenticated', 'public.finalize_fixture_recap_pdf(uuid, text, boolean, text)', 'execute')
     or has_function_privilege('authenticated', 'public.fixture_recap_pdf_bound_paths(uuid)', 'execute')
     or has_function_privilege('anon', 'public.get_fixture_recap_pdf(uuid, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_fixture_recap_pdf(uuid, integer)', 'execute')
     or not has_function_privilege('service_role', 'public.bind_fixture_recap_pdf(uuid, text, text, integer, text)', 'execute') then
    raise exception 'P5: grants are not private-by-default'; end if;
  raise notice 'P5 ok: the table is private; source, bind, finalize and paths are service-only; members get the read';
end $$;
