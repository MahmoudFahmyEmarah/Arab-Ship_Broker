-- ════════════════════════════════════════════════════════════════════════
-- Fixture Room · the mediator's bridging suggestion (7 Oct 2026, Wave 3)
-- Release plan B2C-033 Wave 3 (Fixture): "the mediator may put a bridging
-- figure on a term; either side may adopt it".
--
-- suggest_fixture_bridge(room, term, value, comment, expected_version, key):
--   * only the room's active mediator (side = mediator, capacity = broker)
--     may suggest; a principal, a side broker, a viewer or an outsider is
--     FX_AUTH;
--   * the room must be invited / negotiating and inside its window (PR-08);
--     the term must exist, not be agreed and not be withdrawn;
--   * the value is validated and displayed with the term's own kind and unit;
--   * a suggestion is ADVISORY: it is one new ledger event,
--     term.bridge_suggested, and moves nothing — no proposal, no holder, no
--     term status. Hold / refer therefore do not block it, but they still
--     block the adoption, which is an ordinary submit_fixture_proposal by
--     either side (the UI fills the composer with the suggested value);
--   * idempotent like every command: the replay returns the stored envelope — only to the same mediator
--     (authority is checked first and the actor is part of the request hash, C2O-089).
--
-- get_fixture_room gains `bridges`: per term, the latest suggestion that is
-- still live — the term is not agreed or withdrawn, and the suggestion came
-- after the term's last agreement or reopening. It is computed from the
-- ledger, then the masked-vessel scrub runs over it like over everything else.
--
-- Idempotent. DOWN: supabase/rollback/20261007_fixture_bridge_suggestion_down.sql
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · event type ──────────────────────────────────────────────────────────
-- The CHECK is rebuilt with term.bridge_suggested added. The saved 'down:'
-- comment (written by 20261006100000, read by its DOWN) is carried over
-- unchanged, so that DOWN still restores the pre-enforcement list.
do $$
declare v_comment text;
begin
  select obj_description(oid, 'pg_constraint') into v_comment from pg_constraint
   where conrelid = 'public.fixture_events'::regclass and conname = 'fixture_events_type_check';
  alter table public.fixture_events drop constraint if exists fixture_events_type_check;
  alter table public.fixture_events add constraint fixture_events_type_check check (type in (
    'room.created','party.invited','party.accepted','party.declined','party.removed',
    'party.disclosure_agreed','room.counterparty_disclosed',
    'proposal.submitted','proposal.withdrawn','proposal.lapsed','proposal.accepted',
    'term.agreed','term.reopened','term.held','term.resumed','term.referred','term.referral_cleared',
    'term.bridge_suggested',
    'subject.added','subject.lifted','subject.failed','subject.extended','subject.reinstated',
    'room.fix_confirmed','room.fixed_on_subjects','room.fixed','room.returned_to_negotiation','room.window_extended',
    'recap.published','recap.acknowledged','recap.invalidated',
    'message.posted','message.redacted',
    'listing_sync.required','listing_sync.applied','pda.linked','room.closed'));
  if v_comment is not null then
    execute format('comment on constraint fixture_events_type_check on public.fixture_events is %L', v_comment);
  end if;
end $$;

-- ── 2 · the command ─────────────────────────────────────────────────────────
create or replace function public.suggest_fixture_bridge(
  p_room_id uuid, p_term_id uuid, p_value jsonb, p_comment text, p_expected_version integer, p_idempotency_key text)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; med public.fixture_parties; t public.fixture_terms;
        v_norm jsonb; v_display text; v_comment text; v_first jsonb;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  -- authority BEFORE replay (C2O-089 P1): the caller's own active mediator seat, whichever other seats it holds;
  -- a principal, a removed participant or an outsider holding the original key gets FX_AUTH, never the envelope
  select p.* into med from public.fn_fixture_actor_parties(r.id) p
   where p.side = 'mediator' and p.capacity = 'broker' and p.status = 'active'
   order by p.created_at limit 1;
  if med.id is null then
    raise exception 'FX_AUTH: only the mediator can suggest a bridging figure' using errcode = '42501';
  end if;
  -- the replay is bound to the actor too: another mediator reusing the key is a different request
  v_hash := md5(jsonb_build_object('cmd', 'suggest_fixture_bridge', 'actor', v_actor, 'party', med.id, 'term', p_term_id, 'value', p_value, 'comment', p_comment)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status not in ('invited', 'negotiating') then
    raise exception 'FX_STATE: suggestions are not accepted while the room is %', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  perform public.fn_fixture_require_window(r);
  select * into t from public.fixture_terms x where x.id = p_term_id and x.room_id = r.id for update;
  if t.id is null then
    raise exception 'FX_NOT_FOUND: term not found in this room' using errcode = 'P0002';
  end if;
  if t.status = 'agreed' then
    raise exception 'FX_STATE: "%" is agreed — reopen it before suggesting a figure', t.label using errcode = '55000';
  end if;
  if t.status = 'withdrawn' then
    raise exception 'FX_STATE: "%" was withdrawn from the term sheet', t.label using errcode = '55000';
  end if;
  v_norm := public.fn_fixture_validate_value(t.value_kind, p_value);
  v_display := public.fn_fixture_display_value(t.value_kind, v_norm, t.unit);
  if coalesce(length(p_comment), 0) > 1000 then
    raise exception 'FX_VALIDATION: comment must be at most 1000 characters' using errcode = '22023';
  end if;
  v_comment := nullif(btrim(coalesce(p_comment, '')), '');
  v_first := public.fn_fixture_event(r.id, 'term.bridge_suggested', v_actor, med.id, null, false, 'suggest_fixture_bridge', p_idempotency_key, v_hash,
    jsonb_build_object('termId', t.id, 'termCode', t.code, 'termLabel', t.label, 'side', 'mediator',
                       'displayValue', v_display, 'value', v_norm, 'comment', v_comment),
    jsonb_build_object('termId', t.id, 'termStatus', t.status, 'displayValue', v_display, 'value', v_norm));
  return v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id));
