-- ── S1 · creation: parties, snapshot, version, ref ─────────────────────────
do $$
declare v jsonb; r jsonb; v_room uuid; v_n int;
begin
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'state-create-1', '{}'::jsonb);
  if (v->>'ok')::boolean is not true or (v->>'replayed')::boolean then raise exception 'S1: create failed %', v; end if;
  v_room := (v->'data'->>'roomId')::uuid;
  if (v->>'version')::int <> 2 then raise exception 'S1: expected version 2 (room.created + party.invited), got %', v->>'version'; end if;
  if pg_temp.fx_event_types(v_room) <> 'room.created,party.invited' then raise exception 'S1: ledger %', pg_temp.fx_event_types(v_room); end if;
  r := public.get_fixture_room(v_room);
  if r->'room'->>'status' <> 'invited' then raise exception 'S1: status %', r->'room'->>'status'; end if;
  if r->'room'->>'ref' !~ '^FX-\d{4}-\d{5}$' then raise exception 'S1: ref format %', r->'room'->>'ref'; end if;
  if jsonb_array_length(r->'terms') <> 6 then raise exception 'S1: 6 terms expected, got %', jsonb_array_length(r->'terms'); end if;
  if r->'snapshot'->'cargo'->>'commodity_name' <> 'Wheat, Bulk' or r->'snapshot'->'vessel'->'vessel'->>'vessel_name' <> 'SEED VESSEL ONE' then
    raise exception 'S1: snapshot %', r->'snapshot'; end if;
  select count(*) into v_n from jsonb_array_elements(r->'parties') p where p->>'isPlatform' = 'true' and p->>'side' = 'mediator' and p->>'status' = 'active';
  if v_n <> 1 then raise exception 'S1: platform party missing'; end if;
  select count(*) into v_n from jsonb_array_elements(r->'parties') p where p->>'side' = 'cargo' and p->>'capacity' = 'principal' and p->>'status' = 'active' and p->>'participationMode' = 'direct' and p->>'isViewer' = 'true';
  if v_n <> 1 then raise exception 'S1: charterer party wrong: %', r->'parties'; end if;
  select count(*) into v_n from jsonb_array_elements(r->'parties') p where p->>'side' = 'vessel' and p->>'capacity' = 'principal' and p->>'status' = 'invited' and p->>'participationMode' = 'direct';
  if v_n <> 1 then raise exception 'S1: owner party should be a direct invited principal: %', r->'parties'; end if;
  if (r->'viewer'->'capabilities'->>'canPropose')::boolean is not true then raise exception 'S1: charterer should be able to propose while invited'; end if;
  if (r->'viewer'->'capabilities'->>'canFixOnSubjects')::boolean then raise exception 'S1: cannot fix while invited'; end if;
  raise notice 'S1 ok: % created at v2, invited, 6 terms, platform + charterer (active) + owner (invited)', r->'room'->>'ref';
end $$;

-- ── S2 · uniqueness and replay of create ────────────────────────────────────
do $$
declare v jsonb; w jsonb; e text;
begin
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'state-create-1', '{}'::jsonb);
  if (v->>'replayed')::boolean is not true then raise exception 'S2: same key must replay'; end if;
  e := pg_temp.fx_err(format('select pg_temp.fx_create(%L, %L, pg_temp.fx_terms(), %L, %L::jsonb)', pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), 'state-create-2', '{}'));
  if e <> 'FX_CONFLICT' then raise exception 'S2: a second active room for the pairing must be FX_CONFLICT, got %', e; end if;
  e := pg_temp.fx_err(format('select pg_temp.fx_create(%L, %L, pg_temp.fx_terms(), %L, %L::jsonb)', pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), 'state-create-1', '{"x":1}'));
  if e <> 'FX_IDEMPOTENCY_MISMATCH' then raise exception 'S2: same key with other args must be FX_IDEMPOTENCY_MISMATCH, got %', e; end if;
  -- gates on creation
  e := pg_temp.fx_err(format('select pg_temp.fx_create(%L, %L, pg_temp.fx_terms(), %L, %L::jsonb)', pg_temp.fx_id('c1'), pg_temp.fx_id('a2'), 'state-create-sanctioned', '{}'));
  if e <> 'FX_STATE' then raise exception 'S2: sanctioned vessel must be FX_STATE, got %', e; end if;
  e := pg_temp.fx_err(format('select pg_temp.fx_create(%L, %L, %L::jsonb, %L, %L::jsonb)', pg_temp.fx_id('c1'), pg_temp.fx_id('a4'), '[]', 'state-create-noterms', '{}'));
  if e <> 'FX_VALIDATION' then raise exception 'S2: empty catalogue must be FX_VALIDATION, got %', e; end if;
  perform pg_temp.fx_as('u_out');
  e := pg_temp.fx_err(format('select pg_temp.fx_create(%L, %L, pg_temp.fx_terms(), %L, %L::jsonb)', pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), 'state-create-outsider', '{}'));
  if e <> 'FX_AUTH' then raise exception 'S2: an outsider owning neither side must be FX_AUTH, got %', e; end if;
  perform pg_temp.fx_as('u_t1');
  e := pg_temp.fx_err(format('select pg_temp.fx_create(%L, %L, pg_temp.fx_terms(), %L, %L::jsonb)', pg_temp.fx_id('c2'), pg_temp.fx_id('a1'), 'state-create-t1', '{}'));
  if e <> 'FX_GATE' then raise exception 'S2: a T1 owner must be FX_GATE, got %', e; end if;
  raise notice 'S2 ok: replay, duplicate pairing, mismatch, sanctioned vessel, empty catalogue, outsider and tier gate all answer as specified';
