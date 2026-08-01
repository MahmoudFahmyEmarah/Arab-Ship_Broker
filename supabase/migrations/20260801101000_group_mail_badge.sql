-- The composed header badge is part of the campaign — persist it so the sent
-- mail always matches the preview (was rebuilt with a hardcoded default).
alter table public.groupmail_campaign
  add column if not exists badge text not null default 'Circulation';
