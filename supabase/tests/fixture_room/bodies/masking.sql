-- ── M1 · before disclosure: labels only, no identity keys, no contact PII, no notes ─
do $$
declare v jsonb; r jsonb; v_room uuid; p jsonb; s text;
begin
  perform pg_temp.fx_as('u_ch1');
  v := public.create_fixture_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'mask-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'mask-accept');
  perform pg_temp.fx_as('u_ch1');
  r := public.get_fixture_room(v_room);
  s := r::text;
  select x into p from jsonb_array_elements(r->'parties') x where x->>'side' = 'vessel' and x->>'capacity' = 'principal';
  if p->>'label' <> 'Owner side' or p->>'name' is not null or p->>'deskLabel' is not null then raise exception 'M1: owner must be a label only: %', p; end if;
  if p ? 'orgId' or p ? 'userId' or p ? 'contactId' then raise exception 'M1: identity keys leaked: %', p; end if;
  if s like '%' || pg_temp.fx_id('org_ow')::text || '%' then raise exception 'M1: the owner organisation id is in the payload'; end if;
  if s like '%' || pg_temp.fx_id('u_ow1')::text || '%' then raise exception 'M1: the owner user id is in the payload'; end if;
  if s like '%Seed Owners SA%' then raise exception 'M1: the owner name is in the payload before disclosure'; end if;
  if s like '%seed-owners.test%' or s like '%+30 210%' or s like '%Capt. Seed%' or s like '%owner mobile%' or s like '%charterer mobile%' or s like '%Tasos%' then
    raise exception 'M1: contact PII from the listings / vessel / notes reached the payload'; end if;
  -- the viewer''s own organisation is visible to itself
  select x into p from jsonb_array_elements(r->'parties') x where x->>'side' = 'cargo' and x->>'capacity' = 'principal';
  if p->>'name' <> 'Seed Charterers Ltd' or p->>'deskLabel' <> 'Chartering Desk' then raise exception 'M1: own organisation should be visible: %', p; end if;
  if p ? 'orgId' then raise exception 'M1: even own raw org id is not returned to members'; end if;
  -- symmetric for the owner
  perform pg_temp.fx_as('u_ow1');
  r := public.get_fixture_room(v_room);
  s := r::text;
  if s like '%Seed Charterers Ltd%' or s like '%' || pg_temp.fx_id('org_ch')::text || '%' then raise exception 'M1: charterer identity leaked to the owner'; end if;
  raise notice 'M1 ok: counterparties are labels; no identity keys, names, emails, phones or listing notes in member payloads';
end $$;

-- ── M2 · disclosure needs both principals; then name + desk label only ──────
do $$
declare v jsonb; r jsonb; v_room uuid; p jsonb; s text; e text;
begin
  perform pg_temp.fx_as('u_ch1');
  v := public.create_fixture_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'mask-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  v := public.agree_fixture_disclosure(v_room, pg_temp.fx_ver(v_room), 'mask-disc-ch');
  if (v->'data'->>'disclosed')::boolean then raise exception 'M2: one side agreeing must not disclose'; end if;
  e := pg_temp.fx_err(format('select public.agree_fixture_disclosure(%L, %s, %L)', v_room, pg_temp.fx_ver(v_room), 'mask-disc-ch-2'));
  if e <> 'FX_STATE' then raise exception 'M2: agreeing twice must be FX_STATE, got %', e; end if;
  r := public.get_fixture_room(v_room);
  select x into p from jsonb_array_elements(r->'parties') x where x->>'side' = 'vessel' and x->>'capacity' = 'principal';
  if p->>'name' is not null then raise exception 'M2: still masked until the owner agrees'; end if;
  perform pg_temp.fx_as('u_ow1');
  v := public.agree_fixture_disclosure(v_room, pg_temp.fx_ver(v_room), 'mask-disc-ow');
  if (v->'data'->>'disclosed')::boolean is not true then raise exception 'M2: both agreed must disclose: %', v; end if;
  if pg_temp.fx_event_types(v_room) not like '%party.disclosure_agreed,room.counterparty_disclosed%' then raise exception 'M2: ledger %', pg_temp.fx_event_types(v_room); end if;
  perform pg_temp.fx_as('u_ch1');
  r := public.get_fixture_room(v_room);
  s := r::text;
  select x into p from jsonb_array_elements(r->'parties') x where x->>'side' = 'vessel' and x->>'capacity' = 'principal';
  if p->>'name' <> 'Seed Owners SA' or p->>'deskLabel' <> 'Owner''s Desk' then raise exception 'M2: disclosed name/desk expected: %', p; end if;
  if p ? 'orgId' then raise exception 'M2: raw org id must stay hidden after disclosure'; end if;
  if s like '%seed-owners.test%' or s like '%+30 210%' or s like '%Capt. Seed%' then raise exception 'M2: email / phone / person leaked after disclosure'; end if;
  if (r->'room'->>'counterpartyDisclosed')::boolean is not true then raise exception 'M2: room flag'; end if;
  raise notice 'M2 ok: disclosure requires both principals; afterwards the organisation name and desk label only';
