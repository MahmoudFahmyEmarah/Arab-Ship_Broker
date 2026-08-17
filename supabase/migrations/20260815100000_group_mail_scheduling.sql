-- Group Mail — signature office + scheduled sending (15 Aug 2026).
--
--   stamp_office   which office signs the circular ("Cairo" | "Dubai") — the
--                  header date line renders in that office's timezone.
--   scheduled_at   when a scheduled circular becomes due (UTC).
--   schedule_tz    the office/timezone label the admin picked (display only).
--   recipients     snapshot resolved at first dispatch tick, so a send that
--                  spans several ticks works through one stable list.
--   status         gains 'scheduled' (waiting) and 'canceled'.
--
-- The dispatcher itself is a Next.js route (/api/group-mail/dispatch) invoked
-- by pg_cron via pg_net (see 20260815101000) and protected by a Vault token.
--
-- Rollback: restore the old status check; drop the four columns.

alter table public.groupmail_campaign
  add column if not exists stamp_office text not null default 'Cairo',
  add column if not exists scheduled_at timestamptz,
  add column if not exists schedule_tz  text,
  add column if not exists recipients   jsonb;

alter table public.groupmail_campaign drop constraint if exists groupmail_campaign_status_check;
alter table public.groupmail_campaign
  add constraint groupmail_campaign_status_check
  check (status in ('scheduled', 'sending', 'done', 'failed', 'canceled'));

create index if not exists idx_groupmail_campaign_due
  on public.groupmail_campaign (scheduled_at)
  where status in ('scheduled', 'sending') and scheduled_at is not null;
