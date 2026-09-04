-- ════════════════════════════════════════════════════════════════════════
-- Market cards: port → port first, and who posted it (03 Sep 2026)
--
-- 1. Port-name → LOCODE resolution. Circulars name ports as brokers talk
--    ("Novo", "Constantza", "Jeddah Port"); ingestion stored the NAME with no
--    code, so the dashboard fell back to zone → zone. fn_resolve_port_locode()
--    mirrors lib/sync/ports.ts; an audited backfill codes every live row it
--    can (the port autofill triggers then set the canonical name + zone).
-- 2. source_contact / source_company on cargo_listings + vessel_availability:
--    the sender of the circular a synced listing came from. Backfilled from
--    the staged rows' _SRC_FROM for the email/WhatsApp batches.
-- 3. get_listing_posters(): one call resolves "who posted" for a set of
--    listings — member (name, company seat, admin) or circular sender —
--    exposing display fields only, never email/phone.
-- Additive + idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · port resolution ─────────────────────────────────────────────────────
create or replace function public.fn_resolve_port_locode(p text)
returns text
language plpgsql stable
set search_path to ''
as $$
declare k text; v text;
begin
  if p is null then return null; end if;
  k := lower(trim(p));
  if k = '' then return null; end if;
  -- ranges / alternatives are not a single port
  if k ~ '\m(or|and|either|range|rge)\M' or position('/' in k) > 0 then return null; end if;
  k := regexp_replace(k, '^\s*port\s+of\s+', '');
  k := regexp_replace(k, '\s+(port|anchorage|anch\.?)\s*$', '');
  k := regexp_replace(k, '\s+', ' ', 'g');
  k := case k
         when 'novo' then 'novorossiysk' when 'novoross' then 'novorossiysk'
         when 'constantza' then 'constanta' when 'burgas' then 'bourgas'
         when 'apapa' then 'lagos' when 'alarish' then 'el arish' when 'alex' then 'alexandria'
         when 'jeddah islamic port' then 'jeddah'
         else k end;
  -- an actual code
  select p2.locode into v from public.ports p2
   where p2.is_active and replace(upper(p2.locode), ' ', '') = replace(upper(k), ' ', '')
   limit 1;
  if v is not null then return v; end if;
  select p2.locode into v from public.ports p2
   where p2.is_active and lower(p2.trade_name) = k
   order by p2.is_verified desc, p2.locode limit 1;
  if v is not null then return v; end if;
  -- "Aliaga, Turkey" → first segment
  if position(',' in k) > 0 then
    select p2.locode into v from public.ports p2
     where p2.is_active and lower(p2.trade_name) = trim(split_part(k, ',', 1))
     order by p2.is_verified desc, p2.locode limit 1;
  end if;
  return v;
end $$;
grant execute on function public.fn_resolve_port_locode(text) to authenticated, service_role;

create table if not exists public.port_locode_backfill (
  id          bigserial primary key,
  table_name  text not null,
  row_id      uuid not null,
  column_name text not null,
  port_name   text,
  locode      text,
  applied_at  timestamptz not null default now()
);

with src as (
  select id, load_port_name as nm, public.fn_resolve_port_locode(load_port_name) as loc
  from public.cargo_listings where load_port_locode is null and load_port_name is not null
), ok as (select * from src where loc is not null),
logged as (insert into public.port_locode_backfill (table_name, row_id, column_name, port_name, locode)
           select 'cargo_listings', id, 'load_port_locode', nm, loc from ok)
update public.cargo_listings c set load_port_locode = ok.loc from ok where c.id = ok.id;

with src as (
  select id, disch_port_name as nm, public.fn_resolve_port_locode(disch_port_name) as loc
  from public.cargo_listings where disch_port_locode is null and disch_port_name is not null
), ok as (select * from src where loc is not null),
logged as (insert into public.port_locode_backfill (table_name, row_id, column_name, port_name, locode)
           select 'cargo_listings', id, 'disch_port_locode', nm, loc from ok)
update public.cargo_listings c set disch_port_locode = ok.loc from ok where c.id = ok.id;

with src as (
  select id, open_port_name as nm, public.fn_resolve_port_locode(open_port_name) as loc
  from public.vessel_availability where open_port_locode is null and open_port_name is not null
), ok as (select * from src where loc is not null),
logged as (insert into public.port_locode_backfill (table_name, row_id, column_name, port_name, locode)
           select 'vessel_availability', id, 'open_port_locode', nm, loc from ok)
update public.vessel_availability va set open_port_locode = ok.loc from ok where va.id = ok.id;

-- ── 2 · circular sender on the market tables ────────────────────────────────
alter table public.cargo_listings
  add column if not exists source_contact text,
  add column if not exists source_company text;
alter table public.vessel_availability
  add column if not exists source_contact text,
  add column if not exists source_company text;
comment on column public.cargo_listings.source_contact is 'Sender (person/desk) of the circular this listing was synced from.';
comment on column public.cargo_listings.source_company is 'Sender company (registry match on email domain, else display name / domain).';

