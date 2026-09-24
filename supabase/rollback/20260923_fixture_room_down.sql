-- DOWN for the Fixture Room Phase 1 chain (23 Sep 2026):
--   20260923200000_fixture_room_tables.sql
--   20260923201000_fixture_room_helpers.sql
--   20260923202000_fixture_room_reads.sql
--   20260923203000_fixture_room_commands.sql
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/rollback/20260923_fixture_room_down.sql
--   supabase migration repair --status reverted 20260923200000 20260923201000 20260923202000 20260923203000
--
-- Deploy the application without the Fixture Room routes FIRST: the server
-- actions call these RPCs.
--
-- Negotiation history is DATA. When any room exists the tables are renamed to
-- *_bak_20260923200000 instead of dropped, with their immutability triggers
-- removed so the backups are plain tables; drop them by hand once the rollback
-- is confirmed. With no rooms the tables are dropped outright and the schema
-- returns exactly to the baseline (the migration harness proves that).
set local lock_timeout = '5s';
set local statement_timeout = '10min';

-- ── commands (20260923203000) ───────────────────────────────────────────────
drop function if exists public.redact_fixture_message(uuid, uuid, text, integer, text);
drop function if exists public.close_fixture_room(uuid, text, text, integer, text, uuid, uuid);
drop function if exists public.agree_fixture_disclosure(uuid, integer, text, uuid, uuid);
drop function if exists public.post_fixture_message(uuid, text, text, text, uuid, integer, text, uuid);
drop function if exists public.acknowledge_fixture_recap(uuid, uuid, integer, text, uuid, uuid);
drop function if exists public.publish_fixture_recap(uuid, integer, text, uuid);
drop function if exists public.fix_fixture_on_subjects(uuid, integer, text, uuid);
drop function if exists public.extend_fixture_subject(uuid, uuid, timestamptz, integer, text, uuid);
drop function if exists public.fail_fixture_subject(uuid, uuid, text, integer, text, uuid, uuid);
drop function if exists public.lift_fixture_subject(uuid, uuid, integer, text, uuid, uuid);
drop function if exists public.add_fixture_subject(uuid, text, text, text, timestamptz, integer, text, uuid);
drop function if exists public.set_fixture_term_flag(uuid, uuid, text, text, integer, text, uuid, uuid);
drop function if exists public.reopen_fixture_term(uuid, uuid, text, integer, text, uuid, uuid);
drop function if exists public.accept_fixture_proposal(uuid, uuid, integer, text, uuid, uuid);
drop function if exists public.withdraw_fixture_proposal(uuid, uuid, integer, text, uuid, uuid);
drop function if exists public.submit_fixture_proposal(uuid, uuid, jsonb, text, boolean, integer, integer, text, uuid, uuid);
drop function if exists public.respond_fixture_invitation(uuid, boolean, integer, text);
drop function if exists public.invite_fixture_party(uuid, text, text, uuid, uuid, integer, text, uuid);
drop function if exists public.create_fixture_room(uuid, uuid, jsonb, text, jsonb);
drop function if exists public.fn_fixture_party_payload(public.fixture_parties);
drop function if exists public.fn_fixture_listing_sync_require(uuid, jsonb, text, uuid, uuid, text, text);
drop function if exists public.fn_fixture_invalidate_recap(uuid, uuid, uuid, text, text, text);
drop function if exists public.fn_fixture_rep(public.fixture_parties, uuid, boolean);
drop function if exists public.fn_fixture_terminal(text);

-- ── reads (20260923202000) ──────────────────────────────────────────────────
drop function if exists public.list_fixture_rooms(text[], integer);
drop function if exists public.get_fixture_room(uuid, integer);
drop function if exists public.get_fixture_room_version(uuid);
drop function if exists public.fn_fixture_proposal_json(public.fixture_proposals, text, text, uuid);

-- ── helpers (20260923201000) ────────────────────────────────────────────────
drop function if exists public.fn_fixture_recap_text(jsonb);
drop function if exists public.fn_fixture_recap_build(public.fixture_rooms);
drop function if exists public.fn_fixture_listing_sync(public.fixture_rooms);
drop function if exists public.fn_fixture_capabilities(public.fixture_rooms, public.fixture_parties[], boolean, uuid[]);
drop function if exists public.fn_fixture_event_json(public.fixture_events, jsonb, boolean);
drop function if exists public.fn_fixture_party_json(public.fixture_parties, uuid[], text, boolean, boolean);
drop function if exists public.fn_fixture_party_desk(public.fixture_parties);
drop function if exists public.fn_fixture_party_name(public.fixture_parties);
drop function if exists public.fn_fixture_display_value(text, jsonb, text);
drop function if exists public.fn_fixture_validate_value(text, jsonb);
drop function if exists public.fn_fixture_event(uuid, text, uuid, uuid, uuid, boolean, text, text, text, jsonb, jsonb);
drop function if exists public.fn_fixture_replay(uuid, text, text);
drop function if exists public.fn_fixture_check_version(public.fixture_rooms, integer);
drop function if exists public.fn_fixture_lock(uuid);
drop function if exists public.fn_fixture_represented_party(public.fixture_parties, uuid);
drop function if exists public.fn_fixture_acting_party(uuid, uuid);
drop function if exists public.fn_can_access_fixture(uuid);
drop function if exists public.fn_fixture_actor_parties(uuid);
drop function if exists public.fn_fixture_resolve_counterparty(text, uuid);
drop function if exists public.fn_fixture_snapshot_vessel(uuid);
drop function if exists public.fn_fixture_snapshot_cargo(uuid);
drop function if exists public.fn_fixture_listing_live(text, uuid);
drop function if exists public.fn_fixture_owns_listing(text, uuid);
drop function if exists public.fn_fixture_tier_ok();
drop function if exists public.fn_fixture_active_org(uuid);
drop function if exists public.fn_fixture_user_from_auth(uuid);
drop function if exists public.fn_fixture_actor();

-- ── tables (20260923200000) ─────────────────────────────────────────────────
do $$
declare v_rows bigint := 0; t text; v_tables text[] := array[
  'fixture_access_log', 'fixture_recap_versions', 'fixture_events', 'fixture_messages',
  'fixture_subjects', 'fixture_proposals', 'fixture_terms', 'fixture_parties', 'fixture_rooms'];
begin
  if to_regclass('public.fixture_rooms') is not null then
    execute 'select count(*) from public.fixture_rooms' into v_rows;
  end if;
  foreach t in array v_tables loop
    if to_regclass('public.' || t) is null then continue; end if;
    -- the append-only triggers go first: a backup must be a plain table
    if t in ('fixture_access_log', 'fixture_recap_versions', 'fixture_events', 'fixture_messages', 'fixture_subjects', 'fixture_proposals') then
      execute format('drop trigger if exists %I on public.%I',
                     'trg_' || case t when 'fixture_recap_versions' then 'fixture_recaps' else t end || '_immutable', t);
    end if;
    if v_rows > 0 then
      if to_regclass('public.' || t || '_bak_20260923200000') is not null then
        raise notice 'public.%_bak_20260923200000 already exists — dropping the current table instead of overwriting the backup', t;
        execute format('drop table public.%I cascade', t);
      else
        execute format('alter table public.%I rename to %I', t, t || '_bak_20260923200000');
        raise notice 'kept public.% as public.%_bak_20260923200000', t, t;
      end if;
    else
      execute format('drop table public.%I cascade', t);
    end if;
  end loop;
end $$;

drop function if exists public.fn_fixture_immutable();
drop sequence if exists public.fixture_room_ref_seq;
