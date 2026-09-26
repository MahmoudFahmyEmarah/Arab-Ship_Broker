-- ── R1 · no member reads a fixture table through PostgREST ──────────────────
do $$
declare t text; v_ok boolean; v_bad text := '';
begin
  perform pg_temp.fx_as('u_ch1');
  foreach t in array array['fixture_rooms', 'fixture_parties', 'fixture_terms', 'fixture_proposals', 'fixture_subjects', 'fixture_messages', 'fixture_events', 'fixture_recap_versions', 'fixture_access_log'] loop
    v_ok := false;
    begin
      execute format('select 1 from public.%I limit 1', t);
    exception when insufficient_privilege then v_ok := true;
    end;
    if not v_ok then v_bad := v_bad || t || ' '; end if;
    v_ok := false;
    begin
      execute format('insert into public.%I default values', t);
    exception when insufficient_privilege then v_ok := true;
    when others then v_ok := false;
    end;
    if not v_ok then v_bad := v_bad || t || '(insert) '; end if;
  end loop;
  perform pg_temp.fx_owner();
  if v_bad <> '' then raise exception 'R1: authenticated can reach: %', v_bad; end if;
  -- the internal helpers are not member-callable either
  perform pg_temp.fx_as('u_ch1');
  v_ok := false;
  begin
    perform public.fn_fixture_snapshot_cargo(pg_temp.fx_id('c1'));
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.fx_owner();
  if not v_ok then raise exception 'R1: fn_fixture_snapshot_cargo is executable by members'; end if;
  raise notice 'R1 ok: every fixture table and internal helper is closed to authenticated';
end $$;

-- ── R2 · party-based access: outsider, pending member, anon ─────────────────
do $$
declare v jsonb; v_room uuid; e text; v_ok boolean; v_list jsonb;
begin
  perform pg_temp.fx_as('u_ch1');
  v := public.create_fixture_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'rls-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  -- an outsider (member of another organisation)
  perform pg_temp.fx_as('u_out');
  e := pg_temp.fx_err(format('select public.get_fixture_room(%L)', v_room));
  if e <> 'FX_AUTH' then raise exception 'R2: outsider read must be FX_AUTH, got %', e; end if;
  e := pg_temp.fx_err(format('select to_jsonb(public.get_fixture_room_version(%L))', v_room));
  if e <> 'FX_AUTH' then raise exception 'R2: outsider version poll must be FX_AUTH, got %', e; end if;
  v_list := public.list_fixture_rooms(null, 50);
  if jsonb_array_length(v_list) <> 0 then raise exception 'R2: outsider inbox must be empty'; end if;
  e := pg_temp.fx_err(format('select public.post_fixture_message(%L, %L, %L, %L, null, %s, %L)', v_room, 'hi', 'note', 'room', pg_temp.fx_ver(v_room), 'rls-out-msg'));
  if e <> 'FX_AUTH' then raise exception 'R2: outsider command must be FX_AUTH, got %', e; end if;
  -- a PENDING member of the owner organisation has no access (is_current = false)
  perform pg_temp.fx_as('u_pend');
  e := pg_temp.fx_err(format('select public.get_fixture_room(%L)', v_room));
  if e <> 'FX_AUTH' then raise exception 'R2: pending member read must be FX_AUTH, got %', e; end if;
  -- a PENDING member whose seat row is nonetheless CURRENT (a legacy shape) has no access either (FR-M1: current AND active)
  perform pg_temp.fx_as('u_pendcur');
  e := pg_temp.fx_err(format('select public.get_fixture_room(%L)', v_room));
  if e <> 'FX_AUTH' then raise exception 'R2: pending-but-current member read must be FX_AUTH, got %', e; end if;
  e := pg_temp.fx_err(format('select to_jsonb(public.get_fixture_room_version(%L))', v_room));
  if e <> 'FX_AUTH' then raise exception 'R2: pending-but-current member poll must be FX_AUTH, got %', e; end if;
  v_list := public.list_fixture_rooms(null, 50);
  if jsonb_array_length(v_list) <> 0 then raise exception 'R2: pending-but-current member inbox must be empty'; end if;
  e := pg_temp.fx_err(format('select public.respond_fixture_invitation(%L, true, %s, %L)', v_room, pg_temp.fx_ver(v_room), 'rls-pendcur-accept'));
  if e <> 'FX_AUTH' and e <> 'FX_STATE' then raise exception 'R2: pending-but-current member must not answer the organisation''s invitation, got %', e; end if;
  -- the charterer''s colleague (same organisation, broker seat) is a participant through the organisation party
  perform pg_temp.fx_as('u_ch2');
  v := public.get_fixture_room(v_room);
  if (v->'viewer'->>'side') <> 'cargo' then raise exception 'R2: colleague must resolve to the cargo side'; end if;
  -- anon cannot even execute the RPCs
  perform pg_temp.fx_anon();
  v_ok := false;
  begin
    perform public.get_fixture_room(v_room);
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.fx_owner();
  if not v_ok then raise exception 'R2: anon can execute get_fixture_room'; end if;
  raise notice 'R2 ok: outsider, pending member (current or not) and anon refused; a colleague of a party organisation is a participant';
