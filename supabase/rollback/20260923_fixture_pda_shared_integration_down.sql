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

-- Restore Fixture Room v1's closed event vocabulary exactly.
alter table public.fixture_events
  drop constraint if exists fixture_events_type_check,
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
