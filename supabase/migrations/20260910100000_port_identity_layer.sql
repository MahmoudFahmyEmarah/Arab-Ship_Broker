-- ════════════════════════════════════════════════════════════════════════
-- Port identity layer (10 Sep 2026)
--
-- Ports are the anchor of every distance, Voy OPEX and Ports DA. 171 of
-- 1,833 cargo listings could not be routed, and 107 of the 220 posted in the
-- last 7 days — because the intake had no way to say WHAT a port field is.
-- Four causes, fixed here (1, 2, 4) and in 20260910110000 (the gate):
--
--   1 · fn_cl_port_autofill only went LOCODE → name. A name-only row stayed
--       name-only forever, even when fn_resolve_port_locode had the answer
--       ("Dalian" → CNDLC). Now the trigger resolves BOTH directions.
--   2 · Broker language has three legitimate shapes and only one had a home:
--       a port ("Sfax"), an option list ("Reni or Izmail") and an area
--       ("Egypt Med"). Each side now carries a SCOPE, a candidate list and a
--       nominated REFERENCE port, so the calculators read one stored answer
--       instead of re-deriving it on every render.
--   4 · Aliases were hardcoded in two places that drifted (the CASE list in
--       fn_resolve_port_locode and SHORTHAND in lib/sync/ports.ts), and
--       areas had no dictionary at all. Both are tables now.
--
-- Owner's decisions (10 Sep 2026): an area nominates a reference port and
-- every figure derived from it is labelled an estimate; the gate blocks real
-- defects and queues the rest.
-- Additive + idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · shared normalisers ──────────────────────────────────────────────────
-- fn_port_key mirrors portKey() in lib/portal/route-legs.ts and
-- lib/sync/ports.ts — one spelling of "the same port name" everywhere.
create or replace function public.fn_port_key(p text)
 returns text language sql immutable
 set search_path to ''
as $$
  select nullif(
    trim(regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(p, '')), '^\s*port\s+of\s+', ''),
        '\s+(port|anchorage|anch\.?)\s*$', ''),
      '[^a-z0-9]+', ' ', 'g')),
    '');
$$;
comment on function public.fn_port_key(text) is
  'Normalised port-name key. Mirrors portKey() in the TypeScript layer.';

-- Strip the commercial notation brokers wrap around a place name:
-- "1-2sp(s) out of Lebanon, Syria, Isk-Mersin rge" → "Lebanon, Syria, Isk-Mersin".
create or replace function public.fn_port_strip_notation(p text)
 returns text language sql immutable
 set search_path to ''
as $$
  -- order matters: brackets, then a leading "either", then the safe-port /
  -- quantity notation, then a trailing range word, then collapse the spaces.
  select trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(p, ''), '\([^)]*\)', ' ', 'g'),
          '^\s*either\s+', '', 'i'),
        '^\s*\d+\s*[-–]?\s*\d*\s*(?:sps?|sbs?|safe\s*ports?|safe\s*berths?)?\s*(?:out\s+of\s+)?', '', 'i'),
      '\s+(?:rge|range|area|coast)\s*$', '', 'i'),
    '\s+', ' ', 'g'));
$$;
comment on function public.fn_port_strip_notation(text) is
  'Removes safe-port / range notation and bracketed asides from a port phrase.';

-- The options a phrase offers ("Reni or Izmail" → {Reni, Izmail}).
create or replace function public.fn_port_options(p text)
 returns text[] language sql immutable
 set search_path to ''
as $$
  select coalesce(array(
    select public.fn_port_strip_notation(o)
    from regexp_split_to_table(
      public.fn_port_strip_notation(p),
      '\s+or\s+|\s+and\s+|\s*/\s*|\s*,\s*|\s+either\s+'
    ) o
    where public.fn_port_strip_notation(o) <> ''
  ), '{}'::text[]);
$$;

