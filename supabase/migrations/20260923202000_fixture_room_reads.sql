-- ════════════════════════════════════════════════════════════════════════
-- Fixture Room · Phase 1 · governed reads (23 Sep 2026, architecture 1.0)
--
--   get_fixture_room_version(room)   cheap poll: the room's version
--   get_fixture_room(room, after)    the whole masked read model
--   list_fixture_rooms(status[], n)  the viewer's inbox
--
-- All three are SECURITY DEFINER and granted to authenticated; the tables
-- behind them are not. Masking happens here, before serialisation:
--   · a counterparty is a side-safe label until both principals agreed to
--     disclosure; afterwards its trade / organisation name and desk label —
--     never a person's name, email or phone (decision D2);
--   · raw org / user / contact ids are returned to admins only;
--   · a TBN vessel's name, IMO and stable identifiers (vessel id on the room,
--     the snapshot and the listing-sync view) are withheld from the cargo
--     side until disclosure — the vessel IS the counterparty's identity;
--   · side-private and mediator-private messages are filtered by side.
-- Every CONTENT-BEARING admin read (get_fixture_room, list_fixture_rooms)
-- writes fixture_access_log (durable, never pruned). The five-second version
-- poll (get_fixture_room_version) returns one integer and is not logged: a
-- row per poll would be volume without evidence (audit FR-L1 boundary).
--
-- Idempotent. DOWN: supabase/rollback/20260923_fixture_room_down.sql
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.fn_fixture_proposal_json(pr public.fixture_proposals, p_side text, p_label text, p_actor uuid)
 returns jsonb language sql stable set search_path to ''
as $$
  select jsonb_build_object(
    'id', pr.id, 'termId', pr.term_id, 'partyId', pr.party_id, 'side', p_side, 'label', p_label,
    'kind', pr.kind, 'valueKind', pr.value_kind, 'value', pr.value, 'displayValue', pr.display_value,
    'comment', pr.comment, 'isFinal', pr.is_final, 'expiresAt', pr.expires_at,
    'lapsed', (pr.expires_at is not null and pr.expires_at < now()),
    'supersedesId', pr.supersedes_proposal_id, 'round', pr.round, 'relayed', pr.relayed,
    'isMine', (pr.recorded_by_user_id = p_actor), 'eventId', pr.event_id, 'createdAt', pr.created_at);
$$;
revoke all on function public.fn_fixture_proposal_json(public.fixture_proposals, text, text, uuid) from public, anon, authenticated;

-- ── version poll ────────────────────────────────────────────────────────────
create or replace function public.get_fixture_room_version(p_room_id uuid)
 returns integer language plpgsql stable security definer set search_path to 'public'
as $$
declare v integer;
begin
  perform public.fn_fixture_actor();
  if not public.fn_can_access_fixture(p_room_id) then
    raise exception 'FX_AUTH: you are not a participant in this room' using errcode = '42501';
  end if;
  select r.version into v from public.fixture_rooms r where r.id = p_room_id;
  if v is null then
    raise exception 'FX_NOT_FOUND: room % not found', p_room_id using errcode = 'P0002';
  end if;
  return v;
end $$;
revoke all on function public.get_fixture_room_version(uuid) from public, anon, authenticated;
grant execute on function public.get_fixture_room_version(uuid) to authenticated, service_role;

-- ── the read model ──────────────────────────────────────────────────────────
create or replace function public.get_fixture_room(p_room_id uuid, p_events_after integer default 0)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  r public.fixture_rooms;
  v_actor uuid; v_admin boolean; v_parties public.fixture_parties[]; v_party_ids uuid[]; v_side text;
  v_disclosed boolean; v_unmasked boolean; v_mediator boolean := false; v_labels jsonb; v_relayed_ids uuid[];
  v_tbn boolean; v_mask_vessel boolean; v_vessel jsonb;
  v_parties_json jsonb; v_terms jsonb; v_proposals jsonb; v_subjects jsonb; v_messages jsonb; v_recaps jsonb; v_events jsonb; v_caps jsonb;
  v_room jsonb;
