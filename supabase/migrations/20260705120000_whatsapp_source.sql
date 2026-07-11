-- WhatsApp as the third Data Sync source.
--  • whatsapp_config   — singleton; provider toggle (meta | unofficial); secrets in Vault
--  • whatsapp_message  — inbound inbox, deduped by wa_message_id, linked to its sync_batch
--  • whatsapp_outbox   — outbound replies; meta sends direct, unofficial worker polls this
--  • whatsapp_runtime  — worker heartbeat + QR pairing payload for the Settings screen
-- Plus: allow 'whatsapp' in sync_batch.source and sync_source_state.source.

alter table public.sync_batch drop constraint if exists sync_batch_source_chk;
alter table public.sync_batch add constraint sync_batch_source_chk
  check (source = any (array['upload'::text, 'email'::text, 'whatsapp'::text]));

alter table public.sync_source_state drop constraint if exists sync_source_state_source_check;
alter table public.sync_source_state add constraint sync_source_state_source_check
  check (source = any (array['email'::text, 'upload'::text, 'whatsapp'::text]));

-- ── config (singleton) ──────────────────────────────────────────────────────
create table if not exists public.whatsapp_config (
  id                uuid primary key default gen_random_uuid(),
  only_one          boolean not null default true unique check (only_one),
  provider          text not null default 'unofficial' check (provider in ('meta','unofficial')),
  phone_number_id   text,             -- Meta: the Cloud API phone-number id
  business_id       text,             -- Meta: WABA id (optional)
  token_secret_id   uuid,             -- Vault: Meta access token
  app_secret_id     uuid,             -- Vault: Meta app secret (webhook signature)
  verify_secret_id  uuid,             -- Vault: webhook verify token
  is_enabled        boolean not null default false,
  auto_reply        boolean not null default true,
  reply_template    text not null default 'Thank you {{name}}! Arab ShipBroker has received your enquiry.

{{summary}}

One of our chartering experts will contact you very soon.
{{url}}',
  platform_url      text not null default 'https://arabshipbroker.com',
  updated_at        timestamptz not null default now()
);

-- ── inbound inbox ───────────────────────────────────────────────────────────
create table if not exists public.whatsapp_message (
  id             uuid primary key default gen_random_uuid(),
  wa_message_id  text not null unique,          -- dedupe across webhook retries / reconnects
  provider       text not null check (provider in ('meta','unofficial')),
  wa_from        text not null,                  -- meta: phone; unofficial: jid
  contact_name   text,
  body           text not null,
  received_at    timestamptz not null default now(),
  status         text not null default 'pending' check (status in ('pending','staged','irrelevant','failed')),
  error          text,
  batch_id       uuid references public.sync_batch(id) on delete set null,
  staged_cargo   int not null default 0,
  staged_vessels int not null default 0,
  ack_status     text not null default 'none' check (ack_status in ('none','queued','sent','failed','skipped')),
  ack_error      text,
  teaser_sent_at timestamptz,
  raw            jsonb
);
create index if not exists idx_wa_msg_status on public.whatsapp_message (status, received_at desc);
create index if not exists idx_wa_msg_recent on public.whatsapp_message (received_at desc);

-- ── outbound queue ──────────────────────────────────────────────────────────
create table if not exists public.whatsapp_outbox (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null check (provider in ('meta','unofficial')),
  to_addr      text not null,
  body         text not null,
  kind         text not null default 'ack' check (kind in ('ack','teaser')),
  message_id   uuid references public.whatsapp_message(id) on delete set null,
  status       text not null default 'queued' check (status in ('queued','sent','failed')),
  error        text,
  attempts     int not null default 0,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);
create index if not exists idx_wa_outbox_queued on public.whatsapp_outbox (status, created_at) where status = 'queued';

-- ── worker runtime (singleton) ──────────────────────────────────────────────
create table if not exists public.whatsapp_runtime (
  only_one     boolean primary key default true check (only_one),
  state        text not null default 'offline',   -- offline | pairing | connected
  qr           text,                               -- ephemeral pairing payload
  linked_as    text,                               -- number/jid once paired
  worker_seen  timestamptz,
  updated_at   timestamptz not null default now()
);
insert into public.whatsapp_runtime (only_one) values (true) on conflict do nothing;

