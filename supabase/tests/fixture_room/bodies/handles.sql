-- Fixture Room · HANDLES body (C2O-013, 29 Sep 2026): the private selection handles of
-- 20260923208000. Runs after the shared seed inside the caller's transaction. Adds the
-- grain cargo c6 (owned by the charterer organisation) that both the named vessel a1 and
-- the TBN hull a3 match. Every assertion scans payloads for the raw ids a member must
-- never see: both availability ids, both vessel ids, the IMO and the hidden hull name.

set local session_replication_role = replica;
insert into fx_ids (k, v) values ('c6', '00000000-0000-4000-8000-0000000000e6') on conflict do nothing;
insert into public.cargo_listings (id, ref, status, review_status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo,
  qty_min_mt, qty_max_mt, stowage_factor, load_port_locode, load_port_name, load_zone, disch_port_locode, disch_port_name, disch_zone,
  laycan_from, laycan_to, is_spot, load_rate, disch_rate, load_terms, freight_idea_usd_mt, commission_pct, demurrage_rate) values
  (pg_temp.fx_id('c6'), 'FXC-006', 'IN', 'APPROVED', 'Dry Bulk', 'Soya beans', false, true, 29000, 31000, 1.30,
   'ZZFXA', 'Fixture Load Port', 'E.MED', 'ZZFXB', 'Fixture Disch Port', 'E.MED', current_date + 10, current_date + 20, false,
   '8000', '6000', 'FIOST', 26.00, 2.5, 12000)
on conflict (id) do nothing;
insert into public.listing_ownership (listing_type, listing_id, owner_user_id, owner_org_id, role, is_current, transfer_reason) values
  ('cargo', pg_temp.fx_id('c6'), pg_temp.fx_id('u_ch1'), pg_temp.fx_id('org_ch'), 'primary', true, 'initial_post')
on conflict do nothing;
update public.vessels set imo_number = '9000009' where id = pg_temp.fx_id('v3');   -- a TBN hull with a known IMO
-- C2O-016: a TBN hull whose name occurs inside the marker "[withheld]", and a two-letter one
insert into fx_ids (k, v) values ('v4', '00000000-0000-4000-8000-0000000000f4'), ('v5', '00000000-0000-4000-8000-0000000000f5'),
                                 ('a5', '00000000-0000-4000-8000-0000000000b5'), ('a6', '00000000-0000-4000-8000-0000000000b6') on conflict do nothing;
insert into public.vessels (id, vessel_name, imo_number, vessel_type, dwt_grain, build_year, flag, is_geared, grain_certified, dg_certified, is_sanctioned, is_tbn) values
  (pg_temp.fx_id('v4'), 'HELD', null, 'Bulk Carrier', 29500, 2014, 'Malta', true, true, false, false, true),
  (pg_temp.fx_id('v5'), 'AB',   null, 'Bulk Carrier', 30500, 2016, 'Malta', true, true, false, false, true)
on conflict (id) do nothing;
insert into public.vessel_availability (id, vessel_id, open_port_locode, open_port_name, open_zone, open_date, status, review_status, freight_idea_usd_mt, accepts_part_cargo) values
  (pg_temp.fx_id('a5'), pg_temp.fx_id('v4'), 'ZZFXA', 'Fixture Load Port', 'E.MED', current_date + 7, 'OPEN', 'APPROVED', 27.00, false),
  (pg_temp.fx_id('a6'), pg_temp.fx_id('v5'), 'ZZFXA', 'Fixture Load Port', 'E.MED', current_date + 7, 'OPEN', 'APPROVED', 27.00, false)
on conflict (id) do nothing;
insert into public.listing_ownership (listing_type, listing_id, owner_user_id, owner_org_id, role, is_current, transfer_reason) values
  ('vessel_availability', pg_temp.fx_id('a5'), pg_temp.fx_id('u_ow1'), pg_temp.fx_id('org_ow'), 'primary', true, 'initial_post'),
  ('vessel_availability', pg_temp.fx_id('a6'), pg_temp.fx_id('u_ow1'), pg_temp.fx_id('org_ow'), 'primary', true, 'initial_post')
