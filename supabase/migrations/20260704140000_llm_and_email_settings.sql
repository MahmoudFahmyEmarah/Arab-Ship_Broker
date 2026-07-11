-- Phase 5 — Encrypted settings: multi-key LLM manager + circulation email config
--
-- Builds on the Phase 1 Vault primitives (llm_credential + save_llm_credential /
-- get_llm_secret). Adds:
--   • llm_credential.key_hint — last 4 chars, so the manager can show "…a1b2"
--     without ever decrypting the secret.
--   • set_active_llm_credential / delete_llm_credential — switch the single active
--     key and remove a key (its Vault ciphertext included).
--   • email_ingest_config (singleton) + save_email_config / get_email_password —
--     the circulation inbox connection, password held in Vault, never returned to
--     the browser.
-- All secret-touching helpers are SECURITY DEFINER and service_role-only.

-- ── llm_credential: masked hint + updated save ──────────────────────────────
alter table public.llm_credential add column if not exists key_hint text;

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

-- ── switch the single active credential ─────────────────────────────────────
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

-- ── delete a credential and its Vault ciphertext ────────────────────────────
create or replace function public.delete_llm_credential(p_id uuid)
 returns boolean
 language plpgsql
 volatile
 security definer
 set search_path to 'public', 'vault'
as $function$
declare v_secret_id uuid;
begin
  select secret_id into v_secret_id from public.llm_credential where id = p_id;
  delete from public.llm_credential where id = p_id;
  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
  return true;
end;
$function$;

-- ── circulation email connection (singleton, password in Vault) ─────────────
create table if not exists public.email_ingest_config (
  id            uuid primary key default gen_random_uuid(),
  only_one      boolean not null default true unique check (only_one),
  provider      text not null default 'gmail',
  imap_host     text,
  imap_port     integer not null default 993,
  username      text,
  folder        text not null default 'INBOX',
  search_query  text,                       -- e.g. 'label:circulation newer_than:7d'
  secret_id     uuid,                        -- vault: app password / token
  password_hint text,
  is_enabled    boolean not null default false,
  updated_at    timestamptz not null default now()
);

alter table public.email_ingest_config enable row level security;
drop policy if exists admin_all on public.email_ingest_config;
create policy admin_all on public.email_ingest_config
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());
revoke all on public.email_ingest_config from anon;
grant select, insert, update, delete on public.email_ingest_config to service_role;

create or replace function public.save_email_config(
  p_provider text, p_host text, p_port integer, p_username text,
  p_folder text, p_query text, p_password text, p_enabled boolean
)
 returns uuid
 language plpgsql
 volatile
 security definer
 set search_path to 'public', 'vault'
as $function$
declare
  v_id uuid; v_secret_id uuid; v_has_pw boolean := p_password is not null and length(trim(p_password)) > 0;
begin
  select id, secret_id into v_id, v_secret_id from public.email_ingest_config where only_one;

  if v_has_pw then
    if v_secret_id is null then
      v_secret_id := vault.create_secret(p_password, 'email_ingest:' || coalesce(v_id::text, 'new'), 'ASB circulation inbox password');
    else
      perform vault.update_secret(v_secret_id, p_password);
    end if;
  end if;

  insert into public.email_ingest_config
    (id, only_one, provider, imap_host, imap_port, username, folder, search_query, secret_id, password_hint, is_enabled, updated_at)
  values
    (coalesce(v_id, gen_random_uuid()), true, p_provider, p_host, coalesce(p_port, 993), p_username, coalesce(p_folder, 'INBOX'),
     p_query, v_secret_id, case when v_has_pw then right(p_password, 4) end, coalesce(p_enabled, false), now())
  on conflict (only_one) do update set
    provider = excluded.provider, imap_host = excluded.imap_host, imap_port = excluded.imap_port,
    username = excluded.username, folder = excluded.folder, search_query = excluded.search_query,
    secret_id = coalesce(excluded.secret_id, public.email_ingest_config.secret_id),
    password_hint = coalesce(excluded.password_hint, public.email_ingest_config.password_hint),
    is_enabled = excluded.is_enabled, updated_at = now()
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.get_email_password()
 returns text
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'vault'
as $function$
declare v_secret_id uuid; v_secret text;
begin
  select secret_id into v_secret_id from public.email_ingest_config where only_one;
  if v_secret_id is null then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where id = v_secret_id;
  return v_secret;
end;
$function$;

-- ── grants: service_role only ───────────────────────────────────────────────
revoke all on function public.set_active_llm_credential(uuid)               from public, anon, authenticated;
revoke all on function public.delete_llm_credential(uuid)                    from public, anon, authenticated;
revoke all on function public.save_email_config(text, text, integer, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.get_email_password()                          from public, anon, authenticated;
grant execute on function public.set_active_llm_credential(uuid)            to service_role;
grant execute on function public.delete_llm_credential(uuid)                to service_role;
grant execute on function public.save_email_config(text, text, integer, text, text, text, text, boolean) to service_role;
grant execute on function public.get_email_password()                       to service_role;