end $$;

-- ── S2b · the catalogue is the exact versioned term sheet (FR-H2) ──────────
do $$
declare e text; op text; v jsonb; r jsonb;
begin
  perform pg_temp.fx_as('u_ch1');
  -- every deviation from catalogue 2026-09-23.v1 is refused: a missing, extra,
  -- duplicated, renamed, relabelled, retyped, optionalised, reordered,
  -- recategorised or re-united term, and a term without `required`
  foreach op in array array['missing', 'extra', 'duplicate', 'renamed', 'relabelled', 'retyped', 'optionalised', 'reordered', 'recategorised', 'reunited', 'unrequired'] loop
    e := pg_temp.fx_err(format('select pg_temp.fx_create(%L, %L, pg_temp.fx_terms_mut(%L), %L, %L::jsonb)', pg_temp.fx_id('c1'), pg_temp.fx_id('a4'), op, 'state-cat-' || op, '{}'));
    if e <> 'FX_VALIDATION' then raise exception 'S2b: a % catalogue must be FX_VALIDATION, got %', op, e; end if;
  end loop;
  -- an unknown catalogue version is refused
  e := pg_temp.fx_err(format('select pg_temp.fx_create(%L, %L, pg_temp.fx_terms(), %L, %L::jsonb)', pg_temp.fx_id('c1'), pg_temp.fx_id('a4'), 'state-cat-version', '{"catalogueVersion":"2026-01-01.v9"}'));
  if e <> 'FX_VALIDATION' then raise exception 'S2b: an unknown catalogue version must be FX_VALIDATION, got %', e; end if;
  -- nothing was created by the refusals
  if pg_temp.fx_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a4')) is not null then
    raise exception 'S2b: a refused catalogue must create no room'; end if;
  -- the exact catalogue named explicitly is accepted (the room is withdrawn again so S5 can open its own on this pairing)
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a4'), pg_temp.fx_terms(), 'state-create-a4-explicit', '{"catalogueVersion":"2026-09-23.v1"}'::jsonb);
  if (v->>'ok')::boolean is not true or (v->>'replayed')::boolean then raise exception 'S2b: the exact v1 catalogue named explicitly must be accepted, got %', v; end if;
  r := public.get_fixture_room((v->'data'->>'roomId')::uuid);
  if r->'room'->>'termCatalogueVersion' <> '2026-09-23.v1' then raise exception 'S2b: catalogue version not persisted: %', r->'room'; end if;
  v := public.close_fixture_room((v->'data'->>'roomId')::uuid, 'withdrawn', 'catalogue check only', pg_temp.fx_ver((v->'data'->>'roomId')::uuid), 'state-close-a4-explicit');
  -- the default (no option) is v1 as well: the S1 room carries it, and its ledger records it
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'state-create-1', '{}'::jsonb);
  if (v->>'replayed')::boolean is not true then raise exception 'S2b: the S1 key must replay, got %', v; end if;
  r := public.get_fixture_room((v->'data'->>'roomId')::uuid);
  if r->'room'->>'termCatalogueVersion' <> '2026-09-23.v1' then raise exception 'S2b: default catalogue version not persisted: %', r->'room'; end if;
  if (select string_agg(x->>'code', ',' order by (x->>'sortOrder')::int) from jsonb_array_elements(r->'terms') x) <> 'cargo_grade,quantity,ports,laycan,ld_rates,freight'
     or (select bool_and((x->>'required')::boolean) from jsonb_array_elements(r->'terms') x) is not true then
    raise exception 'S2b: the room must carry the six required terms in catalogue order: %', r->'terms'; end if;
  if (select x->>'hint' from jsonb_array_elements(r->'terms') x where x->>'code' = 'cargo_grade') <> 'Listing: Wheat, Bulk' then raise exception 'S2b: the listing hint must be kept'; end if;
  if not exists (select 1 from jsonb_array_elements(r->'events') x where x->>'type' = 'room.created' and x->'payload'->>'termCatalogueVersion' = '2026-09-23.v1') then
    raise exception 'S2b: the creation event must record the catalogue version'; end if;
  raise notice 'S2b ok: eleven catalogue deviations and an unknown version are refused; the exact v1 sheet is accepted, its version persisted on the room and in the ledger';
end $$;

