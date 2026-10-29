-- Data Sync LLM keys — a key becomes the classifier key only after a passing provider test of exactly the values
-- that will be used (Codex C2O-178, 28 Oct 2026; owner-reported outage 27 Oct: every classification batch
-- failed 404 "model: claude-sonnet-4-5").
--
--   1. save_llm_credential saves EVERY insert and EVERY edit inactive. An edit of the active key therefore takes
--      it out of service at once: the classifier never runs on untested values, not even for the seconds a
--      provider test takes. p_make_active is kept in the signature for the app build still deployed during the
--      release window and is ignored (activation is no longer part of a save).
--   2. set_active_llm_credential_if_unchanged(p_id, p_expected_updated_at): the only activation path the app
--      uses. It locks the row, compares updated_at (the version token every save advances) with the token the
--      provider test read, and only then switches the single active key in one transaction. A drift returns
--      'changed' and the app asks for a re-test; 'not_found' for an unknown id; 'activated' on success.
--   set_active_llm_credential(uuid) stays for the deployed app build during the window (service-only, as before);
--   the new app never calls it (pinned in scripts/llm-provider-check.ts).
--
-- DOWN: supabase/rollback/20261029100000_llm_credential_conditional_activation_down.sql
set local lock_timeout = '5s';

create or replace function public.save_llm_credential(
  p_id uuid,
  p_label text,
  p_vendor text,
  p_model text,
  p_base_url text,
  p_secret text,            -- null = keep existing secret
  p_make_active boolean default false   -- ignored: activation goes through set_active_llm_credential_if_unchanged
)
 returns uuid
 language plpgsql
 volatile
 security definer
 set search_path to 'public', 'vault'
as $function$
declare
  v_id        uuid := coalesce(p_id, gen_random_uuid());
  v_secret_id uuid;
  v_has_secret boolean := p_secret is not null and length(trim(p_secret)) > 0;
begin
  select secret_id into v_secret_id from public.llm_credential where id = v_id for update;

  if v_has_secret then
    if v_secret_id is null then
      v_secret_id := vault.create_secret(p_secret, 'llm_credential:' || v_id::text, 'ASB Data Sync LLM key');
    else
      perform vault.update_secret(v_secret_id, p_secret);
    end if;
  end if;

  insert into public.llm_credential (id, label, vendor, model, base_url, secret_id, key_hint, is_active, updated_at)
  values (v_id, p_label, p_vendor, p_model, p_base_url, v_secret_id,
          case when v_has_secret then right(p_secret, 4) end, false, clock_timestamp())
  on conflict (id) do update set
    label = excluded.label, vendor = excluded.vendor, model = excluded.model,
    base_url = excluded.base_url,
    secret_id = coalesce(excluded.secret_id, public.llm_credential.secret_id),
    key_hint  = coalesce(excluded.key_hint, public.llm_credential.key_hint),
    is_active = false,
    updated_at = clock_timestamp();

  return v_id;
end;
$function$;

create or replace function public.set_active_llm_credential_if_unchanged(p_id uuid, p_expected_updated_at timestamptz)
 returns text
 language plpgsql
 volatile
 security definer
 set search_path to 'public'
as $function$
declare
  v_updated timestamptz;
begin
  select updated_at into v_updated from public.llm_credential where id = p_id for update;
  if not found then return 'not_found'; end if;
  if p_expected_updated_at is null or v_updated is distinct from p_expected_updated_at then return 'changed'; end if;
  update public.llm_credential set is_active = false where is_active and id <> p_id;
  update public.llm_credential set is_active = true, updated_at = clock_timestamp() where id = p_id;
  return 'activated';
end;
$function$;

revoke all on function public.save_llm_credential(uuid, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.save_llm_credential(uuid, text, text, text, text, text, boolean) to service_role;
revoke all on function public.set_active_llm_credential_if_unchanged(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.set_active_llm_credential_if_unchanged(uuid, timestamptz) to service_role;