on conflict do nothing;
set local session_replication_role = origin;

-- the raw identifiers a member must never receive for these candidates
create or replace function pg_temp.fx_leaks(p_text text) returns text language sql stable as $f$
  select string_agg(k, ', ') from (values
    ('a1', pg_temp.fx_id('a1')::text), ('a3', pg_temp.fx_id('a3')::text),
    ('v1', pg_temp.fx_id('v1')::text), ('v3', pg_temp.fx_id('v3')::text),
    ('imo', '9000001'), ('tbn-imo', '9000009'), ('hull', 'seed tbn hull'),
    ('a3-flat', replace(pg_temp.fx_id('a3')::text, '-', '')), ('v3-flat', replace(pg_temp.fx_id('v3')::text, '-', ''))) x(k, needle)
  where lower(p_text) like '%' || lower(needle) || '%' $f$;
create or replace function pg_temp.fx_key(p_list jsonb, p_field text, p_value text) returns uuid language sql immutable as $f$
  select (x->>'candidateKey')::uuid from jsonb_array_elements(p_list) x where x->>p_field = p_value limit 1 $f$;

do $$
declare v jsonb; l jsonb; k1 uuid; k2 uuid; k3 uuid; v_room uuid; v_room2 uuid; e text; t text; n bigint;
begin
  -- H1 · candidates carry an opaque key, never a raw id
  perform pg_temp.fx_as('u_ch1');
  l := public.list_fixture_match_candidates('cargo', pg_temp.fx_id('c6'));
  if jsonb_array_length(l) < 2 then raise exception 'H1: both positions must match c6: %', l; end if;
  if exists (select 1 from jsonb_array_elements(l) x where not (x ? 'candidateKey') or x ? 'availabilityId' or x ? 'vesselId' or x ? 'id') then
    raise exception 'H1: every candidate carries a candidateKey and no raw id key: %', l; end if;
  if pg_temp.fx_leaks(l::text) is not null then raise exception 'H1: raw identifiers in the candidate list: %', pg_temp.fx_leaks(l::text); end if;
  k1 := pg_temp.fx_key(l, 'dwt', '32000');
  if k1 is null then raise exception 'H1: the TBN candidate must be listed as TBN'; end if;
  raise notice 'H1 ok: candidates carry opaque keys; no availability id, vessel id, IMO or hidden name';

  -- H2 · no callable raw-id bypass
  if has_function_privilege('authenticated', 'public.create_fixture_room(uuid, uuid, jsonb, text, jsonb)', 'execute') then
    raise exception 'H2: authenticated must not execute the raw-id create_fixture_room'; end if;
  begin
    v := public.create_fixture_room(pg_temp.fx_id('c6'), pg_temp.fx_id('a3'), pg_temp.fx_terms(), 'h-raw', '{}'::jsonb);
    raise exception 'H2: a member called the raw-id create';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from fixture_private.match_handles;
    raise exception 'H2: a member read the handle table';
  exception when insufficient_privilege then null;
  end;
  raise notice 'H2 ok: the raw-id create and the handle table are out of a member''s reach';

  -- H3 · a room opens from the key; the response carries the room only
  v := public.create_fixture_room_from_candidate(k1, pg_temp.fx_terms(), 'h-create', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  if v_room is null or (v->>'replayed')::boolean then raise exception 'H3: a fresh room expected: %', v; end if;
  if pg_temp.fx_leaks(v::text) is not null then raise exception 'H3: raw identifiers in the create response: %', v; end if;
  raise notice 'H3 ok: create-from-handle opens the room and returns no listing, availability or vessel id';

  -- H4 · the room read of a masked viewer carries no availability or vessel uuid anywhere
  v := public.get_fixture_room(v_room);
  if pg_temp.fx_leaks(v::text) is not null then raise exception 'H4: raw identifiers in the masked room read: %', pg_temp.fx_leaks(v::text); end if;
  if v->'room'->'vesselAvailabilityId' is distinct from 'null'::jsonb then raise exception 'H4: vesselAvailabilityId must be null for a masked viewer: %', v->'room'; end if;
  if (v->'snapshot'->>'vesselIdentityMasked')::boolean is not true then raise exception 'H4: the TBN hull must be masked from the cargo side'; end if;
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'h-accept');
  v := public.get_fixture_room(v_room);
  if v->'room'->>'vesselAvailabilityId' <> pg_temp.fx_id('a3')::text then raise exception 'H4: the vessel side keeps its own availability id: %', v->'room'; end if;
  raise notice 'H4 ok: a masked viewer''s room read has no availability or vessel uuid; the vessel side keeps its own';

  -- H5 · replay by the idempotency key BEFORE expiry: an expired key still replays the same room
  perform pg_temp.fx_owner();
  update fixture_private.match_handles set expires_at = now() - interval '1 minute' where key = k1;
  perform pg_temp.fx_as('u_ch1');
  v := public.create_fixture_room_from_candidate(k1, pg_temp.fx_terms(), 'h-create', '{}'::jsonb);
  if (v->>'replayed')::boolean is not true or (v->'data'->>'roomId')::uuid <> v_room then raise exception 'H5: a same-key retry after expiry must replay: %', v; end if;
  e := pg_temp.fx_err(format('select public.create_fixture_room_from_candidate(%L, %L::jsonb, %L)', k1, pg_temp.fx_terms(), 'h-after-expiry'));
  if e <> 'FX_STATE' then raise exception 'H5: a new use of an expired key must be FX_STATE, got %', e; end if;
  raise notice 'H5 ok: replay precedes expiry; an expired key cannot open anything new';

  -- H6 · two handles for one pair: the live-room rule decides, the second gets FX_CONFLICT
  l := public.list_fixture_match_candidates('cargo', pg_temp.fx_id('c6'));
  k2 := pg_temp.fx_key(l, 'dwt', '32000');
  e := pg_temp.fx_err(format('select public.create_fixture_room_from_candidate(%L, %L::jsonb, %L)', k2, pg_temp.fx_terms(), 'h-second'));
  if e <> 'FX_CONFLICT' then raise exception 'H6: a second handle for a live pair must be FX_CONFLICT, got %', e; end if;
  raise notice 'H6 ok: two handles may race; one live room wins and the other is refused with the governed conflict';

  -- H7 · the key is bound to the member, not the organisation: a colleague cannot use it
  perform pg_temp.fx_as('u_ch2');
  e := pg_temp.fx_err(format('select public.create_fixture_room_from_candidate(%L, %L::jsonb, %L)', k2, pg_temp.fx_terms(), 'h-colleague'));
  if e <> 'FX_NOT_FOUND' then raise exception 'H7: another actor''s key must be FX_NOT_FOUND, got %', e; end if;
  l := public.list_fixture_match_candidates('cargo', pg_temp.fx_id('c6'));
  if pg_temp.fx_key(l, 'dwt', '32000') = k2 then raise exception 'H7: a colleague must get a key of their own'; end if;
  raise notice 'H7 ok: a key works only for the member it was issued to';

  -- H8 · ownership lost after the key was issued
  l := public.list_fixture_match_candidates('cargo', pg_temp.fx_id('c6'));
  k3 := pg_temp.fx_key(l, 'name', 'SEED VESSEL ONE');
  perform pg_temp.fx_owner();
  update public.organization_members set is_current = false where org_id = pg_temp.fx_id('org_ch') and user_id = pg_temp.fx_id('u_ch2');   -- the seat ends
  perform pg_temp.fx_as('u_ch2');
  e := pg_temp.fx_err(format('select public.create_fixture_room_from_candidate(%L, %L::jsonb, %L)', k3, pg_temp.fx_terms(), 'h-lost'));
  if e <> 'FX_AUTH' then raise exception 'H8: a key whose source listing the member no longer represents must be FX_AUTH, got %', e; end if;
  perform pg_temp.fx_owner();
  update public.organization_members set is_current = true where org_id = pg_temp.fx_id('org_ch') and user_id = pg_temp.fx_id('u_ch2');
  raise notice 'H8 ok: live ownership is re-checked when the key is used';

  -- H9 · the pair no longer matches (the position moved out of the laycan window)
  perform pg_temp.fx_as('u_ch1');
  l := public.list_fixture_match_candidates('cargo', pg_temp.fx_id('c6'));
  k3 := pg_temp.fx_key(l, 'name', 'SEED VESSEL ONE');
  perform pg_temp.fx_owner();
  set local session_replication_role = replica;
  update public.vessel_availability set open_date = current_date + 60 where id = pg_temp.fx_id('a1');
  set local session_replication_role = origin;
  perform pg_temp.fx_as('u_ch1');
  e := pg_temp.fx_err(format('select public.create_fixture_room_from_candidate(%L, %L::jsonb, %L)', k3, pg_temp.fx_terms(), 'h-stale'));
  if e <> 'FX_STATE' then raise exception 'H9: a pair that no longer matches must be FX_STATE, got %', e; end if;
  perform pg_temp.fx_owner();
  set local session_replication_role = replica;
  update public.vessel_availability set open_date = current_date + 5 where id = pg_temp.fx_id('a1');
  set local session_replication_role = origin;
  raise notice 'H9 ok: the governed match predicate is re-checked when the key is used';

  -- H10 · a used idempotency key with a different pairing is a mismatch, not a replay
  perform pg_temp.fx_as('u_ch1');
  l := public.list_fixture_match_candidates('cargo', pg_temp.fx_id('c6'));
  k3 := pg_temp.fx_key(l, 'name', 'SEED VESSEL ONE');
  e := pg_temp.fx_err(format('select public.create_fixture_room_from_candidate(%L, %L::jsonb, %L)', k3, pg_temp.fx_terms(), 'h-create'));
  if e <> 'FX_IDEMPOTENCY_MISMATCH' then raise exception 'H10: reusing a key for another pairing must be FX_IDEMPOTENCY_MISMATCH, got %', e; end if;
  raise notice 'H10 ok: an idempotency key cannot be reused for another pairing';

  -- H11 · the hints travel with each candidate, figures only (no separate read by key)
  select x->'hints' into v from jsonb_array_elements(l) x where x->>'candidateKey' = k3::text;
  if v is null or pg_temp.fx_leaks(v::text) is not null or v::text ~* '[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}' then
    raise exception 'H11: the hints must carry no uuid: %', v; end if;
  if v->>'commodity' <> 'Soya beans' then raise exception 'H11: the hints carry the listing figures: %', v; end if;
  if to_regprocedure('public.get_fixture_candidate_hints(uuid)') is not null then raise exception 'H11: the by-key hint read must be gone'; end if;
  raise notice 'H11 ok: hints travel with the candidate, figures only; no hint read by key';

  -- H13 · identifiers embedded in free text are scrubbed for a masked viewer (C2O-014 item 1)
  perform pg_temp.fx_as('u_ow1');
  v := public.post_fixture_message(v_room, 'our ref ' || upper(pg_temp.fx_id('a3')::text) || '/x and hull ' || replace(pg_temp.fx_id('v3')::text, '-', '') || ' ok',
                                   'note', 'room', null, pg_temp.fx_ver(v_room), 'h-hostile-msg');
  -- C2O-015 item 5: the hull's own name and IMO, typed voluntarily, any case, embedded
  v := public.post_fixture_message(v_room, 'she is the Seed Tbn Hull, imo9000009, ready', 'note', 'room', null, pg_temp.fx_ver(v_room), 'h-hostile-name');
  v := public.submit_fixture_proposal(v_room, pg_temp.fx_term(v_room, 'freight'), '{"num": 26.5}'::jsonb, 'firm on seed tbn hull', false, null, pg_temp.fx_ver(v_room), 'h-hostile-offer');
  v := public.add_fixture_subject(v_room, 'Sub inspection of SEED TBN HULL', null, 'vessel', null, pg_temp.fx_ver(v_room), 'h-hostile-subject');
  v := public.get_fixture_room(v_room);
  if v::text not ilike '%' || pg_temp.fx_id('a3')::text || '%' then raise exception 'H13: the vessel side keeps its own message text'; end if;
  perform pg_temp.fx_as('u_ch1');
  v := public.get_fixture_room(v_room);
  t := lower(v::text);
  if strpos(t, pg_temp.fx_id('a3')::text) > 0 or strpos(t, replace(pg_temp.fx_id('a3')::text, '-', '')) > 0
     or strpos(t, pg_temp.fx_id('v3')::text) > 0 or strpos(t, replace(pg_temp.fx_id('v3')::text, '-', '')) > 0 then
    raise exception 'H13: an embedded identifier survived the masked read'; end if;
  if v::text not like '%our ref [withheld]/x and hull [withheld] ok%' then raise exception 'H13: the rest of the message stays readable: %', v->'messages'; end if;
  if pg_temp.fx_leaks(v::text) is not null then raise exception 'H13: the masked read leaks %', pg_temp.fx_leaks(v::text); end if;
  if v::text not like '%she is the [withheld], imo[withheld], ready%' or v::text not like '%Sub inspection of [withheld]%' or v::text not like '%firm on [withheld]%' then
    raise exception 'H13: the hull name and IMO are withheld in messages and subject titles: %', v->'messages'; end if;
  raise notice 'H13 ok: ids (prefixed, suffixed, upper-case, hyphenless) and the hidden hull name / IMO typed in free text are withheld; the rest stays';

  -- H14 · the same key with any changed term, hint or option is a mismatch (C2O-014 item 2)
  e := pg_temp.fx_err(format('select public.create_fixture_room_from_candidate(%L, %L::jsonb, %L)', k1,
         (select jsonb_agg(case when x->>'code' = 'freight' then x || '{"hint":"Listing: changed"}'::jsonb else x end) from jsonb_array_elements(pg_temp.fx_terms()) x), 'h-create'));
  if e <> 'FX_IDEMPOTENCY_MISMATCH' then raise exception 'H14: a changed hint under the same key must be a mismatch, got %', e; end if;
  e := pg_temp.fx_err(format('select public.create_fixture_room_from_candidate(%L, %L::jsonb, %L, %L::jsonb)', k1, pg_temp.fx_terms(), 'h-create', '{"catalogueVersion":"2026-09-23.v1","extra":1}'));
  if e <> 'FX_IDEMPOTENCY_MISMATCH' then raise exception 'H14: a changed option under the same key must be a mismatch, got %', e; end if;
  v := public.create_fixture_room_from_candidate(k1, pg_temp.fx_terms(), 'h-create', '{}'::jsonb);
  if (v->>'replayed')::boolean is not true then raise exception 'H14: the identical request still replays: %', v; end if;
  raise notice 'H14 ok: the full request hash decides replay; any changed term, hint or option is refused';

  -- H15 · listing again renews the same key; rows do not pile up (C2O-014 item 3)
  l := public.list_fixture_match_candidates('cargo', pg_temp.fx_id('c6'));
  k2 := pg_temp.fx_key(l, 'name', 'SEED VESSEL ONE');
  l := public.list_fixture_match_candidates('cargo', pg_temp.fx_id('c6'));
  if pg_temp.fx_key(l, 'name', 'SEED VESSEL ONE') <> k2 then raise exception 'H15: listing again must reuse the key'; end if;
  perform pg_temp.fx_owner();
  select count(*) into n from fixture_private.match_handles where actor_user_id = pg_temp.fx_id('u_ch1');
  if n <> jsonb_array_length(l) then raise exception 'H15: one handle per actor/source/pair expected (% candidates), got %', jsonb_array_length(l), n; end if;
  update fixture_private.match_handles set expires_at = now() - interval '2 days' where key in (k1, k2);
  perform pg_temp.fx_as('u_ch2');
  l := public.list_fixture_match_candidates('cargo', pg_temp.fx_id('c6'));   -- any listing call purges stale rows
  perform pg_temp.fx_owner();
  if exists (select 1 from fixture_private.match_handles where key = k2) then raise exception 'H15: a handle a day past expiry must be purged'; end if;
  perform pg_temp.fx_as('u_ch1');
  v := public.create_fixture_room_from_candidate(k1, pg_temp.fx_terms(), 'h-create', '{}'::jsonb);
  if (v->>'replayed')::boolean is not true then raise exception 'H15: replay needs no handle row (the room is the record): %', v; end if;
  raise notice 'H15 ok: one renewable key per pair; stale rows purged; replay survives the purge';

  -- H16 · a key from any other domain (e.g. a future market handle) is not a Fixture key
  e := pg_temp.fx_err(format('select public.create_fixture_room_from_candidate(%L, %L::jsonb, %L)', gen_random_uuid(), pg_temp.fx_terms(), 'h-foreign-key'));
  if e <> 'FX_NOT_FOUND' then raise exception 'H16: an unknown key must be FX_NOT_FOUND, got %', e; end if;
  raise notice 'H16 ok: only Fixture-issued keys open a room; any other key is not found';

  -- H17 · every creation path locks: the inner create is unreachable except through the locking wrapper
  if has_function_privilege('service_role', 'public.fn_fixture_create_room_unlocked(uuid, uuid, jsonb, text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.fn_fixture_create_room_unlocked(uuid, uuid, jsonb, text, jsonb)', 'execute') then
    raise exception 'H17: the unlocked create must be reachable only through create_fixture_room'; end if;
  if (select prosrc from pg_proc where oid = 'public.create_fixture_room(uuid, uuid, jsonb, text, jsonb)'::regprocedure) not like '%fn_fixture_lock_create_inputs%' then
    raise exception 'H17: create_fixture_room must lock its inputs'; end if;
  raise notice 'H17 ok: create_fixture_room locks account, seats, ownership, listings and vessel before the original body runs';

  -- H18 · the scrub terminates and matches correctly on names that stress it (C2O-016)
  perform pg_temp.fx_owner();
  set local statement_timeout = '3s';
  if public.fn_fixture_scrub_masked('{"b":"the HELD is ready, withheld? held-over"}'::jsonb, '{}', array['HELD', null])->>'b'
       <> 'the [withheld] is ready, withheld? [withheld]-over' then raise exception 'H18: a needle inside the marker must not rematch'; end if;
  if public.fn_fixture_scrub_masked('{"b":"WITH us, without"}'::jsonb, '{}', array['WITH', null])->>'b' <> '[withheld] us, without' then raise exception 'H18: WITH'; end if;
  if public.fn_fixture_scrub_masked('{"b":"the AB is ready; about ab.","status":"fixed"}'::jsonb, '{}', array['AB', null])
       <> '{"b":"the [withheld] is ready; about [withheld].","status":"fixed"}'::jsonb then raise exception 'H18: a two-letter name is withheld as a word only'; end if;
  if public.fn_fixture_scrub_masked('{"status":"fixed","b":"FIX ok"}'::jsonb, '{}', array['FIX', null])->>'status' <> 'fixed' then
    raise exception 'H18: a hull name must never alter a structured value'; end if;
  if public.fn_fixture_scrub_masked('{"b":"imo9000009, 19000009, 9000009"}'::jsonb, '{}', array['X Y', '9000009'])->>'b' <> 'imo[withheld], 19000009, [withheld]' then
    raise exception 'H18: an IMO is withheld as a whole number'; end if;
  set local statement_timeout = 0;
  raise notice 'H18 ok: the scrub always terminates (a needle inside [withheld] never rematches); two-letter names, words, IMOs and structured values behave';

  -- H19 · over the member read: rooms on TBN hulls named HELD and AB, the names typed into a
  --       message, an offer comment and a subject title; the masked read returns promptly and masked
  declare v_rooms uuid[] := '{}'; r uuid; nm text; k uuid; dwt int; txt text;
  begin
    foreach dwt in array array[29500, 30500] loop
      perform pg_temp.fx_as('u_ch1');
      l := public.list_fixture_match_candidates('cargo', pg_temp.fx_id('c6'));
      k := pg_temp.fx_key(l, 'dwt', dwt::text);
      if k is null then raise exception 'H19: the TBN hull of % DWT must be a candidate', dwt; end if;
      v := public.create_fixture_room_from_candidate(k, pg_temp.fx_terms(), 'h19-create-' || dwt, '{}'::jsonb);
      r := (v->'data'->>'roomId')::uuid; v_rooms := v_rooms || r;
      nm := case dwt when 29500 then 'HELD' else 'AB' end;
      perform pg_temp.fx_as('u_ow1');
      v := public.respond_fixture_invitation(r, true, pg_temp.fx_ver(r), 'h19-accept-' || dwt);
      v := public.post_fixture_message(r, 'the ' || nm || ' is ready; ' || lower(nm) || '-class', 'note', 'room', null, pg_temp.fx_ver(r), 'h19-msg-' || dwt);
      v := public.submit_fixture_proposal(r, pg_temp.fx_term(r, 'freight'), '{"num": 26.5}'::jsonb, 'firm on ' || lower(nm), false, null, pg_temp.fx_ver(r), 'h19-offer-' || dwt);
      v := public.add_fixture_subject(r, 'Sub ' || nm || ' inspection', null, 'vessel', null, pg_temp.fx_ver(r), 'h19-subject-' || dwt);
      perform pg_temp.fx_as('u_ch1');
      set local statement_timeout = '5s';
      v := public.get_fixture_room(r);
      set local statement_timeout = 0;
      txt := replace(lower(v::text), '[withheld]', '');
      if txt ~ ('\m' || lower(nm) || '\M') then raise exception 'H19: the hull name % survived the masked read', nm; end if;
      if v::text not like '%the [withheld] is ready; [withheld]-class%' or v::text not like '%firm on [withheld]%' or v::text not like '%Sub [withheld] inspection%' then
        raise exception 'H19: message, comment and subject must be masked for %: %', nm, v->'messages'; end if;
      if (v->'room'->>'status') not in ('negotiating', 'invited') then raise exception 'H19: structured values stay intact: %', v->'room'->>'status'; end if;
    end loop;
  end;
  perform pg_temp.fx_owner();
  raise notice 'H19 ok: TBN hulls named HELD and AB are withheld in messages, comments and subjects over the member read, promptly, with structure intact';

  -- H12 · a terminal room restarts from the room row; a live one does not
  perform pg_temp.fx_as('u_ch1');
  e := pg_temp.fx_err(format('select public.recreate_fixture_room(%L, %L::jsonb, %L)', v_room, pg_temp.fx_terms(), 'h-recreate-live'));
  if e <> 'FX_STATE' then raise exception 'H12: a live room cannot be restarted, got %', e; end if;
  v := public.close_fixture_room(v_room, 'withdrawn', null, pg_temp.fx_ver(v_room), 'h-close');
  v := public.recreate_fixture_room(v_room, pg_temp.fx_terms(), 'h-recreate', '{}'::jsonb);
  v_room2 := (v->'data'->>'roomId')::uuid;
  if v_room2 is null or v_room2 = v_room then raise exception 'H12: a new room expected: %', v; end if;
  if pg_temp.fx_leaks(v::text) is not null then raise exception 'H12: raw identifiers in the recreate response: %', v; end if;
  v := public.recreate_fixture_room(v_room, pg_temp.fx_terms(), 'h-recreate', '{}'::jsonb);
  if (v->>'replayed')::boolean is not true or (v->'data'->>'roomId')::uuid <> v_room2 then raise exception 'H12: a recreate retry must replay: %', v; end if;
  perform pg_temp.fx_as('u_out');
  e := pg_temp.fx_err(format('select public.recreate_fixture_room(%L, %L::jsonb, %L)', v_room, pg_temp.fx_terms(), 'h-recreate-out'));
  if e <> 'FX_NOT_FOUND' then raise exception 'H12: an outsider cannot restart a room, got %', e; end if;
  perform pg_temp.fx_owner();
  raise notice 'H12 ok: a closed room restarts from its own row (no raw ids from the browser); a live room and an outsider are refused';
end $$;