-- ── S3 · invitation, proposals, version conflict, agreement ────────────────
do $$
declare v jsonb; r jsonb; v_room uuid; v_ver int; e text; v_tid uuid; v_owner_offer uuid; t jsonb;
begin
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'state-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid; v_ver := (v->>'version')::int;
  v_tid := pg_temp.fx_term(v_room, 'freight');
  -- the owner cannot act before accepting
  perform pg_temp.fx_as('u_ow1');
  e := pg_temp.fx_err(format('select public.submit_fixture_proposal(%L, %L, %L::jsonb, null, false, null, %s, %L)', v_room, v_tid, '{"num": 27}', v_ver, 'state-owner-early'));
  if e <> 'FX_STATE' then raise exception 'S3: invited owner proposing must be FX_STATE, got %', e; end if;
  -- the charterer opens with a bid while the room is still invited → negotiating
  perform pg_temp.fx_as('u_ch1');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 24.5, "currency": "USD"}'::jsonb, 'workable basis prompt', false, null, v_ver, 'state-bid-1');
  if v->'data'->>'roomStatus' <> 'negotiating' then raise exception 'S3: first proposal must move invited → negotiating: %', v; end if;
  if v->'data'->>'displayValue' <> '$24.50/MT' then raise exception 'S3: display value %', v->'data'->>'displayValue'; end if;
  v_ver := (v->>'version')::int;
  if v_ver <> 3 then raise exception 'S3: version after bid should be 3, got %', v_ver; end if;
  -- owner accepts the invitation, then offers
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_invitation(v_room, true, v_ver, 'state-accept-inv');
  v_ver := (v->>'version')::int;
  if pg_temp.fx_status(v_room) <> 'negotiating' then raise exception 'S3: still negotiating expected'; end if;
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 26.25}'::jsonb, 'valid 12 mins', false, 12, v_ver, 'state-offer-1');
  v_owner_offer := (v->'data'->>'proposalId')::uuid; v_ver := (v->>'version')::int;
  r := public.get_fixture_room(v_room);
  select x into t from jsonb_array_elements(r->'terms') x where x->>'code' = 'freight';
  if t->>'status' <> 'countered' or t->>'holder' <> 'cargo' or t->'vesselPosition'->>'displayValue' <> '$26.25/MT' or t->'cargoPosition'->>'displayValue' <> '$24.50/MT' then
    raise exception 'S3: term view wrong %', t; end if;
  if (t->'vesselPosition'->>'expiresAt') is null then raise exception 'S3: validity window missing'; end if;
  -- stale version is refused, never last-write-wins
  perform pg_temp.fx_as('u_ch1');
  e := pg_temp.fx_err(format('select public.accept_fixture_proposal(%L, %L, %s, %L)', v_room, v_owner_offer, v_ver - 1, 'state-accept-stale'));
  if e <> 'FX_VERSION_CONFLICT' then raise exception 'S3: stale expected_version must be FX_VERSION_CONFLICT, got %', e; end if;
  -- accepting one's own side's proposal is refused
  e := pg_temp.fx_err(format('select public.accept_fixture_proposal(%L, %L, %s, %L)', v_room, (t->'cargoPosition'->>'id')::uuid, v_ver, 'state-accept-own'));
  if e <> 'FX_STATE' then raise exception 'S3: accepting own proposal must be FX_STATE, got %', e; end if;
  -- the charterer accepts the owner's offer: exactly one agreed value
  v := public.accept_fixture_proposal(v_room, v_owner_offer, v_ver, 'state-accept-1');
  if v->'data'->>'termStatus' <> 'agreed' then raise exception 'S3: accept → agreed expected: %', v; end if;
  r := public.get_fixture_room(v_room);
  select x into t from jsonb_array_elements(r->'terms') x where x->>'code' = 'freight';
  if t->>'status' <> 'agreed' or t->'agreed'->>'displayValue' <> '$26.25/MT' or t->'agreed'->>'id' <> v_owner_offer::text then raise exception 'S3: agreed view %', t; end if;
  -- an agreed term takes no new proposal
  e := pg_temp.fx_err(format('select public.submit_fixture_proposal(%L, %L, %L::jsonb, null, false, null, %s, %L)', v_room, v_tid, '{"num": 20}', pg_temp.fx_ver(v_room), 'state-bid-after-agree'));
  if e <> 'FX_STATE' then raise exception 'S3: proposing on an agreed term must be FX_STATE, got %', e; end if;
  raise notice 'S3 ok: invited → negotiating on first proposal, invitation gate, stale version refused, one accepted proposal = the agreed value';
end $$;

