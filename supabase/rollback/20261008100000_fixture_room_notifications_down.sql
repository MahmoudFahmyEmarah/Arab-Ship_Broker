-- DOWN · 20261008100000_fixture_room_notifications.sql — removes the Fixture projector. Notifications already
-- written stay in the shared core (it owns them). The projection ledger is dropped only when it holds no
-- unprojected work: with pending or failed events this DOWN refuses (reconcile first, or roll forward).
-- Run in one transaction: psql -v ON_ERROR_STOP=1 -1 -f <this file>
do $$
declare v_open bigint;
begin
  if to_regclass('public.fixture_notification_projections') is not null then
    select count(*) into v_open from public.fixture_notification_projections where status <> 'done';
    if v_open > 0 then
      raise exception 'NTF_DOWN_REFUSED: % Fixture event(s) still wait for their notifications; run fn_fixture_notify_reconcile first', v_open
        using errcode = '55000';
    end if;
  end if;
end $$;
drop trigger if exists trg_fixture_events_notify on public.fixture_events;
drop function if exists public.fn_fixture_notify_health();
drop function if exists public.fn_fixture_notify_reconcile(integer);
drop function if exists public.fn_fixture_notify_project();
drop function if exists public.fn_fixture_notify_event(bigint);
drop table if exists public.fixture_notification_projections;
drop function if exists public.fn_fixture_notify_recipients(uuid, text[], boolean, uuid);
drop function if exists public.fn_fixture_notify_rule(text, jsonb, text, text, uuid);
drop function if exists public.fn_fixture_notify_outbound_value(jsonb);
