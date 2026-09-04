-- ════════════════════════════════════════════════════════════════════════
-- Manual Review → vessels: flag registry, company roles, and a sync that
-- actually reaches the market (03 Sep 2026)
--
-- 1. flag_states — the closed vocabulary for vessels.flag. A FLAG is the ship
--    register (a legal term), not a country: Gibraltar, Isle of Man, Madeira,
--    Hong Kong are flags; Panama/Liberia carry ships with no national link.
--    Seeded from lib/geo/flag-states.ts (single source of truth), editable
--    in Database Preview, with fn_normalize_flag() mirroring the TS matcher
--    so "MI Flag" / "Togolese Rep." / "Cameron" / "UNION OF COMOROS" resolve.
-- 2. Company roles on the review queue (registered owner, ship/commercial
--    manager, ISM manager — the three Equasis roles) carried onto vessels and
--    linked into organizations (created there when missing).
-- 3. resolve_vessel_review now ALSO posts the OPEN position into
--    vessel_availability (APPROVED + live), which is what the dashboard,
--    Vessels board and Market Insights read. Until now it only wrote the
--    vessel register row, so a synced vessel never appeared anywhere.
-- 4. fn_va_port_autofill keeps an explicitly supplied open_port_name /
--    open_zone when a position is inserted WITHOUT a resolvable locode
--    (area positions such as "Marmara" / "Black Sea" from circulars).
--
-- Additive + idempotent. Flag backfill is audited in flag_normalization_backfill.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · flag_states registry ────────────────────────────────────────────────
create table if not exists public.flag_states (
  name        text primary key,
  iso2        text,
  category    text not null default 'national'
              check (category in ('open', 'national', 'unknown')),
  aliases     text[] not null default '{}'::text[],
  is_active   boolean not null default true,
  sort_order  integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.flag_states is
  'Maritime flag-state registry (ship registers, not countries). Closed vocabulary for vessels.flag; aliases are the spellings fn_normalize_flag() maps onto the canonical name.';

alter table public.flag_states enable row level security;
drop policy if exists "flag_states: all read" on public.flag_states;
create policy "flag_states: all read" on public.flag_states
  for select to anon, authenticated using (true);
drop policy if exists "flag_states: admin all" on public.flag_states;
create policy "flag_states: admin all" on public.flag_states
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());
grant select on public.flag_states to anon, authenticated;
grant all on public.flag_states to service_role;

drop trigger if exists trg_flag_states_updated_at on public.flag_states;
create trigger trg_flag_states_updated_at
  before update on public.flag_states
  for each row execute function public.fn_set_updated_at();