-- ── S4 · fix on subjects, subjects, reopen, lift → fixed, terminal rules ────
do $$
declare v jsonb; r jsonb; v_room uuid; v_ver int; e text; v_tid uuid; v_pid uuid; v_code text; v_sub uuid; v_sub2 uuid; v_recap uuid; t jsonb; v_owner_party uuid;
begin
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'state-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  -- fixing with open terms is refused
  e := pg_temp.fx_err(format('select public.fix_fixture_on_subjects(%L, %s, %L)', v_room, pg_temp.fx_ver(v_room), 'state-fix-early'));
  if e <> 'FX_STATE' then raise exception 'S4: fix with open terms must be FX_STATE, got %', e; end if;
  -- agree the five remaining terms: charterer bids, owner accepts
  foreach v_code in array array['cargo_grade', 'quantity', 'ports', 'laycan', 'ld_rates'] loop
    v_tid := pg_temp.fx_term(v_room, v_code);
    perform pg_temp.fx_as('u_ch1');
    v := public.submit_fixture_proposal(v_room, v_tid, pg_temp.fx_value(v_code), null, true, null, pg_temp.fx_ver(v_room), 'state-bid-' || v_code);
    v_pid := (v->'data'->>'proposalId')::uuid;
    perform pg_temp.fx_as('u_ow1');
    v := public.accept_fixture_proposal(v_room, v_pid, pg_temp.fx_ver(v_room), 'state-accept-' || v_code);
    if v->'data'->>'termStatus' <> 'agreed' then raise exception 'S4: % not agreed: %', v_code, v; end if;
  end loop;
  -- publish a recap, then fix on subjects
  perform pg_temp.fx_as('u_ch1');
  v := public.publish_fixture_recap(v_room, pg_temp.fx_ver(v_room), 'state-recap-1');
  v_recap := (v->'data'->>'recapVersionId')::uuid;
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'state-fix-1');
  -- PR-07: one side's confirmation never fixes the room
  if v->'data'->>'roomStatus' <> 'negotiating' or v->'data'->>'awaitingSide' <> 'vessel' or pg_temp.fx_status(v_room) <> 'negotiating' then
    raise exception 'S4: the charterer alone must not fix the room, got %', v; end if;
  e := pg_temp.fx_err(format('select public.fix_fixture_on_subjects(%L, %s, %L)', v_room, pg_temp.fx_ver(v_room), 'state-fix-1-again'));
  if e <> 'FX_STATE' then raise exception 'S4: confirming twice must be FX_STATE, got %', e; end if;
  r := public.get_fixture_room(v_room);
  if r->'viewer'->'capabilities'->'fixConfirmedSides' <> '["cargo"]'::jsonb then raise exception 'S4: confirmed sides %', r->'viewer'->'capabilities'->'fixConfirmedSides'; end if;
  perform pg_temp.fx_as('u_ow1');
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'state-fix-1-owner');
  if v->'data'->>'roomStatus' <> 'fixed' then raise exception 'S4: with both sides confirmed and no subjects the fix must land clean (fixed), got %', v; end if;
  if pg_temp.fx_event_types(v_room) not like '%room.fix_confirmed,room.fix_confirmed,room.fixed_on_subjects,listing_sync.required,room.fixed%' then raise exception 'S4: ledger %', pg_temp.fx_event_types(v_room); end if;
  r := public.get_fixture_room(v_room);
  if r->'room'->>'status' <> 'fixed' or (r->'room'->>'fixedAt') is null or (r->'room'->>'fixedOnSubsAt') is null then raise exception 'S4: fixed marks %', r->'room'; end if;
  if r->'room'->'listingSync'->'vessel'->>'target' <> 'FIXED' or r->'room'->'listingSync'->'cargo'->>'target' <> 'OUT'
     or (r->'room'->'listingSync'->>'outstanding')::boolean is not true then raise exception 'S4: listing sync requirement %', r->'room'->'listingSync'; end if;
  if (select (x->>'invalidatedAt') is null from jsonb_array_elements(r->'recaps') x where x->>'id' = v_recap::text) then raise exception 'S4: fixing must invalidate the pending recap'; end if;
  -- fixed is final for negotiation: no proposals, no close, no reopen
  v_tid := pg_temp.fx_term(v_room, 'freight');
  e := pg_temp.fx_err(format('select public.reopen_fixture_term(%L, %L, %L, %s, %L)', v_room, v_tid, 'x', pg_temp.fx_ver(v_room), 'state-reopen-fixed'));
  if e <> 'FX_STATE' then raise exception 'S4: reopen on a fixed room must be FX_STATE, got %', e; end if;
  e := pg_temp.fx_err(format('select public.close_fixture_room(%L, %L, null, %s, %L)', v_room, 'withdrawn', pg_temp.fx_ver(v_room), 'state-close-fixed'));
  if e <> 'FX_STATE' then raise exception 'S4: closing a fixed room must be FX_STATE, got %', e; end if;
  raise notice 'S4 ok: all terms agreed → fix on subjects with no subjects lands clean-fixed; listing sync outstanding (vessel FIXED, cargo OUT); recap invalidated; fixed is final';
end $$;

