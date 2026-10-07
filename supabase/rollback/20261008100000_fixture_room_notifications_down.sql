-- DOWN · 20261008100000_fixture_room_notifications.sql — removes the Fixture projector (trigger and its three
-- functions). Notifications already written stay in the shared core (it owns them and their retention).
-- Run in one transaction: psql -v ON_ERROR_STOP=1 -1 -f <this file>
drop trigger if exists trg_fixture_events_notify on public.fixture_events;
drop function if exists public.fn_fixture_notify_project();
drop function if exists public.fn_fixture_notify_recipients(uuid, text[], boolean, uuid);
drop function if exists public.fn_fixture_notify_rule(text, jsonb, text, text, uuid);
