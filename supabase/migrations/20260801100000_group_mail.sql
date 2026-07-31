-- Group Mail module (01 Aug 2026) — owner-only admin section that manages the
-- cPanel/Mailman mailing lists (e.g. circulation@arabshipbroker.com) and sends
-- branded circulars over the account's SMTP.
--
--   groupmail_config    single row of non-secret settings (hosts, ports, from)
--   groupmail_secret    Vault pointers: 'cpanel_token' | 'smtp_password' |
--                       'list:<address>' (Mailman list admin password)
--   groupmail_campaign  every test/broadcast send with per-recipient outcome
--
-- Secrets follow the Data Sync pattern: plaintext goes straight into Supabase
-- Vault; only the secret_id lands in a table; decrypt helper is service_role
-- only, so a key never reaches the browser.
--
-- Rollback: drop the three tables and the three functions (no live-table
-- dependencies elsewhere).

create table if not exists public.groupmail_config (
  id              int primary key default 1 check (id = 1),
  cpanel_host     text,                       -- e.g. server353-4.web-hosting.com
  cpanel_user     text,                       -- cPanel account username
  mailman_base    text,                       -- e.g. https://server353-4.web-hosting.com/mailman
  smtp_host       text,
  smtp_port       int not null default 465,
  smtp_user       text,                       -- full mailbox address (From)
  from_name       text not null default 'Arab ShipBroker',
  test_recipients text[],
  updated_at      timestamptz not null default now()
);

create table if not exists public.groupmail_secret (
  key        text primary key,
  secret_id  uuid not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.groupmail_campaign (
  id               uuid primary key default gen_random_uuid(),
  list_email       text not null,
  mode             text not null check (mode in ('test', 'broadcast')),
  subject          text not null,
  title            text,
  body             text not null,
  links            jsonb,                     -- [{label, url}]
  recipients_total int not null default 0,
  sent_ok          int not null default 0,
  sent_fail        int not null default 0,
  failures         jsonb,                     -- [{email, error}]
  status           text not null default 'sending' check (status in ('sending', 'done', 'failed')),
  sent_by          uuid,
  created_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index if not exists idx_groupmail_campaign_recent on public.groupmail_campaign (created_at desc);

-- ── RLS: admins only; writes go through the service-role actions ────────────
alter table public.groupmail_config   enable row level security;
alter table public.groupmail_secret   enable row level security;
alter table public.groupmail_campaign enable row level security;

drop policy if exists admin_all on public.groupmail_config;
create policy admin_all on public.groupmail_config
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());
drop policy if exists admin_all on public.groupmail_campaign;
create policy admin_all on public.groupmail_campaign
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());
-- secret pointers: no client access at all (not even admins — service role only)

revoke all on public.groupmail_config, public.groupmail_secret, public.groupmail_campaign from anon;
revoke all on public.groupmail_secret from authenticated;
grant select, insert, update, delete on public.groupmail_config, public.groupmail_secret,
  public.groupmail_campaign to service_role;

-- ── Vault helpers ───────────────────────────────────────────────────────────
create or replace function public.groupmail_set_secret(p_key text, p_value text)
 returns void
 language plpgsql
 volatile
 security definer
 set search_path to 'public','vault'
as $$
declare
  v_secret_id uuid;
begin
  if coalesce(trim(p_key), '') = '' then raise exception 'secret key required'; end if;
  if coalesce(p_value, '') = '' then raise exception 'secret value required'; end if;
  select secret_id into v_secret_id from public.groupmail_secret where key = p_key;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_value, 'groupmail:' || p_key, 'ASB Group Mail secret');
    insert into public.groupmail_secret (key, secret_id) values (p_key, v_secret_id);
  else
    perform vault.update_secret(v_secret_id, p_value);
    update public.groupmail_secret set updated_at = now() where key = p_key;
  end if;
end $$;

create or replace function public.groupmail_get_secret(p_key text)
 returns text
 language plpgsql
 stable
 security definer
 set search_path to 'public','vault'
as $$
declare
  v_secret_id uuid;
  v_secret    text;
begin
  select secret_id into v_secret_id from public.groupmail_secret where key = p_key;
  if v_secret_id is null then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where id = v_secret_id;
  return v_secret;
end $$;

create or replace function public.groupmail_delete_secret(p_key text)
 returns void
 language plpgsql
 volatile
 security definer
 set search_path to 'public','vault'
as $$
declare
  v_secret_id uuid;
begin
  select secret_id into v_secret_id from public.groupmail_secret where key = p_key;
  if v_secret_id is null then return; end if;
  delete from vault.secrets where id = v_secret_id;
  delete from public.groupmail_secret where key = p_key;
end $$;

revoke all on function public.groupmail_set_secret(text, text)    from public, anon, authenticated;
revoke all on function public.groupmail_get_secret(text)          from public, anon, authenticated;
revoke all on function public.groupmail_delete_secret(text)       from public, anon, authenticated;
grant execute on function public.groupmail_set_secret(text, text)    to service_role;
grant execute on function public.groupmail_get_secret(text)          to service_role;
grant execute on function public.groupmail_delete_secret(text)       to service_role;