end $$;

-- ── M3 · TBN vessel identity is counterparty identity ───────────────────────
do $$
declare v jsonb; r jsonb; v_room uuid;
begin
  perform pg_temp.fx_as('u_ch1');
  v := public.create_fixture_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a3'), pg_temp.fx_terms(), 'mask-create-tbn', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  r := public.get_fixture_room(v_room);
  if r->'snapshot'->'vessel'->'vessel'->>'vessel_name' <> 'TBN' or (r->'snapshot'->'vessel'->'vessel'->>'imo_number') is not null or (r->'snapshot'->>'vesselIdentityMasked')::boolean is not true then
    raise exception 'M3: charterer must see TBN: %', r->'snapshot'->'vessel'->'vessel'; end if;
  if r::text like '%SEED TBN HULL%' then raise exception 'M3: TBN hull name leaked'; end if;
  -- the stable identifiers are the vessel's identity too (FR-H3): none on the room, the snapshot, the listing-sync view or any event payload
  if (r->'room'->>'vesselId') is not null or (r->'snapshot'->'vessel'->'vessel'->>'id') is not null or (r->'snapshot'->'vessel'->'availability'->>'vessel_id') is not null then
    raise exception 'M3: a stable vessel identifier reached the cargo side: room.vesselId=% vessel.id=% availability.vessel_id=%',
      r->'room'->>'vesselId', r->'snapshot'->'vessel'->'vessel'->>'id', r->'snapshot'->'vessel'->'availability'->>'vessel_id'; end if;
  if r::text like '%' || pg_temp.fx_id('v3')::text || '%' then raise exception 'M3: the TBN vessel id is somewhere in the cargo-side payload'; end if;
  if (select x->'vessel'->>'name' from jsonb_array_elements(public.list_fixture_rooms(null, 50)) x where x->>'id' = v_room::text) <> 'TBN' then raise exception 'M3: inbox must mask TBN too'; end if;
  if public.list_fixture_rooms(null, 50)::text like '%' || pg_temp.fx_id('v3')::text || '%' then raise exception 'M3: the TBN vessel id is in the inbox payload'; end if;
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'mask-tbn-accept');
  r := public.get_fixture_room(v_room);
  if r->'snapshot'->'vessel'->'vessel'->>'vessel_name' <> 'SEED TBN HULL' then raise exception 'M3: the owner sees its own hull'; end if;
  if (r->'room'->>'vesselId')::uuid is distinct from pg_temp.fx_id('v3') or (r->'snapshot'->'vessel'->'vessel'->>'id')::uuid is distinct from pg_temp.fx_id('v3') then
    raise exception 'M3: the owner must see its own vessel identifiers: %', r->'room'; end if;
  -- on subjects the listing-sync view exists: the cargo side gets no vessel id there either
  v := public.agree_fixture_disclosure(v_room, pg_temp.fx_ver(v_room), 'mask-tbn-disc-ow');
  perform pg_temp.fx_as('u_ch1');
  r := public.get_fixture_room(v_room);
  if (r->'room'->>'vesselId') is not null then raise exception 'M3: one side agreeing must not reveal the vessel id'; end if;
  v := public.agree_fixture_disclosure(v_room, pg_temp.fx_ver(v_room), 'mask-tbn-disc-ch');
  r := public.get_fixture_room(v_room);
  if r->'snapshot'->'vessel'->'vessel'->>'vessel_name' <> 'SEED TBN HULL' then raise exception 'M3: disclosure must reveal the hull'; end if;
  if (r->'room'->>'vesselId')::uuid is distinct from pg_temp.fx_id('v3') or (r->'snapshot'->'vessel'->'availability'->>'vessel_id')::uuid is distinct from pg_temp.fx_id('v3') then
    raise exception 'M3: disclosure must reveal the vessel identifiers: %', r->'room'; end if;
  raise notice 'M3 ok: TBN name, IMO and every stable identifier masked from the cargo side (room, snapshot, inbox, events) until disclosure; the owner always sees its hull';