-- Seed (generated from lib/geo/flag-states.ts — keep the two in step).
-- An existing row keeps any aliases the owner added by hand.
insert into public.flag_states (name, iso2, category, aliases, sort_order) values
  ('Panama', 'pa', 'open', array['PMA','Panamanian']::text[], 0),
  ('Liberia', 'lr', 'open', array['Liberian']::text[], 10),
  ('Marshall Islands', 'mh', 'open', array['MI','MI Flag','Marshall Is','Marshall Isl','RMI','Republic of the Marshall Islands']::text[], 20),
  ('Malta', 'mt', 'open', array['Maltese']::text[], 30),
  ('Bahamas', 'bs', 'open', array['The Bahamas','Commonwealth of the Bahamas']::text[], 40),
  ('Cyprus', 'cy', 'open', array['Cypriot']::text[], 50),
  ('Comoros', 'km', 'open', array['Union of Comoros','Union of the Comoros','Comoro Islands','Comores']::text[], 60),
  ('Togo', 'tg', 'open', array['Togolese Rep','Togolese Republic','Togolese']::text[], 70),
  ('Palau', 'pw', 'open', array['Republic of Palau']::text[], 80),
  ('Tanzania', 'tz', 'open', array['Tanzania (Zanzibar)','Zanzibar','United Republic of Tanzania']::text[], 90),
  ('Sierra Leone', 'sl', 'open', array['S Leone']::text[], 100),
  ('Cameroon', 'cm', 'open', array['Cameron','Cameroun','Republic of Cameroon']::text[], 110),
  ('Gabon', 'ga', 'open', array['Gabonese Republic']::text[], 120),
  ('Cook Islands', 'ck', 'open', array['Cook Is']::text[], 130),
  ('St. Vincent & Grenadines', 'vc', 'open', array['St Vincent & Grenadines','Saint Vincent and the Grenadines','St Vincent and the Grenadines','St Vincent and Grenadines','SVG','St. Vincent and the Grenadines','St Vincent']::text[], 140),
  ('St. Kitts & Nevis', 'kn', 'open', array['St Kitts & Nevis','Saint Kitts and Nevis','St Kitts and Nevis','St. Kitts and Nevis','St Kitts Nevis','SKN']::text[], 150),
  ('Antigua & Barbuda', 'ag', 'open', array['Antigua and Barbuda','Antigua']::text[], 160),
  ('Belize', 'bz', 'open', '{}'::text[], 170),
  ('Barbados', 'bb', 'open', '{}'::text[], 180),
  ('Bermuda', 'bm', 'open', '{}'::text[], 190),
  ('Cayman Islands', 'ky', 'open', array['Cayman Is','Cayman']::text[], 200),
  ('Gibraltar', 'gi', 'open', '{}'::text[], 210),
  ('Isle of Man', 'im', 'open', array['IOM']::text[], 220),
  ('Curaçao', 'cw', 'open', array['Curacao','Netherlands Antilles']::text[], 230),
  ('Moldova', 'md', 'open', array['Moldavia','Republic of Moldova']::text[], 240),
  ('Mongolia', 'mn', 'open', '{}'::text[], 250),
  ('Honduras', 'hn', 'open', '{}'::text[], 260),
  ('Jamaica', 'jm', 'open', '{}'::text[], 270),
  ('Dominica', 'dm', 'open', array['Commonwealth of Dominica']::text[], 280),
  ('Vanuatu', 'vu', 'open', '{}'::text[], 290),
  ('Tuvalu', 'tv', 'open', '{}'::text[], 300),
  ('Niue', 'nu', 'open', '{}'::text[], 310),
  ('Kiribati', 'ki', 'open', '{}'::text[], 320),
  ('Tonga', 'to', 'open', '{}'::text[], 330),
  ('Samoa', 'ws', 'open', array['Western Samoa']::text[], 340),
  ('Guinea-Bissau', 'gw', 'open', array['Guinea Bissau']::text[], 350),
  ('Equatorial Guinea', 'gq', 'open', '{}'::text[], 360),
  ('São Tomé & Príncipe', 'st', 'open', array['Sao Tome and Principe','Sao Tome & Principe','Sao Tome']::text[], 370),
  ('Mauritius', 'mu', 'open', '{}'::text[], 380),
  ('Madeira', 'pt', 'open', array['Portugal (MAR)','MAR','Madeira (MAR)','Portugal Madeira']::text[], 390),
  ('Faroe Islands', 'fo', 'open', array['Faroes','Faeroe Islands','FAS','Faroe Islands (FAS)']::text[], 400),
  ('Cambodia', 'kh', 'open', array['Kampuchea']::text[], 410),
  ('Bolivia', 'bo', 'open', '{}'::text[], 420),
  ('Georgia', 'ge', 'open', '{}'::text[], 430),
  ('Lebanon', 'lb', 'open', array['Lebanese']::text[], 440),
  ('Sri Lanka', 'lk', 'open', array['Ceylon']::text[], 450),
  ('Myanmar', 'mm', 'open', array['Burma']::text[], 460),
  ('North Korea', 'kp', 'open', array['Korea, DPR','DPRK','Korea (North)','Democratic People''s Republic of Korea']::text[], 470),
  ('San Marino', 'sm', 'open', '{}'::text[], 480),
  ('Eswatini', 'sz', 'open', array['Swaziland']::text[], 490),
  ('Gambia', 'gm', 'open', array['The Gambia']::text[], 500),
  ('Guyana', 'gy', 'open', '{}'::text[], 510),
  ('Micronesia', 'fm', 'open', array['Federated States of Micronesia','FSM']::text[], 520),
  ('Timor-Leste', 'tl', 'open', array['East Timor']::text[], 530),
  ('Egypt', 'eg', 'national', array['Egyptian','Arab Republic of Egypt']::text[], 860),
  ('Saudi Arabia', 'sa', 'national', array['KSA','Kingdom of Saudi Arabia']::text[], 1560),
  ('United Arab Emirates', 'ae', 'national', array['UAE','U.A.E.']::text[], 1820),
  ('Qatar', 'qa', 'national', '{}'::text[], 1530),
  ('Kuwait', 'kw', 'national', '{}'::text[], 1210),
  ('Bahrain', 'bh', 'national', '{}'::text[], 640),
  ('Oman', 'om', 'national', array['Sultanate of Oman']::text[], 1440),
  ('Yemen', 'ye', 'national', '{}'::text[], 1900),
  ('Iraq', 'iq', 'national', '{}'::text[], 1110),
  ('Jordan', 'jo', 'national', '{}'::text[], 1180),
  ('Syria', 'sy', 'national', array['Syrian Arab Republic']::text[], 1730),
  ('Libya', 'ly', 'national', '{}'::text[], 1230),
  ('Tunisia', 'tn', 'national', '{}'::text[], 1770),
  ('Algeria', 'dz', 'national', '{}'::text[], 560),
  ('Morocco', 'ma', 'national', '{}'::text[], 1350),
  ('Mauritania', 'mr', 'national', '{}'::text[], 1300),
  ('Sudan', 'sd', 'national', '{}'::text[], 1690),
  ('Djibouti', 'dj', 'national', '{}'::text[], 820),
  ('Somalia', 'so', 'national', '{}'::text[], 1630),
  ('Eritrea', 'er', 'national', '{}'::text[], 880),
  ('Iran', 'ir', 'national', array['Islamic Republic of Iran']::text[], 1100),
  ('Turkey', 'tr', 'national', array['Türkiye','Turkiye','Turkish']::text[], 1780),
  ('Greece', 'gr', 'national', array['Greek','Hellenic']::text[], 990),
  ('Italy', 'it', 'national', array['Italian']::text[], 1140),
  ('Spain', 'es', 'national', array['Canary Islands','Spain (REC)']::text[], 1660),
  ('Portugal', 'pt', 'national', '{}'::text[], 1510),
  ('France', 'fr', 'national', array['France (RIF)','RIF','French International Register']::text[], 940),
  ('Croatia', 'hr', 'national', '{}'::text[], 790),
  ('Slovenia', 'si', 'national', '{}'::text[], 1610),
  ('Montenegro', 'me', 'national', '{}'::text[], 1330),
  ('Albania', 'al', 'national', '{}'::text[], 550),
  ('Bulgaria', 'bg', 'national', '{}'::text[], 710),
  ('Romania', 'ro', 'national', '{}'::text[], 1540),
  ('Ukraine', 'ua', 'national', '{}'::text[], 1810),
  ('Russia', 'ru', 'national', array['Russian Federation']::text[], 1550),
  ('Azerbaijan', 'az', 'national', '{}'::text[], 630),
  ('Kazakhstan', 'kz', 'national', '{}'::text[], 1190),
  ('Turkmenistan', 'tm', 'national', '{}'::text[], 1790),
  ('Israel', 'il', 'national', '{}'::text[], 1130),
  ('United Kingdom', 'gb', 'national', array['UK','Great Britain','British','England']::text[], 1830),
  ('Ireland', 'ie', 'national', '{}'::text[], 1120),
  ('Netherlands', 'nl', 'national', array['Holland','The Netherlands','Dutch']::text[], 1380),
  ('Belgium', 'be', 'national', '{}'::text[], 660),
  ('Luxembourg', 'lu', 'national', '{}'::text[], 1250),
  ('Germany', 'de', 'national', array['German','Germany (GIS)']::text[], 970),
  ('Denmark', 'dk', 'national', array['Denmark (DIS)','DIS','Danish']::text[], 810),
  ('Norway', 'no', 'national', array['Norway (NIS)','NIS','Norway (NOR)','Norwegian']::text[], 1430),
  ('Sweden', 'se', 'national', '{}'::text[], 1710),
  ('Finland', 'fi', 'national', '{}'::text[], 930),
  ('Iceland', 'is', 'national', '{}'::text[], 1070),
  ('Poland', 'pl', 'national', '{}'::text[], 1500),
  ('Estonia', 'ee', 'national', '{}'::text[], 890),
  ('Latvia', 'lv', 'national', '{}'::text[], 1220),
  ('Lithuania', 'lt', 'national', '{}'::text[], 1240),
  ('Switzerland', 'ch', 'national', '{}'::text[], 1720),
  ('Austria', 'at', 'national', '{}'::text[], 620),
  ('Jersey', 'je', 'national', '{}'::text[], 1170),
  ('Guernsey', 'gg', 'national', '{}'::text[], 1030),
  ('Åland Islands', 'ax', 'national', array['Aland Islands','Aland']::text[], 540),
  ('Greenland', 'gl', 'national', '{}'::text[], 1000),
  ('Monaco', 'mc', 'national', '{}'::text[], 1320),
  ('China', 'cn', 'national', array['PRC','People''s Republic of China','Chinese']::text[], 750),
  ('Hong Kong', 'hk', 'national', array['Hong Kong SAR','Hong Kong, China','HK']::text[], 1060),
  ('Macao', 'mo', 'national', array['Macau']::text[], 1260),
  ('Taiwan', 'tw', 'national', array['Taiwan, China','Chinese Taipei']::text[], 1740),
  ('Japan', 'jp', 'national', array['Japanese']::text[], 1160),
  ('South Korea', 'kr', 'national', array['Korea','Korea, Republic of','Republic of Korea','Korea (South)']::text[], 1650),
  ('Singapore', 'sg', 'national', '{}'::text[], 1590),
  ('Malaysia', 'my', 'national', '{}'::text[], 1280),
  ('Indonesia', 'id', 'national', '{}'::text[], 1090),
  ('Philippines', 'ph', 'national', '{}'::text[], 1490),
  ('Vietnam', 'vn', 'national', array['Viet Nam']::text[], 1880),
  ('Thailand', 'th', 'national', '{}'::text[], 1750),
  ('Brunei', 'bn', 'national', array['Brunei Darussalam']::text[], 700),
  ('India', 'in', 'national', array['Indian']::text[], 1080),
  ('Pakistan', 'pk', 'national', '{}'::text[], 1450),
  ('Bangladesh', 'bd', 'national', '{}'::text[], 650),
  ('Maldives', 'mv', 'national', '{}'::text[], 1290),
  ('Australia', 'au', 'national', '{}'::text[], 610),
  ('New Zealand', 'nz', 'national', '{}'::text[], 1400),
  ('Papua New Guinea', 'pg', 'national', array['PNG']::text[], 1460),
  ('Fiji', 'fj', 'national', '{}'::text[], 920),
  ('Solomon Islands', 'sb', 'national', '{}'::text[], 1620),
  ('New Caledonia', 'nc', 'national', '{}'::text[], 1390),
  ('French Polynesia', 'pf', 'national', '{}'::text[], 950),
  ('Wallis & Futuna', 'wf', 'national', array['Wallis and Futuna']::text[], 1890),
  ('French Southern Territories', 'tf', 'national', array['Kerguelen','TAAF','French Southern and Antarctic Lands']::text[], 960),
  ('Nigeria', 'ng', 'national', '{}'::text[], 1420),
  ('Ghana', 'gh', 'national', '{}'::text[], 980),
  ('Ivory Coast', 'ci', 'national', array['Côte d''Ivoire','Cote d''Ivoire','Cote dIvoire']::text[], 1150),
  ('Senegal', 'sn', 'national', '{}'::text[], 1570),
  ('Guinea', 'gn', 'national', '{}'::text[], 1040),
  ('Benin', 'bj', 'national', '{}'::text[], 670),
  ('Congo', 'cg', 'national', array['Republic of the Congo','Congo (Brazzaville)']::text[], 770),
  ('DR Congo', 'cd', 'national', array['Democratic Republic of the Congo','Congo (Kinshasa)','Zaire']::text[], 840),
  ('Angola', 'ao', 'national', '{}'::text[], 570),
  ('Namibia', 'na', 'national', '{}'::text[], 1370),
  ('South Africa', 'za', 'national', array['RSA']::text[], 1640),
  ('Mozambique', 'mz', 'national', '{}'::text[], 1360),
  ('Madagascar', 'mg', 'national', '{}'::text[], 1270),
  ('Seychelles', 'sc', 'national', '{}'::text[], 1580),
  ('Kenya', 'ke', 'national', '{}'::text[], 1200),
  ('Ethiopia', 'et', 'national', '{}'::text[], 900),
  ('Cape Verde', 'cv', 'national', array['Cabo Verde']::text[], 730),
  ('United States', 'us', 'national', array['USA','US','United States of America','U.S.A.']::text[], 1840),
  ('Canada', 'ca', 'national', '{}'::text[], 720),
  ('Mexico', 'mx', 'national', '{}'::text[], 1310),
  ('Brazil', 'br', 'national', '{}'::text[], 680),
  ('Argentina', 'ar', 'national', '{}'::text[], 590),
  ('Chile', 'cl', 'national', '{}'::text[], 740),
  ('Peru', 'pe', 'national', '{}'::text[], 1480),
  ('Ecuador', 'ec', 'national', '{}'::text[], 850),
  ('Colombia', 'co', 'national', '{}'::text[], 760),
  ('Venezuela', 've', 'national', '{}'::text[], 1870),
  ('Uruguay', 'uy', 'national', '{}'::text[], 1850),
  ('Paraguay', 'py', 'national', '{}'::text[], 1470),
  ('Cuba', 'cu', 'national', '{}'::text[], 800),
  ('Dominican Republic', 'do', 'national', '{}'::text[], 830),
  ('Haiti', 'ht', 'national', '{}'::text[], 1050),
  ('Trinidad & Tobago', 'tt', 'national', array['Trinidad and Tobago']::text[], 1760),
  ('Grenada', 'gd', 'national', '{}'::text[], 1010),
  ('St. Lucia', 'lc', 'national', array['Saint Lucia','St Lucia']::text[], 1680),
  ('Aruba', 'aw', 'national', '{}'::text[], 600),
  ('Sint Maarten', 'sx', 'national', array['St Maarten']::text[], 1600),
  ('Anguilla', 'ai', 'national', '{}'::text[], 580),
  ('British Virgin Islands', 'vg', 'national', array['BVI','Virgin Islands (British)']::text[], 690),
  ('US Virgin Islands', 'vi', 'national', array['Virgin Islands (US)','U.S. Virgin Islands']::text[], 1860),
  ('Turks & Caicos Islands', 'tc', 'national', array['Turks and Caicos Islands','Turks and Caicos']::text[], 1800),
  ('Montserrat', 'ms', 'national', '{}'::text[], 1340),
  ('Puerto Rico', 'pr', 'national', '{}'::text[], 1520),
  ('Falkland Islands', 'fk', 'national', array['Falklands','Malvinas']::text[], 910),
  ('St. Helena', 'sh', 'national', array['Saint Helena']::text[], 1670),
  ('Guatemala', 'gt', 'national', '{}'::text[], 1020),
  ('Nicaragua', 'ni', 'national', '{}'::text[], 1410),
  ('Costa Rica', 'cr', 'national', '{}'::text[], 780),
  ('El Salvador', 'sv', 'national', '{}'::text[], 870),
  ('Suriname', 'sr', 'national', '{}'::text[], 1700),
  ('Unknown', null, 'unknown', array['Not Known','N/K','Unknown flag','Flag unknown','TBA','TBN']::text[], 1910)
