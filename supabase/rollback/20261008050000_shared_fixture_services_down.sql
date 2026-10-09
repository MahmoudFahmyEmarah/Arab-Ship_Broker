-- DOWN for shared member notifications and the private Fixture PDF bucket.
-- Refuse to destroy stored PDFs silently, and refuse to destroy notification history silently (C2O-092 #8):
-- with any notification, delivery or preference row this DOWN stops, unless the session confirms the history was
-- exported first:  set local asb.notifications_down = 'history-exported:<where the export is>';
-- Run in one transaction: psql -v ON_ERROR_STOP=1 -1 -f <this file>

do $$
declare v_n bigint; v_d bigint; v_p bigint; v_ref text := coalesce(current_setting('asb.notifications_down', true), '');
begin
  -- applied or not: with no core tables there is no history to protect (a DOWN chain may meet either state)
  if to_regclass('public.notifications') is null then return; end if;
  execute 'select count(*) from public.notifications' into v_n;
  execute 'select count(*) from public.notification_deliveries' into v_d;
  execute 'select count(*) from public.notification_preferences' into v_p;
  if v_n + v_d + v_p > 0 and v_ref !~ '^history-exported:.{3,200}$' then
    raise exception 'NTF_DOWN_REFUSED: % notification(s), % delivery row(s) and % preference(s) would be destroyed; export them, then set asb.notifications_down = ''history-exported:<ref>'' in this transaction', v_n, v_d, v_p
      using errcode = '55000';
  end if;
  if v_n + v_d + v_p > 0 then
    raise notice 'shared notifications DOWN: destroying % notification(s), % delivery row(s), % preference(s) — export confirmed: %', v_n, v_d, v_p, v_ref;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    if exists (select 1 from storage.objects where bucket_id = 'fixture-recaps') then
      raise exception 'shared services DOWN refused: fixture-recaps still contains objects';
    end if;
  end if;
  if to_regclass('storage.buckets') is not null then
    delete from storage.buckets where id = 'fixture-recaps';
  end if;
end $$;

drop function if exists public.fn_notification_delivery_settle(uuid, uuid, boolean, text, integer);
drop function if exists public.fn_notification_delivery_claim(integer, integer, integer);
drop function if exists public.fn_notification_enqueue(uuid, text, text, text, text, text, text, jsonb, boolean, timestamptz, timestamptz);
drop function if exists public.set_notification_preferences(boolean, text, integer);
drop function if exists public.notification_badge();
drop function if exists public.mark_all_my_notifications_read();
drop function if exists public.mark_notifications_read(uuid[]);
drop function if exists public.list_my_notifications(integer, timestamptz);
drop function if exists public.fn_notification_actor();
do $$ begin if to_regclass('public.notifications') is not null then drop trigger if exists notifications_snapshot_guard on public.notifications; end if; end $$;
drop function if exists public.fn_notification_snapshot_guard();

drop table if exists public.notification_deliveries;
drop table if exists public.notifications;
drop table if exists public.notification_preferences;