-- Sender parsing in SQL — mirrors lib/sync/sender.ts closely enough for the
-- one-off backfill (new rows are filled by the pipeline itself).
create or replace function public.fn_sender_parts(p_from text, p_name text)
returns table (contact text, company text)
language plpgsql stable
set search_path to ''
as $$
declare v_email text; v_domain text; v_disp text; v_name text; v_contact text; v_company text; v_org text;
begin
  v_email  := lower(substring(coalesce(p_from, '') from '<([^>]+)>'));
  if v_email is null then v_email := lower(substring(coalesce(p_from, '') from '([A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]+)')); end if;
  v_domain := case when v_email like '%@%' then split_part(v_email, '@', 2) end;
  v_disp   := nullif(trim(both ' "''' from regexp_replace(coalesce(p_from, ''), '<[^>]*>', '', 'g')), '');
  if v_disp is not null and lower(v_disp) = v_email then v_disp := null; end if;
  v_name := coalesce(nullif(trim(p_name), ''), v_disp);
  v_contact := v_name;
  if v_name ~ '^(.+?)\s+[-–|]\s+(.+)$' then
    v_contact := trim(regexp_replace(v_name, '^(.+?)\s+[-–|]\s+(.+)$', '\1'));
    v_company := trim(regexp_replace(v_name, '^(.+?)\s+[-–|]\s+(.+)$', '\2'));
  end if;
  if v_domain is not null then
    select o.name into v_org from public.organizations o where v_domain = any (coalesce(o.email_domains, '{}')) limit 1;
  end if;
  if v_org is not null then v_company := v_org;
  elsif v_company is null then
    if v_name ~* '\m(shipping|chartering|maritime|marine|denizcilik|nakliyat|ltd|limited|s\.?a\.?|inc|llc|gmbh|srl|fzco|fze|dmcc|logistics|trading|brokers?|brokerage|navigation|lines?|co\.?|company|group|holdings|agency|agencies|services|management|carriers|tankers|bulk|freight|forwarding|international|intl|corp|corporation|plc|pte|pty|est|enterprises)\M'
      then v_company := v_name;
    elsif v_domain is not null and v_domain !~* '^(gmail|hotmail|outlook|yahoo|icloud|live|proton|protonmail|mail|yandex)\.'
      then v_company := v_domain;
    end if;
  end if;
  if v_contact is null and v_email is not null then
    v_contact := case when split_part(v_email, '@', 1) ~* '^(info|chartering|ops|operations|sales|fixtures|office|mail|contact|admin|hello|desk|brokers?|snp|dry|bulk)$'
                      then coalesce(v_company, v_email) else split_part(v_email, '@', 1) end;
  end if;
  contact := nullif(v_contact, ''); company := nullif(v_company, '');
  return next;
end $$;

-- Backfill: latest staged row per REF carries the sender keys.
with s as (
  select distinct on (business_key) business_key, raw->>'_SRC_FROM' as f, raw->>'_SRC_NAME' as n
  from public.sync_staged_row
  where sheet = 'cargo' and raw ? '_SRC_FROM'
  order by business_key, created_at desc
)
update public.cargo_listings c
   set source_contact = coalesce(c.source_contact, sp.contact),
       source_company = coalesce(c.source_company, sp.company)
  from s, lateral public.fn_sender_parts(s.f, s.n) sp
 where c.ref = s.business_key and c.source_contact is null;

-- Vessel positions synced from the review queue (new column, forward-filled here).
update public.vessel_availability va
   set source_contact = coalesce(va.source_contact, sp.contact),
       source_company = coalesce(va.source_company, sp.company)
  from public.vessel_review_queue q,
       lateral public.fn_sender_parts(q.source_email->>'from', q.source_email->>'name') sp
 where q.resolved_availability_id = va.id and va.source_contact is null;

-- ── 3 · who posted — one call for a set of listings ─────────────────────────
create or replace function public.get_listing_posters(p_type text, p_ids uuid[])
returns table (
  listing_id uuid,
  poster_name text,
  poster_company text,
  poster_kind text,
  is_admin boolean,
  org_id uuid
)
language sql stable security definer
set search_path to ''
as $$
  with own as (
    select distinct on (lo.listing_id)
           lo.listing_id,
           u.full_name,
           coalesce(o.name, u.company) as company,
           case when o.id is not null then (case when om.member_role = 'admin' then 'company' else 'employee' end)
                else 'individual' end as kind,
           (u.role = 'admin') as is_admin,
           o.id as org_id
    from public.listing_ownership lo
    join public.users u on u.id = lo.owner_user_id
    left join public.organization_members om
           on om.user_id = u.id and om.is_current and om.status = 'active'
    left join public.organizations o on o.id = om.org_id
    where lo.listing_type = p_type::public.listing_type_enum
      and lo.is_current
      and lo.listing_id = any (p_ids)
    order by lo.listing_id, (lo.role = 'primary') desc, lo.owned_from desc
  ),
  src as (
    select c.id as listing_id, coalesce(c.source_contact, c.broker) as poster_name, c.source_company as company
    from public.cargo_listings c
    where p_type = 'cargo' and c.id = any (p_ids)
    union all
    select v.id, coalesce(v.source_contact, v.broker), v.source_company
    from public.vessel_availability v
    where p_type = 'vessel_availability' and v.id = any (p_ids)
  )
  select own.listing_id, own.full_name, own.company, own.kind, own.is_admin, own.org_id from own
  union all
  select src.listing_id, src.poster_name, src.company, 'source', false, null
  from src
  where (src.poster_name is not null or src.company is not null)
    and not exists (select 1 from own where own.listing_id = src.listing_id);
$$;
revoke all on function public.get_listing_posters(text, uuid[]) from public, anon;
grant execute on function public.get_listing_posters(text, uuid[]) to authenticated, service_role;