on conflict (name) do update set
  iso2       = excluded.iso2,
  category   = excluded.category,
  aliases    = (select coalesce(array_agg(distinct a), '{}'::text[])
                from unnest(public.flag_states.aliases || excluded.aliases) a),
  sort_order = excluded.sort_order,
  updated_at = now();

-- Match key — mirrors flagKey() in lib/geo/flag-states.ts exactly:
-- lower → strip accents → non-alphanumerics to spaces → saint→st → drop
-- connective noise → collapse spaces.
create or replace function public.fn_flag_key(p text)
returns text
language sql immutable strict
set search_path to ''
as $$
  select nullif(trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          translate(lower(p),
            'àáâãäåçèéêëìíîïñòóôõöùúûüýÿšžłğşıé',
            'aaaaaaceeeeiiiinooooouuuuyyszlgsie'),
          '[^a-z0-9]+', ' ', 'g'),
        '\msaint\M', 'st', 'g'),
      '\m(the|and|of|republic|rep|islamic|kingdom|state|union|flag|federation|commonwealth)\M', ' ', 'g'),
    '\s+', ' ', 'g')), '');
$$;

-- Canonical flag-state name for free text; NULL when it is not a register we
-- know (class societies and "n/a" tokens included). "Unknown" is a real value.
create or replace function public.fn_normalize_flag(p text)
returns text
language plpgsql stable
set search_path to ''
as $$
declare k text; v text;
begin
  if p is null then return null; end if;
  k := public.fn_flag_key(p);
  if k is null then return null; end if;
  if k in ('iacs','bv','dnv','abs','lr','rina','ccs','krs','rs','tbc','n a','na','nil','none') then
    return null;
  end if;
  select f.name into v
  from public.flag_states f
  where f.is_active
    and (public.fn_flag_key(f.name) = k
         or exists (select 1 from unnest(f.aliases) a where public.fn_flag_key(a) = k))
  order by f.sort_order nulls last
  limit 1;
  return v;