end $$;

-- ── R3 · capacity: a viewer reads but cannot make commercial commands ───────
do $$
declare v jsonb; r jsonb; v_room uuid; e text; v_tid uuid;
begin
  perform pg_temp.fx_as('u_ch1');
  v := public.create_fixture_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'rls-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  v := public.invite_fixture_party(v_room, 'cargo', 'viewer', pg_temp.fx_id('org_out'), null, pg_temp.fx_ver(v_room), 'rls-invite-viewer');
  -- inviting onto the other side is refused for a principal
  e := pg_temp.fx_err(format('select public.invite_fixture_party(%L, %L, %L, null, %L, %s, %L)', v_room, 'vessel', 'viewer', pg_temp.fx_id('u_solo'), pg_temp.fx_ver(v_room), 'rls-invite-other-side'));
  if e <> 'FX_AUTH' then raise exception 'R3: inviting onto the other side must be FX_AUTH, got %', e; end if;
  perform pg_temp.fx_as('u_out');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'rls-viewer-accept');
  r := public.get_fixture_room(v_room);
  if (r->'viewer'->'capabilities'->>'canPropose')::boolean or (r->'viewer'->'capabilities'->>'canAccept')::boolean or (r->'viewer'->'capabilities'->>'canFixOnSubjects')::boolean then
    raise exception 'R3: a viewer must have no commercial capability: %', r->'viewer'->'capabilities'; end if;
  if (r->'viewer'->'capabilities'->>'canMessage')::boolean is not true then raise exception 'R3: a viewer may message'; end if;
  v_tid := pg_temp.fx_term(v_room, 'freight');
  e := pg_temp.fx_err(format('select public.submit_fixture_proposal(%L, %L, %L::jsonb, null, false, null, %s, %L)', v_room, v_tid, '{"num": 1}', pg_temp.fx_ver(v_room), 'rls-viewer-bid'));
  if e <> 'FX_AUTH' then raise exception 'R3: viewer proposing must be FX_AUTH (server refuses, not just the UI), got %', e; end if;
  e := pg_temp.fx_err(format('select public.add_fixture_subject(%L, %L, null, null, null, %s, %L)', v_room, 'x', pg_temp.fx_ver(v_room), 'rls-viewer-subject'));
  if e <> 'FX_STATE' and e <> 'FX_AUTH' then raise exception 'R3: viewer adding a subject must be refused, got %', e; end if;
  raise notice 'R3 ok: viewer reads and messages; every commercial command refused server-side';
end $$;

