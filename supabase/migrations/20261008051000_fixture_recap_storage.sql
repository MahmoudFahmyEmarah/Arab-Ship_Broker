-- Fixture recap PDFs are private, server-produced artifacts. Members receive
-- only short-lived signed URLs after the application re-checks room access.
-- No authenticated storage.objects policy is created intentionally.

set local lock_timeout = '5s';
set local statement_timeout = '10min';

do $$
begin
  if to_regclass('storage.buckets') is not null then
    if exists (select 1 from storage.buckets where id = 'fixture-recaps') then
      raise exception 'shared services migration refused: fixture-recaps already exists and is not owned by this migration';
    end if;
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('fixture-recaps', 'fixture-recaps', false, 5242880, array['application/pdf']);
  else
    raise exception 'shared services migration refused: storage.buckets is unavailable; fixture-recaps ownership cannot be established';
  end if;
end $$;