end $$;

grant execute on function public.fn_flag_key(text), public.fn_normalize_flag(text) to anon, authenticated, service_role;

-- Database Preview: make flag_states browsable/editable like the other lookups.
create or replace function public.fn_sync_table_allowed(p_table text)
 returns boolean
 language sql
 immutable
 set search_path to ''
as $function$
  select p_table in (
    'cargo_listings','vessels','organizations','ports','commodities',
    'market_names','grain_list','imsbc_codes','css_categories','flag_states'
  );
$function$;

create or replace function public.fn_sync_key_column(p_table text)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case p_table
    when 'cargo_listings' then 'ref'
    when 'vessels'        then 'imo_number'
    when 'organizations'  then 'name'
    when 'ports'          then 'locode'
    when 'commodities'    then 'canonical_name'
    when 'market_names'   then 'market_name'
    when 'grain_list'     then 'market_name'
    when 'imsbc_codes'    then 'bcsn'
    when 'css_categories' then 'code'
    when 'flag_states'    then 'name'
    else null
  end;
$function$;

-- ── 2 · company roles on the queue + vessels ───────────────────────────────
alter table public.vessel_review_queue
  add column if not exists owner_company      text,
  add column if not exists commercial_manager text,
  add column if not exists ism_manager        text,
  add column if not exists resolved_availability_id uuid references public.vessel_availability(id) on delete set null;