-- ── S5 · on_subjects: add / extend / reopen returns to negotiating / lift → fixed atomically; fail → failed ─
do $$
declare v jsonb; r jsonb; v_room uuid; e text; v_tid uuid; v_pid uuid; v_code text; v_sub uuid; v_sub2 uuid; t jsonb; v_cargo_party uuid;
begin
  -- a second pairing: C1 with the solo owner's position A4 (individual member, direct)
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a4'), pg_temp.fx_terms(), 'state-create-a4', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  r := public.get_fixture_room(v_room);
  if not exists (select 1 from jsonb_array_elements(r->'parties') p where p->>'side' = 'vessel' and p->>'participationMode' = 'direct' and p->>'status' = 'invited') then
    raise exception 'S5: the solo owner must be a direct invited principal: %', r->'parties'; end if;
  perform pg_temp.fx_as('u_solo');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'state-a4-accept');
  foreach v_code in array array['cargo_grade', 'quantity', 'ports', 'laycan', 'ld_rates', 'freight'] loop
    v_tid := pg_temp.fx_term(v_room, v_code);
    perform pg_temp.fx_as('u_solo');
    v := public.submit_fixture_proposal(v_room, v_tid, pg_temp.fx_value(v_code), null, false, null, pg_temp.fx_ver(v_room), 'state-a4-offer-' || v_code);
    v_pid := (v->'data'->>'proposalId')::uuid;
    perform pg_temp.fx_as('u_ch1');
    v := public.accept_fixture_proposal(v_room, v_pid, pg_temp.fx_ver(v_room), 'state-a4-accept-' || v_code);
  end loop;
  -- subjects are added while negotiating; lifting is refused until on subjects
  v := public.add_fixture_subject(v_room, 'Sub shippers'' / stem approval', 'Charterers to confirm stem', 'cargo', now() + interval '2 days', pg_temp.fx_ver(v_room), 'state-a4-sub-1');
  v_sub := (v->'data'->>'subjectId')::uuid;
  perform pg_temp.fx_as('u_solo');
  v := public.add_fixture_subject(v_room, 'Sub owners'' management approval', null, 'vessel', null, pg_temp.fx_ver(v_room), 'state-a4-sub-2');
  v_sub2 := (v->'data'->>'subjectId')::uuid;
  e := pg_temp.fx_err(format('select public.lift_fixture_subject(%L, %L, %s, %L)', v_room, v_sub2, pg_temp.fx_ver(v_room), 'state-a4-lift-early'));
  if e <> 'FX_STATE' then raise exception 'S5: lifting while negotiating must be FX_STATE, got %', e; end if;
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'state-a4-fix');
  perform pg_temp.fx_as('u_ch1');
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'state-a4-fix-c');
  perform pg_temp.fx_as('u_solo');
  if v->'data'->>'roomStatus' <> 'on_subjects' or (v->'data'->>'openSubjects')::int <> 2 then raise exception 'S5: on_subjects with 2 open expected: %', v; end if;
  r := public.get_fixture_room(v_room);
  if r->'room'->'listingSync'->'vessel'->>'target' <> 'ON SUBS' then raise exception 'S5: on_subjects must require vessel ON SUBS: %', r->'room'->'listingSync'; end if;
  -- the wrong side cannot lift a side-responsible subject
  e := pg_temp.fx_err(format('select public.lift_fixture_subject(%L, %L, %s, %L)', v_room, v_sub, pg_temp.fx_ver(v_room), 'state-a4-lift-wrong'));
  if e <> 'FX_AUTH' then raise exception 'S5: owner lifting the charterer''s subject must be FX_AUTH, got %', e; end if;
  -- a deadline can be extended; reopening a term drops the room back to negotiating
  v := public.extend_fixture_subject(v_room, v_sub2, now() + interval '3 days', pg_temp.fx_ver(v_room), 'state-a4-extend');
  v_tid := pg_temp.fx_term(v_room, 'freight');
  v := public.reopen_fixture_term(v_room, v_tid, 'owners want to revisit freight', pg_temp.fx_ver(v_room), 'state-a4-reopen');
  if v->'data'->>'roomStatus' <> 'negotiating' then raise exception 'S5: reopen on subjects must return to negotiating: %', v; end if;
  r := public.get_fixture_room(v_room);
  select x into t from jsonb_array_elements(r->'terms') x where x->>'code' = 'freight';
  if t->>'status' <> 'open' or (t->>'reopenCount')::int <> 1 or t->'agreed' is not null and jsonb_typeof(t->'agreed') <> 'null' then raise exception 'S5: reopened term view %', t; end if;
  if r->'room'->'listingSync'->'vessel'->>'target' <> 'OPEN' then raise exception 'S5: back to negotiating must require the position back on market: %', r->'room'->'listingSync'; end if;
  if pg_temp.fx_event_types(v_room) not like '%term.reopened,room.returned_to_negotiation,listing_sync.required%' then raise exception 'S5: ledger %', pg_temp.fx_event_types(v_room); end if;
  -- re-agree freight, fix again, lift both subjects: the last lift fixes the room in the same statement
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 26}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'state-a4-offer-freight-2');
  v_pid := (v->'data'->>'proposalId')::uuid;
  perform pg_temp.fx_as('u_ch1');
  v := public.accept_fixture_proposal(v_room, v_pid, pg_temp.fx_ver(v_room), 'state-a4-accept-freight-2');
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'state-a4-fix-2');
  perform pg_temp.fx_as('u_solo');
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'state-a4-fix-2-o');
  perform pg_temp.fx_as('u_ch1');
  if v->'data'->>'roomStatus' <> 'on_subjects' then raise exception 'S5: second fix must be on_subjects: %', v; end if;
  v := public.lift_fixture_subject(v_room, v_sub, pg_temp.fx_ver(v_room), 'state-a4-lift-1');
  if v->'data'->>'roomStatus' <> 'on_subjects' or (v->'data'->>'openSubjects')::int <> 1 then raise exception 'S5: one subject left expected: %', v; end if;
  perform pg_temp.fx_as('u_solo');
  v := public.lift_fixture_subject(v_room, v_sub2, pg_temp.fx_ver(v_room), 'state-a4-lift-2');
  if v->'data'->>'roomStatus' <> 'fixed' or (v->'data'->>'openSubjects')::int <> 0 then raise exception 'S5: last lift must fix: %', v; end if;
  if pg_temp.fx_status(v_room) <> 'fixed' then raise exception 'S5: room not fixed after last lift'; end if;
  if pg_temp.fx_event_types(v_room) not like '%subject.lifted,room.fixed,listing_sync.required%' then raise exception 'S5: ledger %', pg_temp.fx_event_types(v_room); end if;
  raise notice 'S5 ok: subjects added/extended, wrong side refused, reopen → negotiating (+ sync back to market), last lift → fixed atomically';