begin
  v_actor := public.fn_fixture_actor();
  v_admin := public.fn_is_admin();
  select * into r from public.fixture_rooms x where x.id = p_room_id;
  if r.id is null then
    if v_admin then
      raise exception 'FX_NOT_FOUND: room % not found', p_room_id using errcode = 'P0002';
    end if;
    raise exception 'FX_AUTH: you are not a participant in this room' using errcode = '42501';
  end if;

  select coalesce(array_agg(p), '{}'::public.fixture_parties[]) into v_parties from public.fn_fixture_actor_parties(r.id) p;
  if not v_admin and coalesce(array_length(v_parties, 1), 0) = 0 then
    raise exception 'FX_AUTH: you are not a participant in this room' using errcode = '42501';
  end if;
  v_party_ids := array(select p.id from unnest(v_parties) p);
  v_mediator := exists (select 1 from unnest(v_parties) p where p.status = 'active' and p.side = 'mediator' and p.capacity = 'broker');
  select p.side into v_side from unnest(v_parties) p
   where p.status = 'active' and p.side in ('cargo', 'vessel')
   order by (p.capacity = 'principal') desc, (p.capacity = 'broker') desc limit 1;
  if v_side is null and v_mediator then v_side := 'mediator'; end if;
  v_unmasked := v_admin;
  v_disclosed := r.counterparty_disclosed_at is not null;

  if v_admin then
    insert into public.fixture_access_log (room_id, user_id, is_admin, reason)
    values (r.id, v_actor, true, case when v_mediator then 'mediate' else 'inspect' end);
  end if;

  v_relayed_ids := array(select p.id from public.fixture_parties p where p.room_id = r.id and p.status = 'active' and p.participation_mode = 'relayed');
  select coalesce(jsonb_object_agg(p.id::text, p.display_label), '{}'::jsonb) into v_labels from public.fixture_parties p where p.room_id = r.id;

  -- vessel identity: a TBN vessel is masked from the cargo side until disclosure
  v_vessel := r.vessel_snapshot;
  v_tbn := coalesce((v_vessel->'vessel'->>'is_tbn')::boolean, false);
  v_mask_vessel := v_tbn and not (v_unmasked or v_disclosed or coalesce(v_side, '') in ('vessel', 'mediator'));
  if v_mask_vessel then
    v_vessel := jsonb_set(jsonb_set(v_vessel, '{vessel,vessel_name}', '"TBN"'::jsonb), '{vessel,imo_number}', 'null'::jsonb);
    -- the stable identifiers are the vessel's identity too (audit FR-H3)
    v_vessel := jsonb_set(jsonb_set(v_vessel, '{vessel,id}', 'null'::jsonb), '{availability,vessel_id}', 'null'::jsonb);
  end if;

  select coalesce(jsonb_agg(public.fn_fixture_party_json(p, v_party_ids, v_side, v_disclosed, v_unmasked)
                            order by (p.side = 'cargo') desc, (p.side = 'vessel') desc, (p.capacity = 'principal') desc, p.created_at), '[]'::jsonb)
    into v_parties_json
    from public.fixture_parties p where p.room_id = r.id and p.status <> 'removed';

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'code', t.code, 'label', t.label, 'category', t.category, 'sortOrder', t.sort_order,
      'valueKind', t.value_kind, 'unit', t.unit, 'required', t.required, 'hint', t.hint, 'status', t.status,
      'cargoPosition', case when cp.id is not null then public.fn_fixture_proposal_json(cp, 'cargo', v_labels->>(cp.party_id::text), v_actor) end,
      'vesselPosition', case when vp.id is not null then public.fn_fixture_proposal_json(vp, 'vessel', v_labels->>(vp.party_id::text), v_actor) end,
      'agreed', case when ap.id is not null then public.fn_fixture_proposal_json(ap, aps.side, v_labels->>(ap.party_id::text), v_actor) end,
      'agreedAt', t.agreed_at, 'agreedByLabel', v_labels->>(t.agreed_by_party_id::text),
      'holder', case when t.status = 'agreed' or lp.id is null then null when lps.side = 'cargo' then 'vessel' else 'cargo' end,
      'lastProposalSide', lps.side,
      'round', (select count(*) from public.fixture_proposals x where x.term_id = t.id),
      'reopenCount', t.reopen_count,
      'heldByLabel', v_labels->>(t.held_by_party_id::text), 'heldAt', t.held_at,
      'referredAt', t.referred_at, 'referredByLabel', v_labels->>(t.referred_by_party_id::text))
    order by t.sort_order), '[]'::jsonb)
    into v_terms
    from public.fixture_terms t
    left join public.fixture_proposals cp on cp.id = t.cargo_proposal_id
    left join public.fixture_proposals vp on vp.id = t.vessel_proposal_id
    left join public.fixture_proposals ap on ap.id = t.agreed_proposal_id
    left join public.fixture_parties aps on aps.id = ap.party_id
    left join public.fixture_proposals lp on lp.id = t.last_proposal_id
    left join public.fixture_parties lps on lps.id = lp.party_id
   where t.room_id = r.id;

  select coalesce(jsonb_agg(public.fn_fixture_proposal_json(pr, pp.side, pp.display_label, v_actor) order by pr.created_at, pr.round), '[]'::jsonb)
    into v_proposals
    from public.fixture_proposals pr join public.fixture_parties pp on pp.id = pr.party_id
   where pr.room_id = r.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'seq', s.seq, 'title', s.title, 'description', s.description, 'responsibleSide', s.responsible_side,
      'deadlineAt', s.deadline_at, 'extendedCount', s.extended_count, 'status', s.status,
      'addedByLabel', v_labels->>(s.added_by_party_id::text), 'resolvedAt', s.resolved_at,
      'resolvedByLabel', v_labels->>(s.resolved_by_party_id::text), 'createdAt', s.created_at) order by s.seq), '[]'::jsonb)
    into v_subjects from public.fixture_subjects s where s.room_id = r.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'partyId', m.party_id, 'label', v_labels->>(m.party_id::text), 'side', mp.side,
      'kind', m.kind, 'visibility', m.visibility, 'termId', m.term_id,
      'body', case when m.redacted_at is null then m.body end, 'redacted', m.redacted_at is not null,
      'isMine', m.author_user_id = v_actor, 'createdAt', m.created_at) order by m.created_at), '[]'::jsonb)
    into v_messages
    from public.fixture_messages m join public.fixture_parties mp on mp.id = m.party_id
   where m.room_id = r.id
     and (v_unmasked
          or m.visibility = 'room'
          or (m.visibility = 'side' and (v_mediator or mp.side = v_side))
          or (m.visibility = 'mediator' and v_mediator));

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', rv.id, 'versionNo', rv.version_no, 'roomVersion', rv.room_version, 'publishedAt', rv.published_at,
      'publishedByLabel', v_labels->>(rv.published_by_party_id::text), 'invalidatedAt', rv.invalidated_at,
      'contentHash', rv.content_hash, 'content', rv.content, 'contentText', rv.content_text,
      'acknowledgements', (select coalesce(jsonb_agg(jsonb_build_object(
            'partyId', coalesce(e.on_behalf_of_party_id, e.actor_party_id),
            'label', v_labels->>(coalesce(e.on_behalf_of_party_id, e.actor_party_id)::text),
            'at', e.created_at, 'relayed', e.relayed) order by e.created_at), '[]'::jsonb)
          from public.fixture_events e
         where e.room_id = r.id and e.type = 'recap.acknowledged' and e.payload->>'recapVersionId' = rv.id::text),
      'acknowledgedByAllPrincipals', not exists (
          select 1 from public.fixture_parties pp
           where pp.room_id = r.id and pp.status = 'active' and pp.capacity = 'principal' and pp.side in ('cargo', 'vessel')
             and not exists (select 1 from public.fixture_events e
                              where e.room_id = r.id and e.type = 'recap.acknowledged'
                                and e.payload->>'recapVersionId' = rv.id::text
                                and coalesce(e.on_behalf_of_party_id, e.actor_party_id) = pp.id)),
      'viewerAcknowledged', exists (
          select 1 from public.fixture_events e
           where e.room_id = r.id and e.type = 'recap.acknowledged' and e.payload->>'recapVersionId' = rv.id::text
             and coalesce(e.on_behalf_of_party_id, e.actor_party_id) = any (v_party_ids)))
    order by rv.version_no desc), '[]'::jsonb)
    into v_recaps from public.fixture_recap_versions rv where rv.room_id = r.id;

  select coalesce(jsonb_agg(public.fn_fixture_event_json(e, v_labels, v_unmasked) order by e.seq), '[]'::jsonb)
    into v_events
    from (select * from public.fixture_events x where x.room_id = r.id and x.seq > coalesce(p_events_after, 0) order by x.seq limit 1000) e;

  v_caps := public.fn_fixture_capabilities(r, v_parties, v_admin, v_relayed_ids);

  v_room := jsonb_build_object(
    'id', r.id, 'ref', r.ref, 'status', r.status, 'version', r.version, 'mediation', r.mediation,
    'cargoListingId', r.cargo_listing_id, 'vesselAvailabilityId', r.vessel_availability_id,
    'vesselId', case when v_mask_vessel then null else r.vessel_id end,
    'termCatalogueVersion', r.term_catalogue_version,
    'createdAt', r.created_at, 'updatedAt', r.updated_at,
    'fixedOnSubsAt', r.fixed_on_subs_at, 'fixedAt', r.fixed_at,
    'closedAt', r.closed_at, 'closedReason', r.closed_reason, 'closedNote', r.closed_note,
    'counterpartyDisclosed', v_disclosed, 'counterpartyDisclosedAt', r.counterparty_disclosed_at,
    'negotiationWindowEndsAt', r.negotiation_window_ends_at, 'supersedesRoomId', r.supersedes_room_id,
    'snapshotAt', r.snapshot_at, 'snapshotHash', r.snapshot_hash, 'brokerageTerms', r.brokerage_terms_snapshot,
    'listingSync', public.fn_fixture_listing_sync(r, v_mask_vessel), 'serverNow', now());
  if v_unmasked then
    v_room := v_room || jsonb_build_object('createdByUserId', r.created_by_user_id, 'createdByPartyId', r.created_by_party_id,
                                           'closedByUserId', r.closed_by_user_id, 'createIdempotencyKey', r.create_idempotency_key);
  end if;

  return jsonb_build_object(
    'room', v_room,
    'snapshot', jsonb_build_object('cargo', r.cargo_snapshot, 'vessel', v_vessel, 'vesselIdentityMasked', v_mask_vessel),
    'viewer', jsonb_build_object('partyIds', to_jsonb(v_party_ids), 'side', v_side, 'isAdmin', v_admin, 'isMediator', v_mediator, 'capabilities', v_caps),
    'parties', v_parties_json, 'terms', v_terms, 'proposals', v_proposals, 'subjects', v_subjects,
    'messages', v_messages, 'recaps', v_recaps, 'events', v_events);