comment on column public.vessel_review_queue.commercial_manager is
  'Ship manager / commercial manager (Equasis role) — the counterparty that matters for chartering.';

alter table public.vessels
  add column if not exists ism_manager_company text;
comment on column public.vessels.ism_manager_company is 'ISM manager / DOC holder (Equasis role).';
comment on column public.vessels.commercial_manager_company is 'Ship manager / commercial manager (Equasis role). manager_company mirrors it for older readers.';

-- Find-or-create a company in the registry by name (case-insensitive) and
-- return its id. Never rewrites an existing organisation.
create or replace function public.fn_link_organization(p_name text, p_role text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare v_id uuid; v_name text;
begin
  v_name := nullif(upper(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'))), '');
  if v_name is null then return null; end if;
  select id into v_id from public.organizations where upper(trim(name)) = v_name limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.organizations (name, org_type, source_tag)
  values (v_name,
          case when p_role = 'owner' then 'owner' else 'manager' end,
          'data-sync:' || coalesce(p_role, 'link'))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.fn_link_organization(text, text) from public, anon, authenticated;
grant execute on function public.fn_link_organization(text, text) to service_role;

-- ── 3 · audited flag backfill on the live data ─────────────────────────────
create table if not exists public.flag_normalization_backfill (
  id          bigserial primary key,
  table_name  text not null,
  row_id      uuid not null,
  before      text,
  after       text,
  applied_at  timestamptz not null default now()
);

with src as (
  select v.id, v.flag as before, public.fn_normalize_flag(v.flag) as after
  from public.vessels v
  where v.flag is not null
    and public.fn_normalize_flag(v.flag) is not null
    and public.fn_normalize_flag(v.flag) <> v.flag
), logged as (
  insert into public.flag_normalization_backfill (table_name, row_id, before, after)
  select 'vessels', id, before, after from src
)
update public.vessels v set flag = src.after, updated_at = now()
from src where v.id = src.id;

with src as (
  select q.id, q.flag as before, public.fn_normalize_flag(q.flag) as after
  from public.vessel_review_queue q
  where q.flag is not null
    and public.fn_normalize_flag(q.flag) is not null
    and public.fn_normalize_flag(q.flag) <> q.flag
), logged as (
  insert into public.flag_normalization_backfill (table_name, row_id, before, after)
  select 'vessel_review_queue', id, before, after from src
)
update public.vessel_review_queue q set flag = src.after
from src where q.id = src.id;

-- flag_category (FOC / Domestic) from the registry where it was never set.
update public.vessels v
set flag_category = case f.category when 'open' then 'FOC'::public.flag_category_enum
                                    else 'Domestic'::public.flag_category_enum end
from public.flag_states f
where v.flag_category is null and v.flag = f.name and f.category <> 'unknown';

-- Data-quality view: live rows whose flag is not a recognised register.
create or replace view public.v_vessel_flag_issues
with (security_invoker = true) as
  select 'vessels'::text as source, v.id, v.vessel_name, v.imo_number as imo, v.flag
  from public.vessels v
  where v.flag is not null and public.fn_normalize_flag(v.flag) is null
  union all
  select 'vessel_review_queue', q.id, q.vessel_name, q.imo_hint, q.flag
  from public.vessel_review_queue q
  where q.status = 'pending' and q.flag is not null and public.fn_normalize_flag(q.flag) is null;

-- ── 4 · port autofill: keep supplied name/zone when there is no locode ─────
CREATE OR REPLACE FUNCTION public.fn_va_port_autofill()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_open_port    public.ports%ROWTYPE;
  v_ballast_port public.ports%ROWTYPE;
BEGIN
  IF NEW.open_port_locode IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD.open_port_locode IS DISTINCT FROM NEW.open_port_locode) THEN
    SELECT * INTO v_open_port FROM public.ports WHERE locode = NEW.open_port_locode;
    IF FOUND THEN
      NEW.open_port_name := v_open_port.trade_name;
      NEW.open_zone      := v_open_port.zone;
    END IF;
  ELSIF NEW.open_port_locode IS NULL AND TG_OP = 'UPDATE' AND OLD.open_port_locode IS NOT NULL THEN
    -- the port was cleared → drop the derived name/zone; an INSERT (or an
    -- update that never had a locode) keeps what the caller supplied, so an
    -- area-only position ("Marmara", "Black Sea") still shows where she is.
    NEW.open_port_name := NULL;
    NEW.open_zone      := NULL;
  END IF;

  IF NEW.ballast_port_locode IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD.ballast_port_locode IS DISTINCT FROM NEW.ballast_port_locode) THEN
    SELECT * INTO v_ballast_port FROM public.ports WHERE locode = NEW.ballast_port_locode;
    IF FOUND THEN
      NEW.ballast_port_name := v_ballast_port.trade_name;
    END IF;
  ELSIF NEW.ballast_port_locode IS NULL THEN
    NEW.ballast_port_name := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 5 · resolve_vessel_review: register + companies + OPEN position ────────
create or replace function public.resolve_vessel_review(p_id uuid, p_imo text default null, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_q        public.vessel_review_queue;
  v_vessel_id uuid;
  v_aid      uuid;
  v_op       text;
  v_has_imo  boolean;
  v_flag     text;
  v_flagcat  public.flag_category_enum;
  v_locode   text;
  v_zone     public.zone_enum;
  v_dest     public.zone_enum[];
  v_owner    text;
  v_comm     text;
  v_ism      text;
  v_notes    text;
begin
  select * into v_q from public.vessel_review_queue where id = p_id;
  if v_q.id is null then raise exception 'vessel queue entry % not found', p_id using errcode = 'P0002'; end if;

  v_has_imo := p_imo is not null and length(trim(p_imo)) > 0;
  if v_has_imo and not public.fn_imo_check_digit(trim(p_imo)) then
    raise exception 'IMO % fails the check digit', trim(p_imo) using errcode = '22023';
  end if;

  -- flag: canonical register name (unrecognised text is kept, never invented)
  v_flag := coalesce(public.fn_normalize_flag(v_q.flag), v_q.flag);
  select case f.category when 'open' then 'FOC'::public.flag_category_enum
                         when 'national' then 'Domestic'::public.flag_category_enum end
    into v_flagcat
  from public.flag_states f where f.name = v_flag;

  v_owner := nullif(upper(trim(coalesce(v_q.owner_company, ''))), '');
  v_comm  := nullif(upper(trim(coalesce(v_q.commercial_manager, ''))), '');
  v_ism   := nullif(upper(trim(coalesce(v_q.ism_manager, ''))), '');
  -- company module link (find-or-create; counts are not recomputed here)
  if v_owner is not null then perform public.fn_link_organization(v_owner, 'owner'); end if;
  if v_comm  is not null then perform public.fn_link_organization(v_comm,  'commercial_manager'); end if;
  if v_ism   is not null then perform public.fn_link_organization(v_ism,   'ism_manager'); end if;

  -- ── the vessel register row ──
  if v_has_imo then
    insert into public.vessels (vessel_name, imo_number, vessel_type, dwt_grain, build_year, flag, flag_category,
                                gross_tonnage, scnrt, registered_owner, owner_company,
                                commercial_manager_company, manager_company, ism_manager_company)
    values (v_q.vessel_name, trim(p_imo), public.fn_coerce_vessel_type(v_q.vessel_type), v_q.dwt_grain, v_q.built,
            v_flag, v_flagcat, v_q.grt, v_q.nrt, v_owner, v_owner, v_comm, v_comm, v_ism)
    on conflict (imo_number) do update set
      vessel_name   = excluded.vessel_name,
      dwt_grain     = coalesce(excluded.dwt_grain, public.vessels.dwt_grain),
      build_year    = coalesce(excluded.build_year, public.vessels.build_year),
      flag          = coalesce(excluded.flag, public.vessels.flag),
      flag_category = coalesce(excluded.flag_category, public.vessels.flag_category),
      gross_tonnage = coalesce(excluded.gross_tonnage, public.vessels.gross_tonnage),
      scnrt         = coalesce(excluded.scnrt, public.vessels.scnrt),
      registered_owner           = coalesce(excluded.registered_owner, public.vessels.registered_owner),
      owner_company              = coalesce(excluded.owner_company, public.vessels.owner_company),
      commercial_manager_company = coalesce(excluded.commercial_manager_company, public.vessels.commercial_manager_company),
      manager_company            = coalesce(excluded.manager_company, public.vessels.manager_company),
      ism_manager_company        = coalesce(excluded.ism_manager_company, public.vessels.ism_manager_company),
      updated_at    = now()
    returning id into v_vessel_id;
    v_op := 'imo';
  else
    select id into v_vessel_id from public.vessels
    where lower(vessel_name) = lower(v_q.vessel_name)
      and build_year is not distinct from v_q.built
      and dwt_grain  is not distinct from v_q.dwt_grain
      and imo_number is null
    limit 1;
    if v_vessel_id is not null then
      update public.vessels set
        vessel_type   = public.fn_coerce_vessel_type(v_q.vessel_type),
        flag          = coalesce(v_flag, flag),
        flag_category = coalesce(v_flagcat, flag_category),
        gross_tonnage = coalesce(v_q.grt, gross_tonnage),
        scnrt         = coalesce(v_q.nrt, scnrt),
        registered_owner           = coalesce(v_owner, registered_owner),
        owner_company              = coalesce(v_owner, owner_company),
        commercial_manager_company = coalesce(v_comm, commercial_manager_company),
        manager_company            = coalesce(v_comm, manager_company),
        ism_manager_company        = coalesce(v_ism, ism_manager_company),
        updated_at    = now()
      where id = v_vessel_id;
      v_op := 'composite-update';
    else
      insert into public.vessels (vessel_name, imo_number, vessel_type, dwt_grain, build_year, flag, flag_category,
                                  gross_tonnage, scnrt, registered_owner, owner_company,
                                  commercial_manager_company, manager_company, ism_manager_company, is_verified)
      values (v_q.vessel_name, null, public.fn_coerce_vessel_type(v_q.vessel_type), v_q.dwt_grain, v_q.built,
              v_flag, v_flagcat, v_q.grt, v_q.nrt, v_owner, v_owner, v_comm, v_comm, v_ism, false)
      returning id into v_vessel_id;
      v_op := 'composite-insert';
    end if;
  end if;

  -- ── the OPEN position (what the dashboard / Vessels board / Insights read) ──
  -- Port: lenient match on trade name or locode; else the area text is kept as
  -- open_port_name (the autofill trigger no longer wipes it on insert).
  if v_q.open_port is not null then
    select p.locode into v_locode
    from public.ports p
    where p.is_active
      and (lower(p.trade_name) = lower(trim(v_q.open_port))
           or replace(upper(p.locode), ' ', '') = replace(upper(trim(v_q.open_port)), ' ', ''))
    order by p.is_verified desc, p.locode
    limit 1;
  end if;
  if v_q.open_zone is not null and exists (
       select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = 'zone_enum' and e.enumlabel = v_q.open_zone) then
    v_zone := v_q.open_zone::public.zone_enum;
  end if;
  if v_q.dest_zones is not null then
    select array_agg(z::public.zone_enum) into v_dest
    from unnest(v_q.dest_zones) z
    where exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'zone_enum' and e.enumlabel = z);
  end if;
  v_notes := 'Synced from ' || coalesce(v_q.source, 'circular')
             || case when v_q.posted_at is not null then ' posted ' || to_char(v_q.posted_at, 'DD Mon YYYY') else '' end
             || case when v_locode is null and v_q.open_port is not null then ' · open ' || v_q.open_port else '' end
             || case when v_q.direction is not null then ' · direction ' || v_q.direction else '' end;

  select id into v_aid from public.vessel_availability
  where vessel_id = v_vessel_id and status = 'OPEN'
  order by created_at desc limit 1;

  if v_aid is not null then
    update public.vessel_availability set
      open_port_locode = v_locode,
      open_port_name   = case when v_locode is null then v_q.open_port else open_port_name end,
      open_zone        = coalesce(v_zone, open_zone),
      open_date        = coalesce(v_q.open_date, open_date),
      next_direction   = coalesce(v_q.direction, next_direction),
      trading_zones    = coalesce(v_dest, trading_zones),
      notes            = v_notes,
      status           = 'OPEN',
      review_status    = 'APPROVED',
      goes_live_at     = coalesce(goes_live_at, now()),
      refreshed_at     = now(),
      updated_at       = now()
    where id = v_aid;
  else
    insert into public.vessel_availability (
      vessel_id, open_port_locode, open_port_name, open_zone, open_date, open_date_range_days,
      next_direction, trading_zones, notes, status, review_status, goes_live_at, refreshed_at
    ) values (
      v_vessel_id, v_locode, case when v_locode is null then v_q.open_port end, v_zone, v_q.open_date, 7,
      v_q.direction, v_dest, v_notes, 'OPEN', 'APPROVED', now(), now()
    ) returning id into v_aid;
    -- belt and braces against any submission-routing trigger resetting it
    update public.vessel_availability
      set review_status = 'APPROVED', goes_live_at = coalesce(goes_live_at, now())
      where id = v_aid and review_status <> 'APPROVED';
  end if;

  -- one live OPEN posting per vessel
  update public.vessel_availability set status = 'INACTIVE', updated_at = now()
  where vessel_id = v_vessel_id and status = 'OPEN' and id <> v_aid;

  update public.vessel_review_queue
    set status = 'synced', resolved_vessel_id = v_vessel_id, resolved_availability_id = v_aid,
        resolved_with_imo = v_has_imo, resolved_by = p_actor, resolved_at = now()
  where id = p_id;

  return jsonb_build_object('vessel_id', v_vessel_id, 'op', v_op,
                            'availability_id', v_aid, 'port_resolved', v_locode is not null);
end $function$;
