-- ════════════════════════════════════════════════════════════════════════
-- Contacts registry — the GDPR record behind every broker / sender the
-- platform stores (owner decision, 9 Sep 2026: "a separate record for each
-- company / person that can be erased on request").
--
--   · contacts          one row per person or company desk seen in a workbook
--                       BROKER cell, a circular sender, a WhatsApp sender or a
--                       Manual Review entry; linked to organizations.
--   · binding triggers  every write of cargo_listings.broker / source_contact,
--                       vessel_availability.source_contact and
--                       vessel_review_queue.source_email creates or updates the
--                       contact and stores its id next to the text — no write
--                       path can store a person without a registry record.
--   · gdpr_erase_contact  anonymises the record and scrubs every copy (listing
--                       text, review queue, staged rows, edit-audit images,
--                       company desk fields), audited in contact_erasures.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.contacts (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'person' check (kind in ('person','desk')),
  display_name  text not null,
  email         text,
  phone         text,
  org_id        uuid references public.organizations(id) on delete set null,
  role          text,                       -- broker · sender · owner · manager
  source        text not null default 'admin',   -- workbook · email · whatsapp · member · admin · review
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  lawful_basis  text not null default 'legitimate_interest',
  notes         text,
  erased_at     timestamptz,
  erased_by     uuid,
  erase_reason  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists contacts_email_live_uq on public.contacts (lower(email)) where email is not null and erased_at is null;
create index if not exists contacts_name_org_idx on public.contacts (lower(display_name), org_id);
create index if not exists contacts_org_idx on public.contacts (org_id);

create table if not exists public.contact_erasures (
  id          bigint generated always as identity primary key,
  contact_id  uuid not null,
  actor       uuid,
  actor_name  text,
  reason      text,
  affected    jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);

alter table public.cargo_listings
  add column if not exists broker_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists source_contact_id uuid references public.contacts(id) on delete set null;
alter table public.vessel_availability
  add column if not exists source_contact_id uuid references public.contacts(id) on delete set null;
alter table public.vessel_review_queue
  add column if not exists source_contact_id uuid references public.contacts(id) on delete set null;
create index if not exists cl_broker_contact_idx on public.cargo_listings (broker_contact_id);
create index if not exists cl_source_contact_idx on public.cargo_listings (source_contact_id);
create index if not exists va_source_contact_idx on public.vessel_availability (source_contact_id);

alter table public.contacts enable row level security;
alter table public.contact_erasures enable row level security;
drop policy if exists contacts_admin_read on public.contacts;
create policy contacts_admin_read on public.contacts for select to authenticated using (public.fn_is_admin());
drop policy if exists contact_erasures_admin_read on public.contact_erasures;
create policy contact_erasures_admin_read on public.contact_erasures for select to authenticated using (public.fn_is_admin());
grant select on public.contacts, public.contact_erasures to authenticated;
grant all on public.contacts, public.contact_erasures to service_role;

-- ── parse a workbook BROKER cell: "Niavigrains (Tasos) 2.5% here" ─────────
--   company = text before the first "(" (trailing rate / notes stripped)
--   person  = the first parenthetical that is a name, not a rate
--   email   = any address in the text
create or replace function public.fn_contact_parse_broker(p text)
returns table (company text, person text, email text)
language plpgsql immutable as $$
declare s text; head text; paren text; m text[];
begin
  s := regexp_replace(coalesce(p, ''), '\s+', ' ', 'g');
  s := btrim(s);
  if s = '' or s ~* '^(anonymous|anon\.?|-+|n/?a|unknown|tbn)$' then return; end if;
  email := (regexp_match(s, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1];
  -- the address is captured; take it (and its brackets) out of the name text
  s := btrim(regexp_replace(regexp_replace(s, '<?[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}>?', '', 'g'), '\s+', ' ', 'g'));
  head := btrim(split_part(s, '(', 1));
  head := btrim(regexp_replace(head, '(\d+(\.\d+)?\s*%.*|—.*|←.*|<-.*| - .*)$', ''));
  head := btrim(regexp_replace(head, '\s+(here|past us|direct|dnr|first hand|1st hand)\s*$', '', 'i'));
  paren := null;
  for m in select regexp_matches(s, '\(([^)]*)\)', 'g') loop
    if m[1] !~ '[0-9%@]' and btrim(m[1]) <> '' then paren := btrim(m[1]); exit; end if;
  end loop;
  if paren is not null then
    company := nullif(head, ''); person := paren;
  elsif head ~* '\m(shipping|chartering|maritime|marine|logistics|brokers?|trading|ltd|llc|inc|s\.?a\.?|co\.?|gmbh|bv|srl|as|plc|group|denizcilik|agency|agencies)\M' then
    company := head; person := null;
  elsif head ~* '^(capt\.?|captain|mr\.?|mrs\.?|ms\.?)\s' or (array_length(regexp_split_to_array(head, '\s+'), 1) between 2 and 4 and head !~ '[0-9]') then
    company := null; person := head;
  else
    company := nullif(head, ''); person := null;
  end if;
  return next;
end $$;

-- ── find-or-create a contact; returns null for anonymous / empty ─────────
create or replace function public.fn_upsert_contact(
  p_name text, p_email text default null, p_phone text default null, p_company text default null,
  p_role text default null, p_source text default 'admin'
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_org uuid; v_name text; v_email text; v_kind text;
begin
  v_name := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_email := nullif(lower(btrim(coalesce(p_email, ''))), '');
  if v_name is not null and v_name ~* '^(anonymous|anon\.?|-+|n/?a|unknown|tbn|erased contact)$' then v_name := null; end if;
  if v_email is not null and v_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then v_email := null; end if;
  if nullif(btrim(coalesce(p_company, '')), '') is not null then
    v_org := public.fn_link_organization(p_company, coalesce(p_role, 'broker'));
    update public.organizations set org_type = 'broker' where id = v_org and org_type = 'manager' and source_tag = 'data-sync:broker';
  end if;
  if v_name is null and v_email is null then
    if v_org is null then return null; end if;
    -- company only: the company desk is the record
    v_name := btrim(p_company); v_kind := 'desk';
  else
    v_kind := 'person';
    if v_name is null then v_name := v_email; end if;   -- address-only sender: the mailbox is the record
  end if;

  if v_email is not null then
    select id into v_id from public.contacts where lower(email) = v_email and erased_at is null limit 1;
  end if;
  if v_id is null then
    select id into v_id from public.contacts
    where lower(display_name) = lower(v_name) and org_id is not distinct from v_org and erased_at is null
    order by last_seen desc limit 1;
  end if;
  if v_id is null then
    insert into public.contacts (kind, display_name, email, phone, org_id, role, source)
    values (v_kind, v_name, v_email, nullif(btrim(coalesce(p_phone, '')), ''), v_org, p_role, coalesce(p_source, 'admin'))
    returning id into v_id;
  else
    update public.contacts set
      last_seen = now(), updated_at = now(),
      email = coalesce(email, v_email), phone = coalesce(phone, nullif(btrim(coalesce(p_phone, '')), '')),
      org_id = coalesce(org_id, v_org), role = coalesce(role, p_role)
    where id = v_id;
  end if;
  return v_id;
end $$;

-- ── binding triggers ─────────────────────────────────────────────────────
create or replace function public.fn_cl_bind_contacts() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare b record; v_src text;
begin
  v_src := case when new.ref ~ '^EM-' then 'email' when new.ref ~ '^WA-' then 'whatsapp' when new.ref ~ '^ADM-' then 'admin' else 'workbook' end;
  if new.broker is distinct from (case when tg_op = 'UPDATE' then old.broker else null end) or (new.broker is not null and new.broker_contact_id is null) then
    if new.broker is null then new.broker_contact_id := null;
    else
      select * into b from public.fn_contact_parse_broker(new.broker);
      new.broker_contact_id := public.fn_upsert_contact(b.person, b.email, null, b.company, 'broker', v_src);
    end if;
  end if;
  if new.source_contact is distinct from (case when tg_op = 'UPDATE' then old.source_contact else null end)
     or new.source_company is distinct from (case when tg_op = 'UPDATE' then old.source_company else null end)
     or ((new.source_contact is not null or new.source_company is not null) and new.source_contact_id is null) then
    if new.source_contact is null and new.source_company is null then new.source_contact_id := null;
    else
      new.source_contact_id := public.fn_upsert_contact(
        case when new.source_contact ~ '@' then null else new.source_contact end,
        (regexp_match(coalesce(new.source_contact, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1],
        null, new.source_company, 'sender', v_src);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_cl_bind_contacts on public.cargo_listings;
create trigger trg_cl_bind_contacts before insert or update of broker, source_contact, source_company on public.cargo_listings
  for each row execute function public.fn_cl_bind_contacts();

create or replace function public.fn_va_bind_contacts() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.source_contact is distinct from (case when tg_op = 'UPDATE' then old.source_contact else null end)
     or new.source_company is distinct from (case when tg_op = 'UPDATE' then old.source_company else null end)
     or ((new.source_contact is not null or new.source_company is not null) and new.source_contact_id is null) then
    if new.source_contact is null and new.source_company is null then new.source_contact_id := null;
    else
      new.source_contact_id := public.fn_upsert_contact(
        case when new.source_contact ~ '@' then null else new.source_contact end,
        (regexp_match(coalesce(new.source_contact, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1],
        null, new.source_company, 'sender', 'review');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_va_bind_contacts on public.vessel_availability;
create trigger trg_va_bind_contacts before insert or update of source_contact, source_company on public.vessel_availability
  for each row execute function public.fn_va_bind_contacts();

-- circular vessels: the sender lives in source_email {from, name}
create or replace function public.fn_vrq_bind_contacts() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_from text; v_email text; v_name text;
begin
  if new.source_email is null then return new; end if;
  if tg_op = 'UPDATE' and new.source_email is not distinct from old.source_email and new.source_contact_id is not null then return new; end if;
  v_from := coalesce(new.source_email->>'from', '');
  v_email := (regexp_match(v_from, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1];
  v_name := nullif(trim(both '" ' from regexp_replace(v_from, '<[^>]*>', '')), '');
  if v_name is null then v_name := nullif(new.source_email->>'name', ''); end if;
  if v_name is null and v_email is null then return new; end if;
  new.source_contact_id := public.fn_upsert_contact(v_name, v_email, null, null, 'sender', coalesce(new.source, 'email'));
  return new;
end $$;
drop trigger if exists trg_vrq_bind_contacts on public.vessel_review_queue;
create trigger trg_vrq_bind_contacts before insert or update of source_email on public.vessel_review_queue
  for each row execute function public.fn_vrq_bind_contacts();

-- ── backfill: bind what is already stored (fires the triggers) ───────────
update public.cargo_listings set broker = broker where broker is not null and broker_contact_id is null;
update public.cargo_listings set source_contact = source_contact where (source_contact is not null or source_company is not null) and source_contact_id is null;
update public.vessel_availability set source_contact = source_contact where (source_contact is not null or source_company is not null) and source_contact_id is null;
update public.vessel_review_queue set source_email = source_email where source_email is not null and source_contact_id is null;

-- ── erasure: anonymise the record and scrub every copy ───────────────────
create or replace function public.gdpr_erase_contact(p_contact_id uuid, p_actor uuid default null, p_actor_name text default null, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare c public.contacts; v_company text; n int; v_aff jsonb := '{}'::jsonb; v_name text; v_email text;
begin
  select * into c from public.contacts where id = p_contact_id for update;
  if c.id is null then raise exception 'contact not found' using errcode = 'P0002'; end if;
  if c.erased_at is not null then raise exception 'contact already erased' using errcode = '22023'; end if;
  v_name := c.display_name; v_email := c.email;
  select o.name into v_company from public.organizations o where o.id = c.org_id;

  -- listings: the broker text becomes the company (or "Erased contact"), the sender text is cleared
  update public.cargo_listings set broker = coalesce(v_company, 'Erased contact') where broker_contact_id = c.id;
  get diagnostics n = row_count; v_aff := v_aff || jsonb_build_object('cargo_broker', n);
  update public.cargo_listings set source_contact = null, source_company = case when c.kind = 'desk' then null else source_company end where source_contact_id = c.id;
  get diagnostics n = row_count; v_aff := v_aff || jsonb_build_object('cargo_source', n);
  update public.vessel_availability set source_contact = null, source_company = case when c.kind = 'desk' then null else source_company end where source_contact_id = c.id;
  get diagnostics n = row_count; v_aff := v_aff || jsonb_build_object('positions', n);

  -- review queue: sender fields and any mention in the circular text / placeholder name
  update public.vessel_review_queue set
    source_email = (source_email - 'from' - 'name' - 'text') || jsonb_build_object('from', '[erased]',
                    'text', case when source_email ? 'text' then replace(replace(source_email->>'text', coalesce(v_email, '§§'), '[erased]'), case when length(v_name) >= 5 then v_name else '§§' end, '[erased]') end),
    vessel_name = replace(replace(vessel_name, coalesce(v_email, '§§'), '[erased]'), case when length(v_name) >= 5 then v_name else '§§' end, '[erased]')
  where source_contact_id = c.id;
  get diagnostics n = row_count; v_aff := v_aff || jsonb_build_object('review_queue', n);

  -- staged rows and edit-audit images keep copies of the text
  if length(v_name) >= 5 or v_email is not null then
    update public.sync_staged_row set
      payload = replace(replace(payload::text, coalesce(v_email, '§§'), '[erased]'), case when length(v_name) >= 5 then v_name else '§§' end, '[erased]')::jsonb,
      raw     = replace(replace(raw::text,     coalesce(v_email, '§§'), '[erased]'), case when length(v_name) >= 5 then v_name else '§§' end, '[erased]')::jsonb
    where (v_email is not null and (payload::text ilike '%' || v_email || '%' or raw::text ilike '%' || v_email || '%'))
       or (length(v_name) >= 5 and (payload::text ilike '%' || v_name || '%' or raw::text ilike '%' || v_name || '%'));
    get diagnostics n = row_count; v_aff := v_aff || jsonb_build_object('staged_rows', n);
    update public.record_edit_audit set
      before = replace(replace(before::text, coalesce(v_email, '§§'), '[erased]'), case when length(v_name) >= 5 then v_name else '§§' end, '[erased]')::jsonb,
      after  = case when after is null then null else replace(replace(after::text, coalesce(v_email, '§§'), '[erased]'), case when length(v_name) >= 5 then v_name else '§§' end, '[erased]')::jsonb end
    where table_name in ('cargo_listings','vessel_availability')
      and ((v_email is not null and (before::text ilike '%' || v_email || '%' or after::text ilike '%' || v_email || '%'))
        or (length(v_name) >= 5 and (before::text ilike '%' || v_name || '%' or after::text ilike '%' || v_name || '%')));
    get diagnostics n = row_count; v_aff := v_aff || jsonb_build_object('audit_images', n);
  end if;

  -- company desk fields that carry the same person
  update public.organizations set
    desk_contact_name = case when lower(desk_contact_name) = lower(v_name) then null else desk_contact_name end,
    desk_email = case when v_email is not null and lower(desk_email) = v_email then null else desk_email end,
    desk_phone = case when c.phone is not null and desk_phone = c.phone then null else desk_phone end
  where id = c.org_id and (lower(desk_contact_name) = lower(v_name) or (v_email is not null and lower(desk_email) = v_email) or (c.phone is not null and desk_phone = c.phone));
  get diagnostics n = row_count; v_aff := v_aff || jsonb_build_object('company_desk', n);

  update public.contacts set display_name = 'Erased contact', email = null, phone = null, notes = null,
    erased_at = now(), erased_by = p_actor, erase_reason = p_reason, updated_at = now()
  where id = c.id;
  insert into public.contact_erasures (contact_id, actor, actor_name, reason, affected) values (c.id, p_actor, p_actor_name, p_reason, v_aff);
  return v_aff;
end $$;

-- ── registry read model for the admin panel ──────────────────────────────
create or replace function public.fn_contacts_overview(p_q text default null, p_limit integer default 200)
returns table (id uuid, kind text, display_name text, email text, phone text, org_id uuid, org_name text, role text, source text,
               first_seen timestamptz, last_seen timestamptz, erased_at timestamptz, erase_reason text, cargo_count bigint, position_count bigint, queue_count bigint)
language sql stable security definer set search_path to 'public' as $$
  select c.id, c.kind, c.display_name, c.email, c.phone, c.org_id, o.name, c.role, c.source, c.first_seen, c.last_seen, c.erased_at, c.erase_reason,
    (select count(*) from public.cargo_listings l where l.broker_contact_id = c.id or l.source_contact_id = c.id),
    (select count(*) from public.vessel_availability a where a.source_contact_id = c.id),
    (select count(*) from public.vessel_review_queue q where q.source_contact_id = c.id)
  from public.contacts c left join public.organizations o on o.id = c.org_id
  where p_q is null or btrim(p_q) = '' or c.display_name ilike '%' || btrim(p_q) || '%' or c.email ilike '%' || btrim(p_q) || '%' or o.name ilike '%' || btrim(p_q) || '%'
  order by c.erased_at nulls first, c.last_seen desc
  limit greatest(1, least(p_limit, 1000));
$$;

revoke all on function public.fn_upsert_contact(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.gdpr_erase_contact(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.fn_contacts_overview(text, integer) from public, anon;
grant execute on function public.fn_upsert_contact(text, text, text, text, text, text) to service_role;
grant execute on function public.gdpr_erase_contact(uuid, uuid, text, text) to service_role;
grant execute on function public.fn_contacts_overview(text, integer) to service_role, authenticated;
grant execute on function public.fn_contact_parse_broker(text) to service_role, authenticated;

-- ── data-quality rule: every stored sender is bound to a registry record ──
select public.fn_dq_seed_rule(
  'DQ-G01', 'Sender or broker bound to a contact record', 'compliance', 'warn', 'declarative', 'none', 'admin',
  'Every broker or sender stored on a listing must point to a contacts row (the GDPR record that can be erased on request). The binding triggers do this on write; a row without a link means text was stored outside the trigger path.',
  'not null: broker_contact_id when broker is a person/company · source_contact_id when a sender is stored',
  jsonb_build_array(
    jsonb_build_object('table', 'cargo_listings', 'field', 'broker_contact_id',
      'violation_sql', $$((r.broker is not null and r.broker !~* '^(anonymous|anon\.?|-+|n/?a|unknown|erased contact)$' and r.broker_contact_id is null) or ((r.source_contact is not null or r.source_company is not null) and r.source_contact_id is null))$$,
      'observed_sql', $$coalesce(r.broker, r.source_contact, r.source_company)$$, 'expected_text', 'a contacts record (Companies → Contacts)'),
    jsonb_build_object('table', 'vessel_availability', 'field', 'source_contact_id',
      'violation_sql', $$(r.source_contact is not null or r.source_company is not null) and r.source_contact_id is null$$,
      'observed_sql', $$coalesce(r.source_contact, r.source_company)$$, 'expected_text', 'a contacts record (Companies → Contacts)')));