-- ── RLS: admins only; service_role full ─────────────────────────────────────
alter table public.whatsapp_config  enable row level security;
alter table public.whatsapp_message enable row level security;
alter table public.whatsapp_outbox  enable row level security;
alter table public.whatsapp_runtime enable row level security;
do $$ declare t text;
begin
  foreach t in array array['whatsapp_config','whatsapp_message','whatsapp_outbox','whatsapp_runtime'] loop
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format('create policy admin_all on public.%I for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- ── Vault helpers (mirror email config pattern) ─────────────────────────────
create or replace function public.save_whatsapp_config(
  p_provider text, p_phone_number_id text, p_business_id text,
  p_token text, p_app_secret text, p_verify_token text,
  p_enabled boolean, p_auto_reply boolean, p_reply_template text, p_platform_url text
) returns uuid language plpgsql volatile security definer set search_path to 'public','vault'
as $function$
declare v_id uuid; v_tok uuid; v_app uuid; v_ver uuid;
begin
  select id, token_secret_id, app_secret_id, verify_secret_id into v_id, v_tok, v_app, v_ver
  from public.whatsapp_config where only_one;

  if p_token is not null and length(trim(p_token)) > 0 then
    if v_tok is null then v_tok := vault.create_secret(p_token, 'whatsapp:token:' || gen_random_uuid()::text, 'WA access token');
    else perform vault.update_secret(v_tok, p_token); end if;
  end if;
  if p_app_secret is not null and length(trim(p_app_secret)) > 0 then
    if v_app is null then v_app := vault.create_secret(p_app_secret, 'whatsapp:appsecret:' || gen_random_uuid()::text, 'WA app secret');
    else perform vault.update_secret(v_app, p_app_secret); end if;
  end if;
  if p_verify_token is not null and length(trim(p_verify_token)) > 0 then
    if v_ver is null then v_ver := vault.create_secret(p_verify_token, 'whatsapp:verify:' || gen_random_uuid()::text, 'WA verify token');
    else perform vault.update_secret(v_ver, p_verify_token); end if;
  end if;

  insert into public.whatsapp_config
    (id, only_one, provider, phone_number_id, business_id, token_secret_id, app_secret_id, verify_secret_id,
     is_enabled, auto_reply, reply_template, platform_url, updated_at)
  values
    (coalesce(v_id, gen_random_uuid()), true, p_provider, p_phone_number_id, p_business_id, v_tok, v_app, v_ver,
     coalesce(p_enabled,false), coalesce(p_auto_reply,true),
     coalesce(nullif(trim(p_reply_template),''), (select reply_template from public.whatsapp_config where only_one),
       'Thank you {{name}}! Arab ShipBroker has received your enquiry.' || chr(10) || chr(10) || '{{summary}}' || chr(10) || chr(10) || 'One of our chartering experts will contact you very soon.' || chr(10) || '{{url}}'),
     coalesce(nullif(trim(p_platform_url),''), 'https://arabshipbroker.com'), now())
  on conflict (only_one) do update set
    provider = excluded.provider, phone_number_id = excluded.phone_number_id, business_id = excluded.business_id,
    token_secret_id  = coalesce(excluded.token_secret_id,  public.whatsapp_config.token_secret_id),
    app_secret_id    = coalesce(excluded.app_secret_id,    public.whatsapp_config.app_secret_id),
    verify_secret_id = coalesce(excluded.verify_secret_id, public.whatsapp_config.verify_secret_id),
    is_enabled = excluded.is_enabled, auto_reply = excluded.auto_reply,
    reply_template = excluded.reply_template, platform_url = excluded.platform_url, updated_at = now()
  returning id into v_id;
  return v_id;
end $function$;

create or replace function public.get_whatsapp_secret(p_kind text)
returns text language plpgsql stable security definer set search_path to 'public','vault'
as $function$
declare v_sid uuid; v_val text;
begin
  select case p_kind when 'token' then token_secret_id when 'app_secret' then app_secret_id
                     when 'verify' then verify_secret_id end
    into v_sid from public.whatsapp_config where only_one;
  if v_sid is null then return null; end if;
  select decrypted_secret into v_val from vault.decrypted_secrets where id = v_sid;
  return v_val;
end $function$;

revoke all on function public.save_whatsapp_config(text,text,text,text,text,text,boolean,boolean,text,text) from public, anon, authenticated;
revoke all on function public.get_whatsapp_secret(text) from public, anon, authenticated;
grant execute on function public.save_whatsapp_config(text,text,text,text,text,text,boolean,boolean,text,text) to service_role;
grant execute on function public.get_whatsapp_secret(text) to service_role;