-- ── R4 · tier: invited parties act regardless of tier; admin inspection is audited and unmasked ─
do $$
declare v jsonb; r jsonb; v_room uuid; e text; v_tid uuid; v_before bigint; v_after bigint; p jsonb;
begin
  -- the owner (T3) opens a room on the T1 member''s cargo: the T1 member is invited and may act
  perform pg_temp.fx_as('u_ow1');
  v := public.create_fixture_room(pg_temp.fx_id('c2'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'rls-create-c2', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('u_t1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'rls-t1-accept');
  v_tid := pg_temp.fx_term(v_room, 'freight');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 21}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'rls-t1-bid');
  if (v->>'ok')::boolean is not true then raise exception 'R4: a T1 invitee must be able to bid'; end if;
  -- admin: unmasked read, every read logged
  perform pg_temp.fx_owner();
  select count(*) into v_before from public.fixture_access_log where room_id = v_room;
  perform pg_temp.fx_as('u_adm', true);
  r := public.get_fixture_room(v_room);
  perform pg_temp.fx_owner();
  select count(*) into v_after from public.fixture_access_log where room_id = v_room;
  if v_after <> v_before + 1 then raise exception 'R4: admin read must write one fixture_access_log row (% → %)', v_before, v_after; end if;
  if not exists (select 1 from public.fixture_access_log where room_id = v_room and user_id = pg_temp.fx_id('u_adm') and is_admin) then raise exception 'R4: access log row must name the admin'; end if;
  if (r->'viewer'->>'isAdmin')::boolean is not true then raise exception 'R4: admin flag'; end if;
  select x into p from jsonb_array_elements(r->'parties') x where x->>'side' = 'vessel' and x->>'capacity' = 'principal';
  if p->>'orgId' <> pg_temp.fx_id('org_ow')::text or p->>'name' <> 'Seed Owners SA' then raise exception 'R4: admin must see raw ids and names: %', p; end if;
  -- the member read is NOT logged
  select count(*) into v_before from public.fixture_access_log where room_id = v_room;
  perform pg_temp.fx_as('u_ow1');
  r := public.get_fixture_room(v_room);
  perform pg_temp.fx_owner();
  select count(*) into v_after from public.fixture_access_log where room_id = v_room;
  if v_after <> v_before then raise exception 'R4: member reads must not write the access log'; end if;
  -- the log is append-only
  begin
    delete from public.fixture_access_log where room_id = v_room;
    raise exception 'R4: access log delete must be refused';
  exception when others then
    if sqlerrm not like 'FX_IMMUTABLE:%' then raise; end if;
  end;
  -- the admin console reads the log through admin_fixture_access_log: admins only, and reading it is not logged
  perform pg_temp.fx_as('u_ow1');
  e := pg_temp.fx_err(format('select public.admin_fixture_access_log(%L, 50)', v_room));
  if e <> 'FX_AUTH' then raise exception 'R4: a member reading the access log must be FX_AUTH, got %', e; end if;
  perform pg_temp.fx_owner();
  select count(*) into v_before from public.fixture_access_log where room_id = v_room;
  perform pg_temp.fx_as('u_adm', true);
  r := public.admin_fixture_access_log(v_room, 50);
  perform pg_temp.fx_owner();
  select count(*) into v_after from public.fixture_access_log where room_id = v_room;
  -- (an admin who is the platform party of the room is logged as 'mediate'; an admin who is not, as 'inspect')
  if jsonb_array_length(r) < 1 or not exists (select 1 from jsonb_array_elements(r) x where x->>'reason' in ('inspect', 'mediate') and (x->>'isAdmin')::boolean and x->>'userId' = pg_temp.fx_id('u_adm')::text) then
    raise exception 'R4: the access log read must list the admin inspection: %', r; end if;
  if v_after <> v_before then raise exception 'R4: reading the access log must not write to it'; end if;
  perform pg_temp.fx_as('u_adm', true);
  e := pg_temp.fx_err(format('select public.admin_fixture_access_log(%L, 50)', gen_random_uuid()));
  if e <> 'FX_NOT_FOUND' then raise exception 'R4: an unknown room must be FX_NOT_FOUND, got %', e; end if;
  perform pg_temp.fx_owner();
  raise notice 'R4 ok: T1 invitee acts; admin reads are unmasked and logged; member reads are not; the log is append-only and admin-only to read';
end $$;

-- ── R5 · an anonymised member (the INT-H1 tombstone) cannot act as its former party; the counterparty keeps the room ─
do $$
declare v jsonb; r jsonb; v_room uuid; e text; p jsonb; v_tid uuid;
begin
  -- the charterer opens a room on the solo owner's position; the owner accepts, offers, and agrees to disclose
  perform pg_temp.fx_as('u_ch1');
  v := public.create_fixture_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a4'), pg_temp.fx_terms(), 'rls-create-a4', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('u_solo');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'rls-a4-accept');
  v_tid := pg_temp.fx_term(v_room, 'freight');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 26}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'rls-a4-offer');
  v := public.agree_fixture_disclosure(v_room, pg_temp.fx_ver(v_room), 'rls-a4-disc-solo');
  -- the platform erases the solo owner: the tombstone shape fn_anonymize_account leaves behind
  -- (integration branch b6aed98): row kept, PII scrubbed, inactive, login link severed, seats rejected
  perform pg_temp.fx_owner();
  update public.users set full_name = 'Deleted account', company = null, email = null, phone = null, role = null,
         is_active = false, subscription_tier = 'T1', supabase_user_id = null where id = pg_temp.fx_id('u_solo');
  update public.organization_members set is_current = false, status = 'rejected' where user_id = pg_temp.fx_id('u_solo');
  -- a token the erased account still held is refused at the Fixture boundary: read, poll, inbox, answer, act, create
  perform pg_temp.fx_as('u_solo');
  e := pg_temp.fx_err(format('select public.get_fixture_room(%L)', v_room));
  if e <> 'FX_AUTH' then raise exception 'R5: erased member read must be FX_AUTH, got %', e; end if;
  e := pg_temp.fx_err(format('select to_jsonb(public.get_fixture_room_version(%L))', v_room));
  if e <> 'FX_AUTH' then raise exception 'R5: erased member poll must be FX_AUTH, got %', e; end if;
  e := pg_temp.fx_err('select public.list_fixture_rooms(null, 50)');
  if e <> 'FX_AUTH' then raise exception 'R5: erased member inbox must be FX_AUTH, got %', e; end if;
  e := pg_temp.fx_err(format('select public.submit_fixture_proposal(%L, %L, %L::jsonb, null, false, null, %s, %L)', v_room, v_tid, '{"num": 25}', pg_temp.fx_ver(v_room), 'rls-a4-erased-offer'));
  if e <> 'FX_AUTH' then raise exception 'R5: erased member proposing must be FX_AUTH, got %', e; end if;
  e := pg_temp.fx_err(format('select public.respond_fixture_invitation(%L, true, %s, %L)', v_room, pg_temp.fx_ver(v_room), 'rls-a4-erased-answer'));
  if e <> 'FX_AUTH' then raise exception 'R5: erased member answering must be FX_AUTH, got %', e; end if;
  e := pg_temp.fx_err(format('select public.post_fixture_message(%L, %L, %L, %L, null, %s, %L)', v_room, 'still here?', 'note', 'room', pg_temp.fx_ver(v_room), 'rls-a4-erased-msg'));
  if e <> 'FX_AUTH' then raise exception 'R5: erased member messaging must be FX_AUTH, got %', e; end if;
  e := pg_temp.fx_err(format('select public.create_fixture_room(%L, %L, pg_temp.fx_terms(), %L, %L::jsonb)', pg_temp.fx_id('c2'), pg_temp.fx_id('a4'), 'rls-a4-erased-create', '{}'));
  if e <> 'FX_AUTH' then raise exception 'R5: erased member creating must be FX_AUTH, got %', e; end if;
  -- the counterparty keeps the room and its history, and never sees a person behind the vacated seat
  perform pg_temp.fx_as('u_ch1');
  r := public.get_fixture_room(v_room);
  select x into p from jsonb_array_elements(r->'parties') x where x->>'side' = 'vessel' and x->>'capacity' = 'principal';
  if p->>'label' <> 'Owner side' or p->>'status' <> 'active' then raise exception 'R5: the vacated seat must keep its label and status: %', p; end if;
  if not exists (select 1 from jsonb_array_elements(r->'terms') x where x->>'code' = 'freight' and x->'vesselPosition'->>'displayValue' = '$26.00/MT') then
    raise exception 'R5: the erased member''s offer must remain on the record'; end if;
  if r::text like '%Seed Solo Owner%' or r::text like '%u_solo@fixture.test%' or r::text like '%Solo Shipping%' then
    raise exception 'R5: PII of the erased member reached the counterparty'; end if;
  -- disclosure completes from the charterer's side: the tombstone discloses as a generic label, never a person
  v := public.agree_fixture_disclosure(v_room, pg_temp.fx_ver(v_room), 'rls-a4-disc-ch');
  if (v->'data'->>'disclosed')::boolean is not true then raise exception 'R5: both principals agreed, disclosure expected'; end if;
  r := public.get_fixture_room(v_room);
  select x into p from jsonb_array_elements(r->'parties') x where x->>'side' = 'vessel' and x->>'capacity' = 'principal';
  if p->>'name' <> 'Registered member' or p->>'deskLabel' is not null then raise exception 'R5: an erased member discloses as "Registered member" only, got %', p; end if;
  if r::text like '%Deleted account%' then raise exception 'R5: the tombstone name must not surface either'; end if;
  raise notice 'R5 ok: an anonymised member is refused on read, poll, inbox, answer, act and create; the counterparty keeps the room, the history and a person-free label';