end $$;

-- ── M3b · a masked TBN room on subjects: the listing-sync view carries no vessel id for the cargo side ─
do $$
declare v jsonb; r jsonb; v_room uuid; v_tid uuid; v_pid uuid; v_code text;
begin
  perform pg_temp.fx_as('u_ow1');
  v := public.create_fixture_room(pg_temp.fx_id('c2'), pg_temp.fx_id('a3'), pg_temp.fx_terms(), 'mask-create-tbn-c2', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('u_t1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'mask-tbn-c2-accept');
  foreach v_code in array array['cargo_grade', 'quantity', 'ports', 'laycan', 'ld_rates', 'freight'] loop
    v_tid := pg_temp.fx_term(v_room, v_code);
    perform pg_temp.fx_as('u_ow1');
    v := public.submit_fixture_proposal(v_room, v_tid, pg_temp.fx_value(v_code), null, false, null, pg_temp.fx_ver(v_room), 'mask-tbn-c2-offer-' || v_code);
    v_pid := (v->'data'->>'proposalId')::uuid;
    perform pg_temp.fx_as('u_t1');
    v := public.accept_fixture_proposal(v_room, v_pid, pg_temp.fx_ver(v_room), 'mask-tbn-c2-accept-' || v_code);
  end loop;
  perform pg_temp.fx_as('u_ow1');
  v := public.add_fixture_subject(v_room, 'Sub owners'' approval', null, 'vessel', null, pg_temp.fx_ver(v_room), 'mask-tbn-c2-sub');
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'mask-tbn-c2-fix');
  perform pg_temp.fx_as('u_t1');
  r := public.get_fixture_room(v_room);
  if (r->'snapshot'->>'vesselIdentityMasked')::boolean is not true or (r->'room'->'listingSync'->>'outstanding')::boolean is not true then raise exception 'M3b: masked room on subjects expected: %', r->'room'; end if;
  if (r->'room'->'listingSync'->'vessel'->>'vesselId') is not null or (r->'room'->>'vesselId') is not null then
    raise exception 'M3b: the listing-sync view leaked the vessel id to the cargo side: %', r->'room'->'listingSync'; end if;
  if r::text like '%' || pg_temp.fx_id('v3')::text || '%' then raise exception 'M3b: the TBN vessel id is in the payload'; end if;
  perform pg_temp.fx_as('u_ow1');
  r := public.get_fixture_room(v_room);
  if (r->'room'->'listingSync'->'vessel'->>'vesselId')::uuid is distinct from pg_temp.fx_id('v3') then raise exception 'M3b: the owner needs the vessel id to open its own position: %', r->'room'->'listingSync'; end if;
  raise notice 'M3b ok: on subjects the cargo side sees the sync requirement without the vessel id; the owner side keeps it';
end $$;

-- ── M4 · message visibility and redaction; relayed contact never exposes email ─
do $$
declare v jsonb; r jsonb; v_room uuid; v_side_msg uuid; v_med_msg uuid; e text; p jsonb; v_relayed uuid;
begin
  perform pg_temp.fx_as('u_ch1');
  v := public.create_fixture_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'mask-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('u_ow1');
  v := public.post_fixture_message(v_room, 'owners internal: walk away above 27', 'note', 'side', null, pg_temp.fx_ver(v_room), 'mask-m4-side');
  v_side_msg := (v->'data'->>'messageId')::uuid;
  e := pg_temp.fx_err(format('select public.post_fixture_message(%L, %L, %L, %L, null, %s, %L)', v_room, 'x', 'note', 'mediator', pg_temp.fx_ver(v_room), 'mask-m4-owner-mediator'));
  if e <> 'FX_AUTH' then raise exception 'M4: a principal cannot post mediator-private messages, got %', e; end if;
  perform pg_temp.fx_as('u_adm', true);
  v := public.post_fixture_message(v_room, 'mediator note: chase owners tomorrow', 'note', 'mediator', null, pg_temp.fx_ver(v_room), 'mask-m4-med');
  v_med_msg := (v->'data'->>'messageId')::uuid;
  perform pg_temp.fx_as('u_ch1');
  r := public.get_fixture_room(v_room);
  if r::text like '%walk away above 27%' or r::text like '%chase owners%' then raise exception 'M4: side-private or mediator-private text reached the other side'; end if;
  if exists (select 1 from jsonb_array_elements(r->'events') x where x->>'type' = 'message.posted' and x::text like '%walk away%') then raise exception 'M4: event payload carries message text'; end if;
  perform pg_temp.fx_as('u_ow1');
  r := public.get_fixture_room(v_room);
  if not exists (select 1 from jsonb_array_elements(r->'messages') x where x->>'id' = v_side_msg::text and x->>'body' like 'owners internal%') then raise exception 'M4: the owner side must see its own side message'; end if;
  if exists (select 1 from jsonb_array_elements(r->'messages') x where x->>'id' = v_med_msg::text) then raise exception 'M4: mediator-private message visible to the owner'; end if;
  -- redaction by an admin
  perform pg_temp.fx_as('u_adm', true);
  v := public.redact_fixture_message(v_room, v_side_msg, 'contains a walk-away figure', pg_temp.fx_ver(v_room), 'mask-m4-redact');
  perform pg_temp.fx_as('u_ow1');
  r := public.get_fixture_room(v_room);
  if not exists (select 1 from jsonb_array_elements(r->'messages') x where x->>'id' = v_side_msg::text and (x->>'redacted')::boolean and x->>'body' is null) then raise exception 'M4: redacted message must have no body'; end if;
  perform pg_temp.fx_as('u_ow1');
  e := pg_temp.fx_err(format('select public.redact_fixture_message(%L, %L, %L, %s, %L)', v_room, v_med_msg, 'not allowed', pg_temp.fx_ver(v_room), 'mask-m4-redact-member'));
  if e <> 'FX_AUTH' then raise exception 'M4: members cannot redact, got %', e; end if;
  -- a contact-backed relayed party: after disclosure the desk name only, never its email or phone
  perform pg_temp.fx_as('u_ow1');
  v := public.create_fixture_room(pg_temp.fx_id('c4'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'mask-create-c4', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  r := public.get_fixture_room(v_room);
  select x into p from jsonb_array_elements(r->'parties') x where x->>'side' = 'cargo';
  v_relayed := (p->>'id')::uuid;
  if p->>'name' is not null then raise exception 'M4: relayed contact masked before disclosure'; end if;
  perform pg_temp.fx_as('u_adm', true);
  v := public.agree_fixture_disclosure(v_room, pg_temp.fx_ver(v_room), 'mask-c4-disc-relayed', null, v_relayed);
  perform pg_temp.fx_as('u_ow1');
  v := public.agree_fixture_disclosure(v_room, pg_temp.fx_ver(v_room), 'mask-c4-disc-ow');
  r := public.get_fixture_room(v_room);
  select x into p from jsonb_array_elements(r->'parties') x where x->>'side' = 'cargo';
  if p->>'name' <> 'Seed Brokers Desk' then raise exception 'M4: disclosed contact desk name expected: %', p; end if;
  if r::text like '%seed-brokers.test%' or r::text like '%+90 212%' or p ? 'contactId' then raise exception 'M4: contact email / phone / id leaked'; end if;
  raise notice 'M4 ok: side and mediator privacy hold, event payloads carry no message text, admin redaction works, a contact-backed party discloses a desk name only';
end $$;
