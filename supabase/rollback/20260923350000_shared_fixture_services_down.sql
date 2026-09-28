-- DOWN for shared member notifications and the private Fixture PDF bucket.
-- Refuse to destroy stored PDFs silently.

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
drop trigger if exists notifications_snapshot_guard on public.notifications;
drop function if exists public.fn_notification_snapshot_guard();

drop table if exists public.notification_deliveries;
drop table if exists public.notifications;
drop table if exists public.notification_preferences;