end $$;

-- ── R6 · market partner: a T1 member flagged is_market_partner passes the tier gate (integration migration 20260923340000); skipped where the column is absent ─
do $$
declare v jsonb; e text; v_room uuid;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'is_market_partner') then
    raise notice 'R6 skipped: users.is_market_partner is absent on this database (the integration chain restores it in 20260923340000)';
    return;
  end if;
  -- without the flag the T1 member is refused on a free pairing (c2 + a3: R4 holds c2 + a1 open, a2 is the seed's sanctioned vessel)
  perform pg_temp.fx_as('u_t1');
  e := pg_temp.fx_err(format('select public.create_fixture_room(%L, %L, pg_temp.fx_terms(), %L, %L::jsonb)', pg_temp.fx_id('c2'), pg_temp.fx_id('a3'), 'rls-r6-t1-nopartner', '{}'));
  if e <> 'FX_GATE' then raise exception 'R6: a T1 member without the flag must be FX_GATE, got %', e; end if;
  -- the platform grants the flag: a service-owned column, written here as the owner with no JWT (the same bypass the service role has)
  perform pg_temp.fx_owner();
  execute format('update public.users set is_market_partner = true where id = %L', pg_temp.fx_id('u_t1'));
  perform pg_temp.fx_as('u_t1');
  v := public.create_fixture_room(pg_temp.fx_id('c2'), pg_temp.fx_id('a3'), pg_temp.fx_terms(), 'rls-r6-t1-partner', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  if v_room is null then raise exception 'R6: a flagged T1 member must open a room, got %', v; end if;
  if pg_temp.fx_status(v_room) <> 'invited' then raise exception 'R6: the room must be invited, got %', pg_temp.fx_status(v_room); end if;
  raise notice 'R6 ok: a T1 market partner passes the tier gate (FX_GATE without the flag, a room with it)';
end $$;
