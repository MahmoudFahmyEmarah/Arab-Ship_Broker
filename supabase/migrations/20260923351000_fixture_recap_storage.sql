-- Fixture recap PDFs are private, server-produced artifacts. Members receive
-- only short-lived signed URLs after the application re-checks room access.
-- No authenticated storage.objects policy is created intentionally.

set local lock_timeout = '5s';
set local statement_timeout = '10min';

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('fixture-recaps', 'fixture-recaps', false, 5242880, array['application/pdf'])
    on conflict (id) do update
      set public = false,
          file_size_limit = 5242880,
          allowed_mime_types = array['application/pdf'];
  else
    raise notice 'no storage schema in this database — fixture recap storage is unavailable';
  end if;
end $$;

