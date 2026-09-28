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
drop function if exists public.respond_fixture_invitation(uuid, boolean, integer, text, uuid);
drop function if exists public.respond_fixture_invitation(uuid, boolean, integer, text);
drop function if exists public.invite_fixture_party(uuid, text, text, uuid, uuid, integer, text, uuid);
drop function if exists public.create_fixture_room(uuid, uuid, jsonb, text, jsonb);
drop function if exists public.fn_fixture_party_payload(public.fixture_parties);
drop function if exists public.fn_fixture_listing_sync_require(uuid, jsonb, text, uuid, uuid, text, text);
drop function if exists public.fn_fixture_invalidate_recap(uuid, uuid, uuid, text, text, text);
drop function if exists public.fn_fixture_rep(public.fixture_parties, uuid, boolean);
drop function if exists public.fn_fixture_terminal(text);

-- ── reads (20260923202000) ──────────────────────────────────────────────────
drop function if exists public.sweep_fixture_proposal_lapses(integer);
drop function if exists public.list_fixture_match_candidates(text, uuid);
drop trigger if exists trg_fixture_events_notify on public.fixture_events;
drop function if exists public.fn_fixture_notify_project();
drop function if exists public.fn_fixture_notify_recipients(uuid, text[], boolean, uuid);
drop function if exists public.admin_fixture_access_log(uuid, integer);
drop function if exists public.list_fixture_rooms(text[], integer);
drop function if exists public.get_fixture_room(uuid, integer);
drop function if exists public.get_fixture_room_version(uuid);
drop function if exists public.fn_fixture_proposal_json(public.fixture_proposals, text, text, uuid);

-- ── helpers (20260923201000) ────────────────────────────────────────────────
drop function if exists public.fn_fixture_recap_text(jsonb);
drop function if exists public.fn_fixture_recap_build(public.fixture_rooms);
drop function if exists public.fn_fixture_listing_sync(public.fixture_rooms, boolean);
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
drop function if exists public.fn_fixture_term_catalogue(text);
drop function if exists public.fn_fixture_listing_live(text, uuid);
drop function if exists public.fn_fixture_owns_listing(text, uuid);
drop function if exists public.fn_fixture_listing_owner(text, uuid);
drop function if exists public.fn_fixture_tier_ok();
drop function if exists public.fn_fixture_member_org_ids(uuid);
drop function if exists public.fn_fixture_active_org(uuid);
drop function if exists public.fn_fixture_user_from_auth(uuid);
drop function if exists public.fn_fixture_actor();

-- ── tables (20260923200000) ─────────────────────────────────────────────────
do $$
declare v_rows bigint := 0; t text; b text; r record; v_tables text[] := array[
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
        b := t || '_bak_20260923200000';
        execute format('alter table public.%I rename to %I', t, b);
        -- Renaming a table keeps its index, constraint and identity-sequence
        -- names, and a later re-apply says `create … if not exists` for every
        -- index: it would be skipped silently and the module would come back
        -- without its unique indexes (found 25 Sep 2026 on the local stack).
        -- Free every name the forward migration will ask for again. The
        -- suffix is 19 characters, so the base is cut to 44 to stay within
        -- PostgreSQL's 63-character identifier limit (a truncated name would
        -- otherwise lose the suffix and collide on the next rename).
        for r in
          select conname from pg_constraint
          where conrelid = ('public.' || b)::regclass and contype in ('p', 'u', 'x')
        loop
          execute format('alter table public.%I rename constraint %I to %I', b, r.conname, left(r.conname, 44) || '_bak_20260923200000');
        end loop;
        for r in
          select indexname from pg_indexes
          where schemaname = 'public' and tablename = b and indexname not like '%\_bak\_20260923200000'
        loop
          execute format('alter index public.%I rename to %I', r.indexname, left(r.indexname, 44) || '_bak_20260923200000');
        end loop;
        for r in
          select s.relname from pg_class s
          join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass and d.deptype in ('a', 'i')
          where s.relkind = 'S' and d.refobjid = ('public.' || b)::regclass
        loop
          execute format('alter sequence public.%I rename to %I', r.relname, left(r.relname, 44) || '_bak_20260923200000');
        end loop;
        raise notice 'kept public.% as public.% (indexes, constraints and sequences renamed alike)', t, b;
      end if;
    else
      execute format('drop table public.%I cascade', t);
    end if;
  end loop;
end $$;

drop function if exists public.fn_fixture_immutable();
drop sequence if exists public.fixture_room_ref_seq;
