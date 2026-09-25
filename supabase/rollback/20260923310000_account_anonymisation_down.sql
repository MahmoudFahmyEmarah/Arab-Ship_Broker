drop function if exists public.fn_anonymize_account(uuid);
alter table public.users drop column if exists erased_at;
