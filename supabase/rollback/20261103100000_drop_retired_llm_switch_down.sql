-- DOWN for 20261103100000_drop_retired_llm_switch: recreates the retired switch exactly as 20261029100000 left it
-- in production — the refusing body (byte-identical source, so pg_get_functiondef and the schema fingerprint match)
-- and NO grant (execute revoked from every role, including service_role). It holds no data.
set local lock_timeout = '5s';

create or replace function public.set_active_llm_credential(p_id uuid)
 returns boolean
 language plpgsql
 volatile
 security definer
 set search_path to 'public'
as $function$
begin
  raise exception 'set_active_llm_credential is retired: activate through set_active_llm_credential_if_unchanged after a passing provider test'
    using errcode = '42501';
end;
$function$;
revoke all on function public.set_active_llm_credential(uuid) from public, anon, authenticated, service_role;