end $$;
revoke all on function public.get_fixture_room(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_fixture_room(uuid, integer) to authenticated, service_role;

-- ── admin: the access log of a room ─────────────────────────────────────────
-- For the admin console (app/(admin)/admin/fixtures). Admin-only through the
-- same authority as every other admin read (fn_is_admin(), the JWT claim);
-- reading the log is not itself logged — it IS the log. Members get FX_AUTH.
create or replace function public.admin_fixture_access_log(p_room_id uuid, p_limit integer default 100)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_out jsonb;
begin
  perform public.fn_fixture_actor();
  if not public.fn_is_admin() then
    raise exception 'FX_AUTH: the access log is an admin read' using errcode = '42501';
  end if;
  if p_room_id is null or not exists (select 1 from public.fixture_rooms r where r.id = p_room_id) then
    raise exception 'FX_NOT_FOUND: room % not found', p_room_id using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'userId', l.user_id, 'isAdmin', l.is_admin, 'reason', l.reason, 'at', l.at,
      'userLabel', coalesce(nullif(btrim(u.full_name), ''), 'Admin')) order by l.at desc), '[]'::jsonb)
    into v_out
    from (select * from public.fixture_access_log x where x.room_id = p_room_id order by x.at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) l
    left join public.users u on u.id = l.user_id;
  return v_out;