-- ── 2 · the two dictionaries ────────────────────────────────────────────────
-- Port aliases: broker shorthand → a single real port. ONE home, replacing
-- the CASE list inside fn_resolve_port_locode and SHORTHAND in the sync code.
create table if not exists public.port_aliases (
  alias_key      text primary key,
  alias_text     text not null,
  locode         text references public.ports(locode) on update cascade,
  canonical_name text,
  note           text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  constraint port_aliases_target_ck check (locode is not null or canonical_name is not null)
);
comment on table public.port_aliases is
  'Broker shorthand for a single port ("Novo" → Novorossiysk, "Orlovka" → UAORL). Resolution consults this before the ports registry.';

-- Areas, countries and ranges: NOT a port, but each nominates a reference
-- port so distance / Voy OPEX / Ports DA can answer, always as an estimate.
create table if not exists public.port_areas (
  area_key          text primary key,
  area_name         text not null,
  kind              text not null default 'area'
                    check (kind in ('country', 'area', 'range')),
  zone              public.zone_enum,
  ref_locode        text references public.ports(locode) on update cascade,
  candidate_locodes text[] not null default '{}'::text[],
  alias_keys        text[] not null default '{}'::text[],
  note              text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.port_areas is
  'Ranges, countries and areas brokers name instead of a port ("Egypt Med", "Marmara"). ref_locode is the nominated reference port for estimates — never presented as the fixed port.';
create index if not exists port_areas_alias_idx on public.port_areas using gin (alias_keys);

alter table public.port_aliases enable row level security;
alter table public.port_areas   enable row level security;
do $rls$
begin
  drop policy if exists "port_aliases: members read" on public.port_aliases;
  create policy "port_aliases: members read" on public.port_aliases for select to authenticated using (true);
  drop policy if exists "port_aliases: admin all" on public.port_aliases;
  create policy "port_aliases: admin all" on public.port_aliases for all to authenticated
    using (public.fn_is_admin()) with check (public.fn_is_admin());
  drop policy if exists "port_areas: members read" on public.port_areas;
  create policy "port_areas: members read" on public.port_areas for select to authenticated using (true);
  drop policy if exists "port_areas: admin all" on public.port_areas;
  create policy "port_areas: admin all" on public.port_areas for all to authenticated
    using (public.fn_is_admin()) with check (public.fn_is_admin());
end $rls$;
grant select on public.port_aliases, public.port_areas to authenticated;
grant all    on public.port_aliases, public.port_areas to service_role;

drop trigger if exists trg_port_areas_updated_at on public.port_areas;
create trigger trg_port_areas_updated_at before update on public.port_areas
  for each row execute function public.fn_set_updated_at();

-- ── 3 · resolution ─────────────────────────────────────────────────────────
-- Single ports only. Ranges / alternatives stay null on purpose: that is what
-- separates a DEFECT (a name we can resolve but didn't) from broker language.
create or replace function public.fn_resolve_port_locode(p text)
 returns text language plpgsql stable
 set search_path to ''
as $function$
declare k text; v text;
begin
  if p is null then return null; end if;
  k := public.fn_port_strip_notation(p);
  if k = '' then return null; end if;
  -- an option list or an explicit range is not a single port
  if k ~* '\m(or|and|either|range|rge)\M' or position('/' in k) > 0 then return null; end if;
  k := public.fn_port_key(k);
  if k is null then return null; end if;

  -- an actual LOCODE
  select p2.locode into v from public.ports p2
   where p2.is_active and lower(replace(p2.locode, ' ', '')) = replace(k, ' ', '')
   limit 1;
  if v is not null then return v; end if;

  -- a known alias
  select coalesce(a.locode, (select p3.locode from public.ports p3
                              where p3.is_active and public.fn_port_key(p3.trade_name) = public.fn_port_key(a.canonical_name)
                              order by p3.is_verified desc, p3.locode limit 1))
    into v from public.port_aliases a where a.alias_key = k limit 1;
  if v is not null then return v; end if;

  -- the registry itself
  select p2.locode into v from public.ports p2
   where p2.is_active and public.fn_port_key(p2.trade_name) = k
   order by p2.is_verified desc, p2.locode limit 1;
  if v is not null then return v; end if;

  -- "Aliaga, Turkey" → first segment
  if position(',' in k) > 0 then
    select p2.locode into v from public.ports p2
     where p2.is_active and public.fn_port_key(p2.trade_name) = trim(split_part(k, ',', 1))
     order by p2.is_verified desc, p2.locode limit 1;
  end if;
  return v;
end $function$;

-- The area a phrase names, if any.
create or replace function public.fn_resolve_port_area(p text)
 returns public.port_areas language sql stable
 set search_path to ''
as $$
  select a.* from public.port_areas a
   where a.area_key = public.fn_port_key(public.fn_port_strip_notation(p))
      or public.fn_port_key(public.fn_port_strip_notation(p)) = any(a.alias_keys)
   limit 1;
$$;

-- ONE reading of a port field, shared by the trigger, the gate and the UI.
-- Returns {scope, locode, ref_locode, candidates, source, area_key}.
--   port    · a single known port; locode is authoritative
--   options · a list, at least one of which is a port; ref = the first
--   area    · a known area / country / range; ref = its nominated port
--   none    · nothing we can classify — this is what the gate refuses
create or replace function public.fn_resolve_port_side(p_code text, p_name text)
 returns jsonb language plpgsql stable
 set search_path to ''
as $function$
declare
  v_code  text := nullif(regexp_replace(upper(coalesce(p_code, '')), '\s+', '', 'g'), '');
  v_name  text := nullif(trim(coalesce(p_name, '')), '');
  v_opts  text[];
  v_cands text[] := '{}'::text[];
  v_c     text;
  v_hit   text;
  v_area  public.port_areas;
begin
  -- 1 · an explicit, known LOCODE always wins
  if v_code is not null and exists (
       select 1 from public.ports p where replace(upper(p.locode), ' ', '') = v_code) then
    return jsonb_build_object('scope', 'port', 'locode', v_code, 'ref_locode', v_code,
                              'candidates', to_jsonb(array[v_code]), 'source', 'locode');
  end if;

  if v_name is null then
    return jsonb_build_object('scope', 'none', 'locode', null, 'ref_locode', null,
                              'candidates', '[]'::jsonb, 'source', 'empty');
  end if;

  -- 2 · one named port (registry or alias)
  v_hit := public.fn_resolve_port_locode(v_name);
  if v_hit is not null then
    return jsonb_build_object('scope', 'port', 'locode', v_hit, 'ref_locode', v_hit,
                              'candidates', to_jsonb(array[v_hit]), 'source', 'name');
  end if;

  -- 3 · an option list — collect every option that IS a port
  v_opts := public.fn_port_options(v_name);
  if coalesce(array_length(v_opts, 1), 0) >= 2 then
    foreach v_c in array v_opts loop
      v_hit := public.fn_resolve_port_locode(v_c);
      if v_hit is not null and not (v_hit = any(v_cands)) then
        v_cands := v_cands || v_hit;
      end if;
    end loop;
    if coalesce(array_length(v_cands, 1), 0) >= 1 then
      return jsonb_build_object('scope', 'options', 'locode', null, 'ref_locode', v_cands[1],
                                'candidates', to_jsonb(v_cands), 'source', 'options');
    end if;
    -- 3b · a list of AREAS ("Algeria or Spain or Morocco") — first known area wins
    foreach v_c in array v_opts loop
      v_area := public.fn_resolve_port_area(v_c);
      if v_area.area_key is not null then
        return jsonb_build_object('scope', 'area', 'locode', null, 'ref_locode', v_area.ref_locode,
                                  'candidates', to_jsonb(v_area.candidate_locodes),
                                  'source', 'area_options', 'area_key', v_area.area_key);
      end if;
    end loop;
  end if;

  -- 4 · a known area / country / range
  v_area := public.fn_resolve_port_area(v_name);
  if v_area.area_key is not null then
    return jsonb_build_object('scope', 'area', 'locode', null, 'ref_locode', v_area.ref_locode,
                              'candidates', to_jsonb(v_area.candidate_locodes),
                              'source', 'area', 'area_key', v_area.area_key);
  end if;

  -- 5 · free text we cannot classify
  return jsonb_build_object('scope', 'none', 'locode', null, 'ref_locode', null,
                            'candidates', '[]'::jsonb, 'source', 'unclassified');
end $function$;

-- ── 4 · the listing carries its own answer ──────────────────────────────────
alter table public.cargo_listings
  add column if not exists load_port_scope  text,
  add column if not exists disch_port_scope text,
  add column if not exists load_ref_locode  text,
  add column if not exists disch_ref_locode text;

do $ck$
begin
  if not exists (select 1 from pg_constraint where conname = 'cargo_listings_load_scope_ck') then
    alter table public.cargo_listings add constraint cargo_listings_load_scope_ck
      check (load_port_scope is null or load_port_scope in ('port', 'options', 'area', 'none'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cargo_listings_disch_scope_ck') then
    alter table public.cargo_listings add constraint cargo_listings_disch_scope_ck
      check (disch_port_scope is null or disch_port_scope in ('port', 'options', 'area', 'none'));
  end if;
end $ck$;

comment on column public.cargo_listings.load_port_scope is
  'What the load side names: port | options | area | none. Set by fn_cl_port_autofill.';
comment on column public.cargo_listings.load_ref_locode is
  'Reference port feeding distance / Voy OPEX / Ports DA when load_port_locode is null. Always an estimate.';
comment on column public.cargo_listings.disch_port_scope is
  'What the discharge side names: port | options | area | none.';
comment on column public.cargo_listings.disch_ref_locode is
  'Reference port feeding distance / Voy OPEX / Ports DA when disch_port_locode is null. Always an estimate.';

-- The autofill trigger, now both directions.
create or replace function public.fn_cl_port_autofill()
 returns trigger language plpgsql
 set search_path to 'public'
as $function$
declare
  p ports%rowtype;
  r jsonb;
begin
  -- ── load side ────────────────────────────────────────────────────────────
  -- Resolve the side ONCE: name → LOCODE when the code is missing, and record
  -- the scope + reference port for the option-list and area shapes.
  if tg_op = 'INSERT'
     or old.load_port_locode is distinct from new.load_port_locode
     or old.load_port_name   is distinct from new.load_port_name
     or new.load_port_scope  is null then
    r := fn_resolve_port_side(new.load_port_locode, new.load_port_name);
    new.load_port_scope := r->>'scope';
    new.load_ref_locode := r->>'ref_locode';
    if new.load_port_locode is null and (r->>'locode') is not null then
      new.load_port_locode := r->>'locode';   -- the fix: a resolvable name gets its code
    end if;
  end if;
  if new.load_port_locode is not null
     and (tg_op = 'INSERT' or old.load_port_locode is distinct from new.load_port_locode) then
    select * into p from ports where locode = new.load_port_locode;
    if found then
      new.load_port_name := p.trade_name;
      new.load_zone      := p.zone;
      new.load_country   := p.country;
    end if;
  end if;

  -- ── discharge side ───────────────────────────────────────────────────────
  if tg_op = 'INSERT'
     or old.disch_port_locode is distinct from new.disch_port_locode
     or old.disch_port_name   is distinct from new.disch_port_name
     or new.disch_port_scope  is null then
    r := fn_resolve_port_side(new.disch_port_locode, new.disch_port_name);
    new.disch_port_scope := r->>'scope';
    new.disch_ref_locode := r->>'ref_locode';
    if new.disch_port_locode is null and (r->>'locode') is not null then
      new.disch_port_locode := r->>'locode';
    end if;
  end if;
  if new.disch_port_locode is not null
     and (tg_op = 'INSERT' or old.disch_port_locode is distinct from new.disch_port_locode) then
    select * into p from ports where locode = new.disch_port_locode;
    if found then
      new.disch_port_name := p.trade_name;
      new.disch_zone      := p.zone;
      new.disch_country   := p.country;
    end if;
  end if;

  -- A LOCODE already sitting in slot 2 is a usable reference port when slot 1
  -- names only an area (25 rows were hiding a good code there).
  if new.load_ref_locode is null and new.load_port_2_locode is not null then
    new.load_ref_locode := new.load_port_2_locode;
  end if;
  if new.disch_ref_locode is null and new.disch_port_2_locode is not null then
    new.disch_ref_locode := new.disch_port_2_locode;
  end if;

  -- ── unchanged: DG / grain flags and the spot marker ──────────────────────
  if new.commodity_id is not null
     and (tg_op = 'INSERT' or old.commodity_id is distinct from new.commodity_id) then
    select is_dg, is_grain into new.is_dg_cargo, new.is_grain_cargo
      from commodities where id = new.commodity_id;
  end if;
  if new.laycan_from is null then new.is_spot := true; else new.is_spot := false; end if;

  return new;
end;
$function$;

-- ── 5 · seed the dictionaries ───────────────────────────────────────────────
-- Aliases: the two hardcoded lists, plus every shorthand the live data uses.
insert into public.port_aliases (alias_key, alias_text, locode, canonical_name, note) values
  ('novo',                 'Novo',                 null, 'Novorossiysk', 'broker shorthand'),
  ('novoross',             'Novoross',             null, 'Novorossiysk', 'broker shorthand'),
  ('constantza',           'Constantza',           null, 'Constanta',    'spelling variant'),
  ('konstanza',            'Konstanza',            null, 'Constanta',    'spelling variant'),
  ('burgas',               'Burgas',               null, 'Bourgas',      'spelling variant'),
  ('apapa',                'Apapa',                null, 'Lagos',        'terminal within Lagos'),
  ('alarish',              'AlArish',              null, 'El Arish',     'spelling variant'),
  ('alex',                 'Alex',                 null, 'Alexandria',   'broker shorthand'),
  ('jeddah port',          'Jeddah Port',          null, 'Jeddah',       'suffix variant'),
  ('jeddah islamic port',  'Jeddah Islamic Port',  null, 'Jeddah',       'official name'),
  ('orlovka',              'Orlovka',              null, 'Orlivka',      'Russian transliteration of the Ukrainian Danube port'),
  ('bik',                  'BIK',                  null, 'Bandar Imam Khomeini', 'trade abbreviation'),
  ('isk',                  'Isk',                  null, 'Iskenderun',   'broker shorthand'),
  ('nea peramos',          'Nea Peramos',          null, 'Nea Peramos',  'case variant'),
  ('san lorenzo argentina','San Lorenzo (Argentina)', null, 'San Lorenzo', 'country qualifier')
on conflict (alias_key) do nothing;

-- Areas: every non-port place name the live listings use, with a nominated
-- reference port. The owner refines these in Admin → Data quality → Ports.
insert into public.port_areas (area_key, area_name, kind, zone, ref_locode, candidate_locodes, alias_keys, note) values
  ('egypt med',        'Egypt Med',         'area',    'E.MED',    'EGALY', array['EGALY','EGDKH','EGDAM','EGPSD'], array['egypt mediterranean'], 'main Med discharge range'),
  ('egypt',            'Egypt',             'country', 'E.MED',    'EGALY', array['EGALY','EGDKH','EGDAM','EGPSD','EGSOK'], '{}', null),
  ('greece',           'Greece',            'country', 'E.MED',    'GRPIR', array['GRPIR','GRSKG','GRVOL','GRKVA'], '{}', null),
  ('marmara',          'Marmara',           'area',    'E.MED',    'TRIZT', array['TRIZT','TRGEM','TRBDM','TRTEK','TRMAR'], '{}', 'Sea of Marmara range'),
  ('spain med',        'Spain Med',         'area',    'W.MED',    'ESTRG', array['ESTRG','ESBCN','ESCAS','ESSAG','ESALI'], array['spainmed','spain mediterranean'], null),
  ('spain',            'Spain',             'country', 'W.MED',    'ESTRG', array['ESTRG','ESBCN','ESCAS','ESSAG'], '{}', null),
  ('north spain',      'North Spain',       'area',    'NCONT',    'ESSAN', array['ESSAN','ESGIJ','ESLCG','ESAVI','ESFRO'], array['n spain'], null),
  ('tunisia',          'Tunisia',           'country', 'C.MED',    'TNTUN', array['TNTUN','TNBIZ','TNSFA','TNSUS','TNGAE'], '{}', null),
  ('libya',            'Libya',             'country', 'C.MED',    'LYMIS', array['LYMIS','LYTIP','LYBGN','LYTOB'], array['lybia','libia'], 'spelling variants seen in circulars'),
  ('lebanon',          'Lebanon',           'country', 'E.MED',    'LBBEY', array['LBBEY','LBKYE','LBSAI'], '{}', null),
  ('algeria',          'Algeria',           'country', 'W.MED',    'DZALG', array['DZALG','DZSKI','DZBJA','DZORN','DZAAE'], '{}', null),
  ('syria',            'Syria',             'country', 'E.MED',    'SYLTK', array['SYLTK','SYTAR','SYBAN'], '{}', null),
  ('turkey',           'Turkey',            'country', 'E.MED',    'TRIZM', array['TRIZM','TRIST','TRMER','TRISK','TRIZT'], '{}', null),
  ('turk med',         'Turkish Med',       'area',    'E.MED',    'TRMER', array['TRMER','TRISK','TRALI','TRIZM'], array['turkish med','turkey med'], null),
  ('turkish black sea','Turkish Black Sea', 'area',    'B.SEA',    'TRSSX', array['TRSSX','TRTZX','TRERE','TRBAR','TRFAT'], array['turkish blsea','turkey black sea'], null),
  ('italy',            'Italy',             'country', 'C.MED',    'ITRAN', array['ITRAN','ITNAP','ITGOA','ITTAR','ITANX'], '{}', null),
  ('west italy',       'West Italy',        'area',    'C.MED',    'ITNAP', array['ITNAP','ITGOA','ITCIV','ITSVN','ITSAL'], array['w italy','italy tyrrhenian'], null),
  ('n italy',          'N Italy (Adriatic)','area',    'ADRIATIC', 'ITRAN', array['ITRAN','ITMNF','ITPMA','ITCHI','ITPNG'], array['north italy','n italy adriatic'], null),
  ('n adriatic',       'N Adriatic',        'area',    'ADRIATIC', 'ITRAN', array['ITRAN','ITMNF','ITPMA','ITPNG'], array['north adriatic','upper adriatic'], null),
  ('adriatic',         'Adriatic',          'area',    'ADRIATIC', 'ITRAN', array['ITRAN','ITBRI','ITANX','ITBDS'], '{}', null),
  ('central med',      'Central Med',       'area',    'C.MED',    'ITNAP', array['ITNAP','ITTAR','TNTUN','LYMIS'], array['centeral med','c med','cent med'], 'includes the "CENTERAL MED" typo seen in circulars'),
  ('crete',            'Crete',             'area',    'E.MED',    'GRANI', array['GRANI','GRRET'], '{}', null),
  ('sardinia',         'Sardinia',          'area',    'W.MED',    'ITOLB', array['ITOLB','ITQOS'], '{}', null),
  ('cyprus',           'Cyprus',            'country', 'E.MED',    'CYLCA', array['CYLCA','CYFAM'], '{}', null),
  ('israel',           'Israel',            'country', 'E.MED',    null,    '{}', '{}', 'no Israeli port in the registry yet — pick a port to route'),
  ('kuwait',           'Kuwait',            'country', 'AG',       'KWSWK', array['KWSWK'], '{}', null),
  ('morocco',          'Morocco',           'country', 'W.MED',    'MACAS', array['MACAS','MAJLF','MASFI','MAAGA','MANDR'], '{}', null),
  ('morocco med',      'Morocco Med',       'area',    'W.MED',    'MANDR', array['MANDR','MATNG'], '{}', null),
  ('ukraine',          'Ukraine',           'country', 'B.SEA',    'UAODS', array['UAODS','UAILK','UAYUZ','UAIZM','UAREN'], '{}', null),
  ('russia',           'Russia',            'country', 'B.SEA',    'RUNOI', array['RUNOI','RUTUA','RUROV','RUTMN'], '{}', null),
  ('russian blsea',    'Russian Black Sea', 'area',    'B.SEA',    'RUNOI', array['RUNOI','RUTUA','RUTMK','RUKVZ'], array['russia black sea','russian black sea'], null),
  ('north china',      'North China',       'area',    'F.EAST',   'CNDLC', array['CNDLC','CNDDG','CNTGS','CNRIZ'], array['n china'], null),
  ('ec india',         'EC India',          'area',    'ECI',      'INMAA', array['INMAA','INCCU','INGGV','INVTZ'], array['east coast india'], null),
  ('wc india',         'WC India',          'area',    'WCI',      'INMED', array['INMED','INIXY','INHZA','INDAH','INIXE'], array['west coast india'], null),
  ('west africa',      'West Africa',       'area',    'WCAF',     'NGLOS', array['NGLOS','NGONN','NGAPP','NGPHC'], array['w africa','wafr'], null),
  ('red sea',          'Red Sea',           'area',    'R.SEA',    'SAJED', array['SAJED','SAYAN','SAKAC','EGSGA','SAGIZ'], '{}', null),
  ('upriver argentina','Upriver Argentina', 'area',    'ECSA',     'ARSLO', array['ARSLO','ARROS'], array['up river argentina','upriver'], 'San Lorenzo / Rosario upriver range'),
  ('arag',             'ARAG',              'range',   'NCONT',    'NLRTM', array['NLRTM','BEANR'], array['ara','amsterdam rotterdam antwerp ghent'], 'Amsterdam–Rotterdam–Antwerp–Ghent range')
on conflict (area_key) do nothing;

-- Keep only reference / candidate ports that really exist in the registry.
update public.port_areas a set ref_locode = null
 where a.ref_locode is not null
   and not exists (select 1 from public.ports p where p.locode = a.ref_locode);
update public.port_areas a
   set candidate_locodes = coalesce((
         select array_agg(c order by c) from unnest(a.candidate_locodes) c
          where exists (select 1 from public.ports p where p.locode = c)), '{}'::text[]);

-- ── 6 · backfill ────────────────────────────────────────────────────────────
-- The match refresher runs per row; hold it off for the backfill and then
-- refresh only the listings whose LOCODE actually changed.
create temporary table _cl_before on commit drop as
  select id, load_port_locode lp, disch_port_locode dp from public.cargo_listings;

alter table public.cargo_listings disable trigger trg_matches_on_cargo;

-- null the scopes so the trigger's "scope is null" branch recomputes every row
update public.cargo_listings set load_port_scope = null, disch_port_scope = null;

alter table public.cargo_listings enable trigger trg_matches_on_cargo;

do $refresh$
declare v_id uuid;
begin
  for v_id in
    select c.id from public.cargo_listings c join _cl_before b on b.id = c.id
     where c.load_port_locode is distinct from b.lp or c.disch_port_locode is distinct from b.dp
  loop
    perform public.fn_refresh_matches_for_cargo(v_id);
  end loop;
end $refresh$;
