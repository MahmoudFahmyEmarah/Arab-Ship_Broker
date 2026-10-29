-- DOWN for 20261029100000_llm_credential_conditional_activation: restores save_llm_credential exactly as
-- 20260704140000 defined it (edits keep is_active; p_make_active activates) and drops the conditional
-- activation function. Plain SQL, hosted-safe. Data is untouched (is_active values stay as they are).
set local lock_timeout = '5s';

create or replace function public.save_llm_credential(
  p_id uuid,
  p_label text,
  p_vendor text,
  p_model text,
  p_base_url text,
  p_secret text,            -- null = keep existing secret
  p_make_active boolean default false
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
  select secret_id into v_secret_id from public.llm_credential where id = v_id;

  if v_has_secret then
    if v_secret_id is null then
      v_secret_id := vault.create_secret(p_secret, 'llm_credential:' || v_id::text, 'ASB Data Sync LLM key');
    else
      perform vault.update_secret(v_secret_id, p_secret);
    end if;
  end if;

  insert into public.llm_credential (id, label, vendor, model, base_url, secret_id, key_hint, is_active, updated_at)
  values (v_id, p_label, p_vendor, p_model, p_base_url, v_secret_id,
          case when v_has_secret then right(p_secret, 4) end, false, now())
  on conflict (id) do update set
    label = excluded.label, vendor = excluded.vendor, model = excluded.model,
    base_url = excluded.base_url,
    secret_id = coalesce(excluded.secret_id, public.llm_credential.secret_id),
    key_hint  = coalesce(excluded.key_hint, public.llm_credential.key_hint),
    updated_at = now();

  if p_make_active then
    update public.llm_credential set is_active = false where is_active and id <> v_id;
    update public.llm_credential set is_active = true, updated_at = now() where id = v_id;
  end if;

  return v_id;
end;
$function$;

drop function if exists public.set_active_llm_credential_if_unchanged(uuid, timestamptz);

-- the legacy switch exactly as 20260704140000 defined it, with its service-only grant
create or replace function public.set_active_llm_credential(p_id uuid)
 returns boolean
 language plpgsql
 volatile
 security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.llm_credential where id = p_id) then
    raise exception 'credential % not found', p_id using errcode = 'P0002';
  end if;
  update public.llm_credential set is_active = false where is_active and id <> p_id;
  update public.llm_credential set is_active = true, updated_at = now() where id = p_id;
  return true;
end;
$function$;
revoke all on function public.set_active_llm_credential(uuid) from public, anon, authenticated;
grant execute on function public.set_active_llm_credential(uuid) to service_role;

revoke all on function public.save_llm_credential(uuid, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.save_llm_credential(uuid, text, text, text, text, text, boolean) to service_role;
