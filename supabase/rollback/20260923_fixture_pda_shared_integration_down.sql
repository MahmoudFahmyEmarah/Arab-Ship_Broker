-- Roll back 20260923320000_fixture_pda_shared_integration.sql.
-- Run before the Fixture Room and PDA module downs: fixture_pda_links references
-- the Fixture ledger, while its estimate id intentionally has no PDA FK.

revoke all on function public.link_fixture_pda_estimate(uuid, uuid, text, integer, text, uuid) from public, anon, authenticated;
drop function if exists public.link_fixture_pda_estimate(uuid, uuid, text, integer, text, uuid);
revoke all on function public.list_fixture_pda_links(uuid) from public, anon, authenticated;
drop function if exists public.list_fixture_pda_links(uuid);
revoke all on function public.fn_fixture_pda_link_json(public.fixture_pda_links) from public, anon, authenticated;
drop function if exists public.fn_fixture_pda_link_json(public.fixture_pda_links);
revoke all on function public.sync_fixture_listing_status(uuid, integer, text) from public, anon, authenticated;
drop function if exists public.sync_fixture_listing_status(uuid, integer, text);
drop table if exists public.fixture_pda_links;

-- Restore Fixture Room v1's closed event vocabulary exactly. Drop the check
-- by its protected column because a retained backup can cause PostgreSQL to
-- suffix the active table's automatically generated constraint name.
do $fixture_event_type$
declare v_constraint record;
begin
  for v_constraint in
    select c.conname
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attname = 'type'
       and a.attnum = any(c.conkey)
     where c.conrelid = 'public.fixture_events'::regclass
       and c.contype = 'c'
  loop
    execute format('alter table public.fixture_events drop constraint %I', v_constraint.conname);
  end loop;
end
$fixture_event_type$;

alter table public.fixture_events
  add constraint fixture_events_type_check check (type in (
    'room.created','party.invited','party.accepted','party.declined','party.removed',
    'party.disclosure_agreed','room.counterparty_disclosed',
    'proposal.submitted','proposal.withdrawn','proposal.lapsed','proposal.accepted',
    'term.agreed','term.reopened','term.held','term.resumed','term.referred','term.referral_cleared',
    'subject.added','subject.lifted','subject.failed','subject.extended',
    'room.fixed_on_subjects','room.fixed','room.returned_to_negotiation',
    'recap.published','recap.acknowledged','recap.invalidated',
    'message.posted','message.redacted',
    'listing_sync.required','room.closed'
  ));