end $$;
revoke all on function public.suggest_fixture_bridge(uuid, uuid, jsonb, text, integer, text) from public, anon, authenticated;
grant execute on function public.suggest_fixture_bridge(uuid, uuid, jsonb, text, integer, text) to authenticated, service_role;
comment on function public.suggest_fixture_bridge(uuid, uuid, jsonb, text, integer, text) is
  'Fixture Room (Wave 3): the mediator puts an advisory bridging figure on an open term (event term.bridge_suggested); either side adopts it with submit_fixture_proposal.';

-- ── 3 · the live suggestion per term ────────────────────────────────────────
create or replace function public.fn_fixture_live_bridges(p_room_id uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'termId', t.id, 'termCode', t.code, 'eventId', e.id, 'seq', e.seq,
           'displayValue', e.payload->>'displayValue', 'value', e.payload->'value', 'comment', e.payload->>'comment',
           'suggestedAt', e.created_at, 'byLabel', coalesce(p.display_label, 'Arab ShipBroker'))
         order by t.sort_order, t.code), '[]'::jsonb)
    from public.fixture_terms t
    join lateral (select x.* from public.fixture_events x
                   where x.room_id = t.room_id and x.type = 'term.bridge_suggested' and x.payload->>'termId' = t.id::text
                   order by x.seq desc limit 1) e on true
    left join public.fixture_parties p on p.id = e.actor_party_id
   where t.room_id = p_room_id
     and t.status not in ('agreed', 'withdrawn')
     and e.seq > coalesce((select max(x.seq) from public.fixture_events x
                            where x.room_id = t.room_id and x.type in ('term.agreed', 'term.reopened')
                              and x.payload->>'termId' = t.id::text), 0);
$$;
revoke all on function public.fn_fixture_live_bridges(uuid) from public, anon, authenticated;

-- ── 4 · the room read carries them (the 208000 wrapper, plus `bridges`) ─────
-- fn_fixture_room_read_unscrubbed authorises the viewer first; bridges are
-- added only after it returned, and before the masked-vessel scrub.
create or replace function public.get_fixture_room(p_room_id uuid, p_events_after integer default 0)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v jsonb; v_avail uuid; v_vessel uuid; v_name text; v_imo text;
begin
  v := public.fn_fixture_room_read_unscrubbed(p_room_id, p_events_after);
  v := v || jsonb_build_object('bridges', public.fn_fixture_live_bridges(p_room_id));
  if coalesce((v->'snapshot'->>'vesselIdentityMasked')::boolean, false) then
    select x.vessel_availability_id, x.vessel_id, x.vessel_snapshot->'vessel'->>'vessel_name', x.vessel_snapshot->'vessel'->>'imo_number'
      into v_avail, v_vessel, v_name, v_imo from public.fixture_rooms x where x.id = p_room_id;
    -- every occurrence, in every string (ids, messages, comments, titles, notes, event payloads);
    -- the hidden hull's name (with and without an MV prefix) and IMO are withheld too
    v := public.fn_fixture_scrub_masked(v, array[v_avail, v_vessel],
           array[v_name, regexp_replace(coalesce(v_name, ''), '^\s*(m\s*/\s*v|mv|m\.v\.)\s+', '', 'i'), v_imo]);
  end if;
  return v;
end $$;
revoke all on function public.get_fixture_room(uuid, integer) from public, anon;
grant execute on function public.get_fixture_room(uuid, integer) to authenticated, service_role;
comment on function public.get_fixture_room(uuid, integer) is
  'Fixture Room read (C2O-013/014, Wave 3): the 202000 read model plus the live mediator suggestions (bridges), with every availability and vessel uuid removed (JSON-safe, recursive, substring and case-insensitive) for a viewer the TBN hull is masked from.';