end $$;

-- ── S6 · relayed counterparties, mediation on behalf, failure, terminal rooms, successor ─
do $$
declare v jsonb; r jsonb; v_room uuid; e text; v_tid uuid; v_pid uuid; v_code text; v_relayed uuid; v_sub uuid; p jsonb; v_room2 uuid;
begin
  -- C4 has no member owner but a contact record: the owner opens a room and the charterer side is a contact-backed relayed party
  perform pg_temp.fx_as('u_ow1');
  v := pg_temp.fx_create(pg_temp.fx_id('c4'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'state-create-c4', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  if (v->>'version')::int <> 1 then raise exception 'S6: a relayed counterparty needs no invitation event: version %', v->>'version'; end if;
  r := public.get_fixture_room(v_room);
  select x into p from jsonb_array_elements(r->'parties') x where x->>'side' = 'cargo' and x->>'capacity' = 'principal';
  if p->>'participationMode' <> 'relayed' or p->>'status' <> 'active' or p->>'label' <> 'Charterer side' or (p->>'resolved')::boolean is not true then
    raise exception 'S6: contact-backed relayed party expected: %', p; end if;
  v_relayed := (p->>'id')::uuid;
  -- the owner opens; the mediator (platform admin) records the charterer's counter on their behalf
  v_tid := pg_temp.fx_term(v_room, 'freight');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 31}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'state-c4-offer');
  perform pg_temp.fx_as('u_adm', true);
  e := pg_temp.fx_err(format('select public.submit_fixture_proposal(%L, %L, %L::jsonb, null, false, null, %s, %L)', v_room, v_tid, '{"num": 29}', pg_temp.fx_ver(v_room), 'state-c4-adm-noparty'));
  if e <> 'FX_VALIDATION' then raise exception 'S6: the mediator must name the represented party, got %', e; end if;
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 29.5}'::jsonb, 'relayed by phone', false, null, pg_temp.fx_ver(v_room), 'state-c4-relayed-bid', null, v_relayed);
  v_pid := (v->'data'->>'proposalId')::uuid;
  r := public.get_fixture_room(v_room);
  if not exists (select 1 from jsonb_array_elements(r->'proposals') x where x->>'id' = v_pid::text and (x->>'relayed')::boolean and x->>'side' = 'cargo') then
    raise exception 'S6: relayed proposal must be attributed to the cargo side and flagged relayed: %', r->'proposals'; end if;
  if not exists (select 1 from jsonb_array_elements(r->'events') x where x->>'type' = 'proposal.submitted' and (x->>'relayed')::boolean and x->>'onBehalfOfLabel' = 'Charterer side' and x->>'actorLabel' = 'Arab ShipBroker') then
    raise exception 'S6: relayed event must record actor (platform) and represented party: %', r->'events'; end if;
  -- the mediator cannot act for a DIRECT party
  e := pg_temp.fx_err(format('select public.accept_fixture_proposal(%L, %L, %s, %L, null, %L)', v_room, v_pid, pg_temp.fx_ver(v_room), 'state-c4-adm-direct', pg_temp.fx_party(v_room, 'vessel', 'principal')));
  if e <> 'FX_AUTH' then raise exception 'S6: mediator acting for a direct party must be FX_AUTH, got %', e; end if;
  -- the owner accepts the relayed bid; agree the rest via relay; fix on subjects; a failed subject fails the fixture
  perform pg_temp.fx_as('u_ow1');
  v := public.accept_fixture_proposal(v_room, v_pid, pg_temp.fx_ver(v_room), 'state-c4-accept-freight');
  foreach v_code in array array['cargo_grade', 'quantity', 'ports', 'laycan', 'ld_rates'] loop
    v_tid := pg_temp.fx_term(v_room, v_code);
    perform pg_temp.fx_as('u_ow1');
    v := public.submit_fixture_proposal(v_room, v_tid, pg_temp.fx_value(v_code), null, false, null, pg_temp.fx_ver(v_room), 'state-c4-offer-' || v_code);
    v_pid := (v->'data'->>'proposalId')::uuid;
    perform pg_temp.fx_as('u_adm', true);
    v := public.accept_fixture_proposal(v_room, v_pid, pg_temp.fx_ver(v_room), 'state-c4-accept-' || v_code, null, v_relayed);
  end loop;
  perform pg_temp.fx_as('u_ow1');
  v := public.add_fixture_subject(v_room, 'Sub stem', null, 'cargo', null, pg_temp.fx_ver(v_room), 'state-c4-sub');
  v_sub := (v->'data'->>'subjectId')::uuid;
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'state-c4-fix');
  -- the mediator confirms only for the relayed side it represents
  perform pg_temp.fx_as('u_adm', true);
  e := pg_temp.fx_err(format('select public.fix_fixture_on_subjects(%L, %s, %L)', v_room, pg_temp.fx_ver(v_room), 'state-c4-fix-adm-noparty'));
  if e <> 'FX_AUTH' then raise exception 'S6: the mediator confirming for nobody must be FX_AUTH, got %', e; end if;
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'state-c4-fix-relayed', null, v_relayed);
  if v->'data'->>'roomStatus' <> 'on_subjects' then raise exception 'S6: on_subjects expected: %', v; end if;
  perform pg_temp.fx_as('u_adm', true);
  v := public.fail_fixture_subject(v_room, v_sub, 'stem not approved', pg_temp.fx_ver(v_room), 'state-c4-fail', null, v_relayed);
  if v->'data'->>'roomStatus' <> 'failed' or pg_temp.fx_status(v_room) <> 'failed' then raise exception 'S6: failed subject must fail the room: %', v; end if;
  r := public.get_fixture_room(v_room);
  if r->'room'->'listingSync'->'vessel'->>'target' <> 'OPEN' then raise exception 'S6: a failed fixture must ask for the position back on market'; end if;
  -- terminal: nothing moves; a successor room on the same pairing is allowed
  perform pg_temp.fx_as('u_ow1');
  e := pg_temp.fx_err(format('select public.post_fixture_message(%L, %L, %L, %L, null, %s, %L)', v_room, 'hello', 'note', 'room', pg_temp.fx_ver(v_room), 'state-c4-msg-terminal'));
  if e <> 'FX_STATE' then raise exception 'S6: message on a terminal room must be FX_STATE, got %', e; end if;
  e := pg_temp.fx_err(format('select public.close_fixture_room(%L, %L, null, %s, %L)', v_room, 'withdrawn', pg_temp.fx_ver(v_room), 'state-c4-close-terminal'));
  if e <> 'FX_STATE' then raise exception 'S6: closing a terminal room must be FX_STATE, got %', e; end if;
  v := pg_temp.fx_create(pg_temp.fx_id('c4'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'state-create-c4-successor', '{}'::jsonb);
  v_room2 := (v->'data'->>'roomId')::uuid;
  if v_room2 = v_room then raise exception 'S6: successor must be a new room'; end if;
  -- withdraw: a principal may; the mediator may only for a relayed side
  perform pg_temp.fx_as('u_adm', true);
  e := pg_temp.fx_err(format('select public.close_fixture_room(%L, %L, null, %s, %L)', v_room2, 'withdrawn', pg_temp.fx_ver(v_room2), 'state-c4s-adm-withdraw'));
  if e <> 'FX_VALIDATION' then raise exception 'S6: mediator withdrawing without a represented party must be FX_VALIDATION, got %', e; end if;
  v := public.close_fixture_room(v_room2, 'expired', 'no reply in 48h', pg_temp.fx_ver(v_room2), 'state-c4s-expire');
  if pg_temp.fx_status(v_room2) <> 'expired' then raise exception 'S6: expected expired'; end if;
  -- C3 is owned by a platform admin → platform-synced → the charterer side is an unresolved party anchored to the listing
  perform pg_temp.fx_as('u_ow1');
  v := pg_temp.fx_create(pg_temp.fx_id('c3'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'state-create-c3', '{}'::jsonb);
  r := public.get_fixture_room((v->'data'->>'roomId')::uuid);
  select x into p from jsonb_array_elements(r->'parties') x where x->>'side' = 'cargo' and x->>'capacity' = 'principal';
  if p->>'participationMode' <> 'relayed' or (p->>'resolved')::boolean or p->>'name' is not null then raise exception 'S6: unresolved anchored party expected: %', p; end if;
  raise notice 'S6 ok: contact-backed and anchored relayed parties, mediation on behalf (never for a direct party), subject failure → failed, terminal rooms are final, successor room allowed';
end $$;

-- ── S7 · identity comes from the ownership row (FR-H1); two invitations need a choice (FR-M3) ─
do $$
declare v jsonb; r jsonb; v_room uuid; v_a4 uuid; e text; p jsonb; v_broker uuid; v_principal uuid; v_n int;
begin
  -- u_two holds two active seats (admin in org_ch, broker in org_two) and owns C5 through org_two
  perform pg_temp.fx_as('u_two');
  v := pg_temp.fx_create(pg_temp.fx_id('c5'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'state-create-c5', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  p := pg_temp.fx_party_identity(v_room, 'cargo');
  if (p->>'org_id')::uuid is distinct from pg_temp.fx_id('org_two') or p->>'user_id' is not null then
    raise exception 'S7: the charterer party must be the owning organisation (org_two), got %', p; end if;
  -- a colleague from the OTHER seat (org_ch) is no participant of a room owned through org_two
  perform pg_temp.fx_as('u_ch2');
  e := pg_temp.fx_err(format('select public.get_fixture_room(%L)', v_room));
  if e <> 'FX_AUTH' then raise exception 'S7: an org_ch colleague must not reach a room owned through org_two, got %', e; end if;
  -- personal ownership while the member sits in an unrelated organisation: the party is the member (S5 opened C1 + A4; A4 is u_solo''s)
  v_a4 := pg_temp.fx_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a4'));
  if v_a4 is null then raise exception 'S7: the S5 room on C1 + A4 should exist'; end if;
  p := pg_temp.fx_party_identity(v_a4, 'vessel');
  if p->>'org_id' is not null or (p->>'user_id')::uuid is distinct from pg_temp.fx_id('u_solo') or p->>'mode' <> 'direct' then
    raise exception 'S7: a personally owned position must be represented by the member, not by an unrelated seat: %', p; end if;
  -- and when that member opens a room on it, the creator party is the member too
  perform pg_temp.fx_as('u_solo');
  v := pg_temp.fx_create(pg_temp.fx_id('c2'), pg_temp.fx_id('a4'), pg_temp.fx_terms(), 'state-create-c2-a4', '{}'::jsonb);
  p := pg_temp.fx_party_identity((v->'data'->>'roomId')::uuid, 'vessel');
  if p->>'org_id' is not null or (p->>'user_id')::uuid is distinct from pg_temp.fx_id('u_solo') then
    raise exception 'S7: the creator of a personally owned listing must be recorded personally: %', p; end if;
  -- FR-M3: the platform invites u_ow1 personally as a vessel-side broker on the C5 room; u_ow1 now holds two invitations (org_ow principal + personal broker)
  perform pg_temp.fx_as('u_adm', true);
  v := public.invite_fixture_party(v_room, 'vessel', 'broker', null, pg_temp.fx_id('u_ow1'), pg_temp.fx_ver(v_room), 'state-c5-invite-ow1-broker');
  v_broker := (v->'data'->>'partyId')::uuid;
  v_principal := pg_temp.fx_party(v_room, 'vessel', 'principal');
  perform pg_temp.fx_as('u_ow1');
  r := public.get_fixture_room(v_room);
  select count(*) into v_n from jsonb_array_elements(r->'parties') x where x->>'isViewer' = 'true' and x->>'status' = 'invited';
  if v_n <> 2 then raise exception 'S7: u_ow1 should hold two invitations, got %', v_n; end if;
  e := pg_temp.fx_err(format('select public.respond_fixture_invitation(%L, true, %s, %L)', v_room, pg_temp.fx_ver(v_room), 'state-c5-accept-ambiguous'));
  if e <> 'FX_VALIDATION' then raise exception 'S7: answering two invitations without naming one must be FX_VALIDATION, got %', e; end if;
  e := pg_temp.fx_err(format('select public.respond_fixture_invitation(%L, true, %s, %L, %L)', v_room, pg_temp.fx_ver(v_room), 'state-c5-accept-foreign', pg_temp.fx_party(v_room, 'cargo', 'principal')));
  if e <> 'FX_AUTH' then raise exception 'S7: naming a party that is not one of one''s own invitations must be FX_AUTH, got %', e; end if;
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'state-c5-accept-broker', v_broker);
  if v->'data'->>'partyId' <> v_broker::text or v->'data'->>'status' <> 'active' then raise exception 'S7: the named broker invitation must be the one accepted: %', v; end if;
  r := public.get_fixture_room(v_room);
  if not exists (select 1 from jsonb_array_elements(r->'parties') x where x->>'id' = v_principal::text and x->>'status' = 'invited') then
    raise exception 'S7: the organisation principal must still be invited after the personal broker accepted'; end if;
  -- with one invitation left, no party id is needed
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'state-c5-accept-principal');
  if v->'data'->>'partyId' <> v_principal::text then raise exception 'S7: the remaining single invitation must be answered without a party id: %', v; end if;
  raise notice 'S7 ok: party identity is the ownership row (owning org with a seat there; the member personally, never a guessed seat); two invitations require naming one';
end $$;