end $$;
revoke all on function public.admin_fixture_access_log(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_fixture_access_log(uuid, integer) to authenticated, service_role;

-- ── inbox ───────────────────────────────────────────────────────────────────
create or replace function public.list_fixture_rooms(p_status text[] default null, p_limit integer default 50)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; v_admin boolean; v_orgs uuid[]; v_out jsonb;
begin
  v_actor := public.fn_fixture_actor();
  v_admin := public.fn_is_admin();
  v_orgs := public.fn_fixture_member_org_ids();
  if v_admin then
    insert into public.fixture_access_log (room_id, user_id, is_admin, reason) values (null, v_actor, true, 'list');
  end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into v_out from (
    select r.id, r.ref, r.status, r.version, r.created_at as "createdAt", r.updated_at as "updatedAt",
           r.fixed_on_subs_at as "fixedOnSubsAt", r.fixed_at as "fixedAt", r.closed_reason as "closedReason",
           (r.counterparty_disclosed_at is not null) as "counterpartyDisclosed",
           jsonb_build_object('ref', r.cargo_snapshot->>'ref', 'commodity', r.cargo_snapshot->>'commodity_name',
                              'qtyMin', r.cargo_snapshot->'qty_min_mt', 'qtyMax', r.cargo_snapshot->'qty_max_mt',
                              'loadPort', r.cargo_snapshot->>'load_port_name', 'dischPort', r.cargo_snapshot->>'disch_port_name',
                              'laycanFrom', r.cargo_snapshot->>'laycan_from', 'laycanTo', r.cargo_snapshot->>'laycan_to') as cargo,
           jsonb_build_object(
             'name', case when coalesce((r.vessel_snapshot->'vessel'->>'is_tbn')::boolean, false)
                               and not (v_admin or r.counterparty_disclosed_at is not null or coalesce(mine.side, '') in ('vessel', 'mediator'))
                          then 'TBN' else r.vessel_snapshot->'vessel'->>'vessel_name' end,
             'type', r.vessel_snapshot->'vessel'->>'vessel_type', 'dwt', r.vessel_snapshot->'vessel'->'dwt_grain',
             'openPort', r.vessel_snapshot->'availability'->>'open_port_name', 'openDate', r.vessel_snapshot->'availability'->>'open_date') as vessel,
           mine.side as "mySide", mine.capacity as "myCapacity", mine.status as "myStatus",
           (select p.display_label from public.fixture_parties p
             where p.room_id = r.id and p.status in ('invited', 'active') and p.capacity = 'principal'
               and p.side in ('cargo', 'vessel') and p.side is distinct from mine.side
             order by p.created_at limit 1) as "counterpartyLabel",
           (select count(*) from public.fixture_terms t where t.room_id = r.id) as "termCount",
           (select count(*) from public.fixture_terms t where t.room_id = r.id and t.status = 'agreed') as "agreedTerms",
           (select count(*) from public.fixture_subjects s where s.room_id = r.id and s.status = 'open') as "openSubjects",
           coalesce((public.fn_fixture_listing_sync(r)->>'outstanding')::boolean, false) as "listingSyncOutstanding"
      from public.fixture_rooms r
      left join lateral (
        select p.side, p.capacity, p.status from public.fixture_parties p
         where p.room_id = r.id and p.status in ('invited', 'active') and p.participation_mode = 'direct'
           and ((p.org_id is not null and p.org_id = any (v_orgs)) or (p.user_id is not null and p.user_id = v_actor) or (p.is_platform and v_admin))
         order by (p.capacity = 'principal') desc, (p.capacity = 'broker') desc, p.is_platform, p.created_at limit 1) mine on true
     where (p_status is null or r.status = any (p_status))
       and (v_admin or mine.side is not null)
     order by r.updated_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)) x;
  return v_out;
end $$;
revoke all on function public.list_fixture_rooms(text[], integer) from public, anon, authenticated;
grant execute on function public.list_fixture_rooms(text[], integer) to authenticated, service_role;
