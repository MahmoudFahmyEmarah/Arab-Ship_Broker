-- Suez / Voyage governance (Voyage Economics, Stream S; answers audit O2C-022 /
-- O2C-024, 4 Oct 2026). Additive on top of 200000–204000:
--   · governed source records with file hashes, cited by tariff versions;
--   · an event log for versions, items, tiers, SDR rates and profiles;
--   · tighter immutability: non-draft versions change only their window,
--     notes and allowed status; no DELETE; children frozen for every
--     non-draft status; SDR rates append-only, voided by a new row;
--   · publish-time validation of item params and contiguous toll bands;
--   · no future SDR rate ever selected;
--   · ECA zones carry geometry version, source, hash and confidence; the
--     route split takes an as-of date and walks the canonical get_port_route
--     waypoints (aliases, direction rules), returning versions;
--   · member access to eca_zones only through list_eca_zones();
--   · vessel economics profile: actor = fn_market_actor(), unknown facts are
--     NULL, every change is logged with before/after.

-- ── 1 · Sources and events ──────────────────────────────────────────────────

create table if not exists public.suez_tariff_sources (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (length(trim(title)) between 2 and 300),
  issuer          text not null check (length(trim(issuer)) between 2 and 120),
  document_no     text,
  issue_date      date,
  effective_from  date,
  authority       text not null check (authority in ('official','agent','reference','owner')),
  evidence_status text not null default 'pending_document' check (evidence_status in ('on_file','pending_document')),
  sha256          text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  source_filename text,
  byte_size       bigint check (byte_size is null or byte_size > 0),
  source_uri      text,
  notes           text,
  registered_by   uuid references public.users(id) on delete set null,
  registered_at   timestamptz not null default now(),
  constraint suez_tariff_sources_evidence_ck check (evidence_status <> 'on_file' or sha256 is not null)
);

create table if not exists public.suez_tariff_version_sources (
  version_id uuid not null references public.suez_tariff_versions(id) on delete cascade,
  source_id  uuid not null references public.suez_tariff_sources(id) on delete restrict,
  primary key (version_id, source_id)
);

create table if not exists public.suez_tariff_events (
  id            bigserial primary key,
  entity        text not null check (entity in ('version','item','tier','sdr_rate','source','seed','eca_zone','settings')),
  entity_id     uuid,
  version_id    uuid,
  action        text not null check (action ~ '^[a-z][a-z0-9_]{1,40}$'),
  actor_user_id uuid references public.users(id) on delete set null,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists suez_tariff_events_version_idx on public.suez_tariff_events (version_id, created_at);

alter table public.suez_tariff_sources enable row level security;
alter table public.suez_tariff_version_sources enable row level security;
alter table public.suez_tariff_events enable row level security;
revoke all on table public.suez_tariff_sources, public.suez_tariff_version_sources, public.suez_tariff_events from public, anon, authenticated;
grant all on table public.suez_tariff_sources, public.suez_tariff_version_sources to service_role;
grant select, insert on table public.suez_tariff_events to service_role;
grant usage, select on sequence public.suez_tariff_events_id_seq to service_role;

-- Events are append-only for everyone, including the service role.
create or replace function public.fn_suez_events_append_only()
returns trigger language plpgsql set search_path = pg_catalog, public as $ev$
begin
  raise exception 'SUEZ_IMMUTABLE: tariff events are append-only' using errcode = '55000';
end; $ev$;
revoke all on function public.fn_suez_events_append_only() from public, anon, authenticated;
drop trigger if exists trg_suez_events_append_only on public.suez_tariff_events;
create trigger trg_suez_events_append_only before update or delete on public.suez_tariff_events for each row execute function public.fn_suez_events_append_only();

-- ── 2 · Version guards: window/notes/status only; no delete; validation on publish ──

create or replace function public.fn_suez_validate_version(p_version_id uuid)
returns void
language plpgsql
stable
set search_path = pg_catalog, public
as $validate$
declare
  it record;
  g record;
  prev_to numeric;
  n integer;
  t jsonb;
  prev_tier_to numeric;
begin
  select count(*) into n from public.suez_tariff_items where version_id = p_version_id and is_active;
  if n = 0 then raise exception 'SUEZ_INVALID: a version needs at least one active item' using errcode = '23514'; end if;

  for it in select * from public.suez_tariff_items where version_id = p_version_id and is_active loop
    if it.layer = 'conditional' and it.condition_key is null then
      raise exception 'SUEZ_INVALID: item % is conditional without a condition key', it.code using errcode = '23514';
    end if;
    if it.layer = 'toll' and it.basis <> 'toll_tiered_scnt' then
      raise exception 'SUEZ_INVALID: item % in the toll layer must use toll_tiered_scnt', it.code using errcode = '23514';
    end if;
    case it.basis
      when 'flat' then
        if jsonb_typeof(it.params -> 'amount') <> 'number' or (it.params ->> 'amount')::numeric < 0 then
          raise exception 'SUEZ_INVALID: item % (flat) needs a non-negative numeric amount', it.code using errcode = '23514';
        end if;
      when 'pct_of_toll' then
        if not (jsonb_typeof(it.params -> 'pct') = 'number'
                or jsonb_typeof(it.params -> 'pctPerUnit') = 'number'
                or (jsonb_typeof(it.params -> 'bands') = 'array' and jsonb_array_length(it.params -> 'bands') > 0)) then
          raise exception 'SUEZ_INVALID: item % (pct_of_toll) needs pct, pctPerUnit or bands', it.code using errcode = '23514';
        end if;
      when 'tier_by_scnt' then
        if jsonb_typeof(it.params -> 'tiers') <> 'array' or jsonb_array_length(it.params -> 'tiers') = 0 then
          raise exception 'SUEZ_INVALID: item % (tier_by_scnt) needs tiers', it.code using errcode = '23514';
        end if;
        prev_to := 0;
        for t in select value from jsonb_array_elements(it.params -> 'tiers') loop
          if (t ->> 'from')::numeric <> prev_to then
            raise exception 'SUEZ_INVALID: item % tiers must be contiguous from 0 (band starting at % after %)', it.code, t ->> 'from', prev_to using errcode = '23514';
          end if;
          if jsonb_typeof(t -> 'amount') <> 'number' or jsonb_typeof(t -> 'includedUnits') <> 'number' then
            raise exception 'SUEZ_INVALID: item % tier needs numeric amount and includedUnits', it.code using errcode = '23514';
          end if;
          if t -> 'to' is null or jsonb_typeof(t -> 'to') = 'null' then prev_to := null; exit; end if;
          prev_to := (t ->> 'to')::numeric;
        end loop;
      when 'per_unit' then
        if jsonb_typeof(it.params -> 'rate') <> 'number' or jsonb_typeof(it.params -> 'unit') <> 'string' then
          raise exception 'SUEZ_INVALID: item % (per_unit) needs rate and unit', it.code using errcode = '23514';
        end if;
      when 'gt_threshold' then
        if jsonb_typeof(it.params -> 'threshold') <> 'number' or jsonb_typeof(it.params -> 'below') <> 'number' or jsonb_typeof(it.params -> 'atOrAbove') <> 'number' then
          raise exception 'SUEZ_INVALID: item % (gt_threshold) needs threshold, below, atOrAbove', it.code using errcode = '23514';
        end if;
      else null;
    end case;
    -- Conditions with tariff-defined thresholds must carry them (no constants in code).
    if it.condition_key = 'no_mooring_cranes' and (jsonb_typeof(it.params -> 'gtThreshold') <> 'number' or jsonb_typeof(it.params -> 'swlMt') <> 'number' or jsonb_typeof(it.params -> 'boats') <> 'number') then
      raise exception 'SUEZ_INVALID: item % needs gtThreshold, swlMt and boats in params', it.code using errcode = '23514';
    end if;
    if it.condition_key = 'overage' and jsonb_typeof(it.params -> 'ageYears') <> 'number' then
      raise exception 'SUEZ_INVALID: item % needs ageYears in params', it.code using errcode = '23514';
    end if;
  end loop;

  -- Toll bands: per (category, status) contiguous from 0, open-ended band last.
  for g in select vessel_category, cargo_status from public.suez_toll_tiers where version_id = p_version_id group by 1, 2 loop
    prev_tier_to := 0;
    for it in select * from public.suez_toll_tiers where version_id = p_version_id and vessel_category = g.vessel_category and cargo_status = g.cargo_status order by tier_order loop
      if prev_tier_to is null then
        raise exception 'SUEZ_INVALID: % %: a band follows an open-ended band', g.vessel_category, g.cargo_status using errcode = '23514';
      end if;
      if it.scnt_from <> prev_tier_to then
        raise exception 'SUEZ_INVALID: % %: band % starts at % but the previous band ends at %', g.vessel_category, g.cargo_status, it.tier_order, it.scnt_from, prev_tier_to using errcode = '23514';
      end if;
      prev_tier_to := it.scnt_to;
    end loop;
  end loop;
end;
$validate$;
revoke all on function public.fn_suez_validate_version(uuid) from public, anon, authenticated;
grant execute on function public.fn_suez_validate_version(uuid) to service_role;

create or replace function public.fn_suez_version_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $suez_guard$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'SUEZ_IMMUTABLE: only draft versions can be deleted' using errcode = '55000';
    end if;
    return old;
  end if;
  if old.status = 'draft' then
    if new.status not in ('draft','published','withdrawn') then
      raise exception 'SUEZ_IMMUTABLE: a draft may only be published or withdrawn' using errcode = '55000';
    end if;
    if new.status = 'published' then
      perform public.fn_suez_validate_version(new.id);
      if new.published_at is null then new.published_at := now(); end if;
    end if;
    return new;
  end if;
  -- Non-draft: only the window end, the notes and the status may change.
  if new.version_no <> old.version_no or new.effective_from <> old.effective_from or new.source_ref <> old.source_ref
     or new.source_url is distinct from old.source_url or new.created_by is distinct from old.created_by
     or new.created_at <> old.created_at or new.published_by is distinct from old.published_by
     or new.published_at is distinct from old.published_at then
    raise exception 'SUEZ_IMMUTABLE: a % version only accepts effective_to, notes and a status transition', old.status using errcode = '55000';
  end if;
  if new.status <> old.status then
    if not (old.status = 'published' and new.status in ('superseded','withdrawn')) then
      raise exception 'SUEZ_IMMUTABLE: % → % is not an allowed transition', old.status, new.status using errcode = '55000';
    end if;
  end if;
  return new;
end;
$suez_guard$;
drop trigger if exists trg_suez_version_guard on public.suez_tariff_versions;
create trigger trg_suez_version_guard before update or delete on public.suez_tariff_versions for each row execute function public.fn_suez_version_guard();

create or replace function public.fn_suez_children_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $suez_children$
declare
  v_status text;
  v_version uuid := coalesce(new.version_id, old.version_id);
begin
  if tg_op = 'UPDATE' and new.version_id <> old.version_id then
    raise exception 'SUEZ_IMMUTABLE: items and tiers cannot move between versions' using errcode = '55000';
  end if;
  select status into v_status from public.suez_tariff_versions where id = v_version;
  -- A delete whose parent is already gone is the cascade of a (draft) version delete, which the version guard allowed.
  if tg_op = 'DELETE' and v_status is null then
    return old;
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'SUEZ_IMMUTABLE: items and tiers of a % version cannot change; create a new version', coalesce(v_status, 'missing') using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$suez_children$;

-- Status changes are logged by trigger with the actor the action stamped.
create or replace function public.fn_suez_version_events()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $vev$
begin
  if tg_op = 'INSERT' then
    insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
    values ('version', new.id, new.id, 'created', new.created_by, jsonb_build_object('versionNo', new.version_no, 'effectiveFrom', new.effective_from, 'effectiveTo', new.effective_to, 'sourceRef', new.source_ref));
  elsif tg_op = 'UPDATE' then
    if new.status <> old.status then
      insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
      values ('version', new.id, new.id, new.status, coalesce(new.published_by, public.fn_market_actor()), jsonb_build_object('from', old.status, 'to', new.status, 'versionNo', new.version_no));
    end if;
    if new.effective_to is distinct from old.effective_to then
      insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
      values ('version', new.id, new.id, 'window_changed', public.fn_market_actor(), jsonb_build_object('from', old.effective_to, 'to', new.effective_to));
    end if;
  elsif tg_op = 'DELETE' then
    insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
    values ('version', old.id, null, 'draft_deleted', public.fn_market_actor(), jsonb_build_object('versionNo', old.version_no));
  end if;
  return coalesce(new, old);
end;
$vev$;
revoke all on function public.fn_suez_version_events() from public, anon, authenticated;
drop trigger if exists trg_suez_version_events on public.suez_tariff_versions;
create trigger trg_suez_version_events after insert or update or delete on public.suez_tariff_versions for each row execute function public.fn_suez_version_events();

-- ── 3 · SDR rates: append-only, voided by a marker row ─────────────────────

alter table public.sdr_rates add column if not exists voided_at timestamptz;
alter table public.sdr_rates add column if not exists void_reason text;
alter table public.sdr_rates add column if not exists voided_by uuid references public.users(id) on delete set null;
-- A corrected rate for the same day is a new row; drop the one-per-day uniqueness.
alter table public.sdr_rates drop constraint if exists sdr_rates_as_of_key;
create index if not exists sdr_rates_as_of_idx on public.sdr_rates (as_of desc, created_at desc) where voided_at is null;

create or replace function public.fn_sdr_rates_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $sdr_guard$
begin
  if tg_op = 'DELETE' then
    raise exception 'SUEZ_IMMUTABLE: SDR rates are never deleted; void the row' using errcode = '55000';
  end if;
  if old.voided_at is not null then
    raise exception 'SUEZ_IMMUTABLE: a voided SDR rate cannot change' using errcode = '55000';
  end if;
  if new.rate_usd <> old.rate_usd or new.as_of <> old.as_of or new.source <> old.source or new.created_at <> old.created_at
     or new.created_by is distinct from old.created_by or new.notes is distinct from old.notes then
    raise exception 'SUEZ_IMMUTABLE: SDR rates only accept voiding (voided_at, void_reason, voided_by)' using errcode = '55000';
  end if;
  if new.voided_at is null or new.void_reason is null or length(trim(new.void_reason)) < 3 then
    raise exception 'SUEZ_INVALID: voiding needs voided_at and a reason' using errcode = '23514';
  end if;
  insert into public.suez_tariff_events (entity, entity_id, action, actor_user_id, details)
  values ('sdr_rate', new.id, 'voided', coalesce(new.voided_by, public.fn_market_actor()), jsonb_build_object('asOf', new.as_of, 'rateUsd', new.rate_usd, 'reason', new.void_reason));
  return new;
end;
$sdr_guard$;
revoke all on function public.fn_sdr_rates_guard() from public, anon, authenticated;
drop trigger if exists trg_sdr_rates_guard on public.sdr_rates;
create trigger trg_sdr_rates_guard before update or delete on public.sdr_rates for each row execute function public.fn_sdr_rates_guard();

create or replace function public.fn_sdr_rates_events()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $sdr_ev$
begin
  insert into public.suez_tariff_events (entity, entity_id, action, actor_user_id, details)
  values ('sdr_rate', new.id, 'recorded', coalesce(new.created_by, public.fn_market_actor()), jsonb_build_object('asOf', new.as_of, 'rateUsd', new.rate_usd, 'source', new.source));
  return new;
end;
$sdr_ev$;
revoke all on function public.fn_sdr_rates_events() from public, anon, authenticated;
drop trigger if exists trg_sdr_rates_events on public.sdr_rates;
create trigger trg_sdr_rates_events after insert on public.sdr_rates for each row execute function public.fn_sdr_rates_events();

-- ── 4 · Context read: cited sources, no future rate, versions in the payload ──

create or replace function public.get_suez_tariff_context(p_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $suez_ctx$
declare
  v_date date := coalesce(p_date, current_date);
  v_version public.suez_tariff_versions%rowtype;
  v_items jsonb;
  v_tiers jsonb;
  v_sdr jsonb;
  v_sources jsonb;
  v_settings jsonb;
begin
  select * into v_version
    from public.suez_tariff_versions v
   where v.status = 'published'
     and v.effective_from <= v_date
     and (v.effective_to is null or v.effective_to >= v_date)
   order by v.effective_from desc, v.version_no desc
   limit 1;
  if not found then
    return jsonb_build_object('found', false, 'date', v_date);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', i.code, 'labelEn', i.label_en, 'labelAr', i.label_ar, 'layer', i.layer,
           'basis', i.basis, 'currency', i.currency, 'params', i.params,
           'directionScope', i.direction_scope, 'cargoStatusScope', i.cargo_status_scope,
           'conditionKey', i.condition_key, 'payerParty', i.payer_party, 'sortOrder', i.sort_order,
           'notes', i.notes) order by i.sort_order, i.code), '[]'::jsonb)
    into v_items from public.suez_tariff_items i where i.version_id = v_version.id and i.is_active;

  select coalesce(jsonb_agg(jsonb_build_object(
           'vesselCategory', t.vessel_category, 'cargoStatus', t.cargo_status, 'tierOrder', t.tier_order,
           'scntFrom', t.scnt_from, 'scntTo', t.scnt_to, 'sdrPerScnt', t.sdr_per_scnt, 'confidence', t.confidence)
           order by t.vessel_category, t.cargo_status, t.tier_order), '[]'::jsonb)
    into v_tiers from public.suez_toll_tiers t where t.version_id = v_version.id;

  -- The latest non-voided rate dated on or before the transit date; none → null (unavailable).
  select jsonb_build_object('id', r.id, 'rateUsd', r.rate_usd, 'asOf', r.as_of, 'source', r.source, 'notes', r.notes)
    into v_sdr
    from public.sdr_rates r
   where r.as_of <= v_date and r.voided_at is null
   order by r.as_of desc, r.created_at desc
   limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'title', s.title, 'issuer', s.issuer, 'documentNo', s.document_no, 'issueDate', s.issue_date,
           'authority', s.authority, 'evidenceStatus', s.evidence_status, 'sha256', s.sha256) order by s.issue_date nulls last, s.title), '[]'::jsonb)
    into v_sources
    from public.suez_tariff_version_sources vs join public.suez_tariff_sources s on s.id = vs.source_id
   where vs.version_id = v_version.id;

  select s.value into v_settings from public.app_settings s where s.key = 'voyage_settings';

  return jsonb_build_object(
    'found', true,
    'date', v_date,
    'version', jsonb_build_object(
      'id', v_version.id, 'versionNo', v_version.version_no,
      'effectiveFrom', v_version.effective_from, 'effectiveTo', v_version.effective_to,
      'sourceRef', v_version.source_ref, 'sourceUrl', v_version.source_url, 'notes', v_version.notes,
      'publishedAt', v_version.published_at),
    'sources', v_sources,
    'items', v_items,
    'tiers', v_tiers,
    'sdr', v_sdr,
    'suezDays', coalesce(v_settings -> 'suez', '{}'::jsonb),
    'algorithmVersion', 'suez-engine/2'
  );
end;
$suez_ctx$;

-- ── 5 · ECA zones: versioned, sourced, no direct member read; as-of split over the canonical route ──

alter table public.eca_zones add column if not exists geometry_version text not null default 'v1';
alter table public.eca_zones add column if not exists source_ref text;
alter table public.eca_zones add column if not exists source_url text;
alter table public.eca_zones add column if not exists sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$');
alter table public.eca_zones add column if not exists confidence text not null default 'coarse' check (confidence in ('official','coarse'));
alter table public.eca_zones add column if not exists effective_to date;
alter table public.eca_zones add column if not exists updated_by uuid references public.users(id) on delete set null;
alter table public.eca_zones add column if not exists updated_at timestamptz not null default now();

update public.eca_zones
   set geometry_version = 'MED-2026-10-04-r1',
       source_ref = 'MARPOL Annex VI reg. 14.3; IMO resolution MEPC.361(79) designating the Mediterranean Sea SOx ECA (0.10 % from 1 May 2025). Ring: coarse coastal digitisation by the platform (not an official boundary file).',
       source_url = 'https://www.imo.org/en/OurWork/Environment/Pages/Emission-Control-Areas-(ECAs)-designated-under-regulation-13-of-MARPOL-Annex-VI-(NOx-emission-control).aspx',
       confidence = 'coarse'
 where code = 'MED' and geometry_version = 'v1';

drop policy if exists "eca: members read active" on public.eca_zones;
revoke all on table public.eca_zones from public, anon, authenticated;

create or replace function public.list_eca_zones(p_as_of date default current_date)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $list_eca$
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', z.code, 'name', z.name, 'geometryVersion', z.geometry_version, 'confidence', z.confidence,
           'sulphurLimitPct', z.sulphur_limit_pct, 'effectiveFrom', z.effective_from, 'effectiveTo', z.effective_to,
           'points', jsonb_array_length(z.polygon), 'sourceRef', z.source_ref, 'sourceUrl', z.source_url)
           order by z.code), '[]'::jsonb)
    from public.eca_zones z
   where z.is_active and z.effective_from <= coalesce(p_as_of, current_date)
     and (z.effective_to is null or z.effective_to >= coalesce(p_as_of, current_date));
$list_eca$;
revoke all on function public.list_eca_zones(date) from public, anon;
grant execute on function public.list_eca_zones(date) to authenticated, service_role;

drop function if exists public.fn_route_eca_split(text, text);
create or replace function public.fn_route_eca_split(p_pol text, p_pod text, p_as_of date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $split$
declare
  v_as_of date := coalesce(p_as_of, current_date);
  v_route jsonb;
  v_wps jsonb;
  v_zone record;
  v_wp jsonb;
  v_lat numeric; v_lon numeric; v_nm numeric;
  v_have_prev boolean;
  v_prev_nm numeric;
  v_in_prev boolean;
  v_in_cur boolean;
  v_seg numeric;
  v_eca numeric;
  v_total numeric := 0;
  v_by jsonb := '{}'::jsonb;
  v_versions jsonb := '[]'::jsonb;
  v_total_nm numeric;
begin
  -- Canonical resolution: aliases, direction-specific tracks and the reversal
  -- rule all live in get_port_route; this function never reads port_routes itself.
  v_route := public.get_port_route(p_pol, p_pod);
  if v_route is null or coalesce((v_route ->> 'found')::boolean, false) = false then
    return jsonb_build_object('found', false, 'asOf', v_as_of, 'algorithmVersion', 'fn_route_eca_split/2');
  end if;
  v_total_nm := (v_route ->> 'total_nm')::numeric;
  v_wps := coalesce(v_route -> 'waypoints', '[]'::jsonb);
  if jsonb_array_length(v_wps) < 2 then
    return jsonb_build_object('found', true, 'asOf', v_as_of, 'totalNm', v_total_nm, 'ecaNm', null, 'byZone', '{}'::jsonb,
                              'geometryVersions', '[]'::jsonb, 'method', 'distance_only', 'algorithmVersion', 'fn_route_eca_split/2',
                              'chokepoints', coalesce(v_route -> 'chokepoints', '[]'::jsonb), 'reversed', v_route -> 'reversed',
                              'directionSpecific', v_route -> 'direction_specific', 'source', v_route ->> 'source');
  end if;

  for v_zone in
    select code, polygon, geometry_version from public.eca_zones
     where is_active and effective_from <= v_as_of and (effective_to is null or effective_to >= v_as_of)
     order by code
  loop
    v_eca := 0; v_have_prev := false; v_prev_nm := null; v_in_prev := false;
    for v_wp in select value from jsonb_array_elements(v_wps) loop
      v_lat := (v_wp ->> 0)::numeric; v_lon := (v_wp ->> 1)::numeric;
      v_nm := case when jsonb_typeof(v_wp -> 2) = 'number' then (v_wp ->> 2)::numeric else null end;
      v_in_cur := coalesce(public.fn_point_in_ring(v_lat, v_lon, v_zone.polygon), false);
      if v_have_prev and v_nm is not null and v_prev_nm is not null then
        v_seg := greatest(v_nm - v_prev_nm, 0);
        if v_in_cur and v_in_prev then v_eca := v_eca + v_seg;
        elsif v_in_cur or v_in_prev then v_eca := v_eca + v_seg / 2;
        end if;
      end if;
      v_have_prev := true; v_prev_nm := v_nm; v_in_prev := v_in_cur;
    end loop;
    v_by := v_by || jsonb_build_object(v_zone.code, round(v_eca, 1));
    v_versions := v_versions || jsonb_build_object('code', v_zone.code, 'geometryVersion', v_zone.geometry_version);
    v_total := v_total + v_eca;
  end loop;

  return jsonb_build_object(
    'found', true, 'asOf', v_as_of, 'totalNm', v_total_nm,
    'ecaNm', round(least(v_total, v_total_nm), 1), 'byZone', v_by,
    'geometryVersions', v_versions, 'method', 'waypoints', 'algorithmVersion', 'fn_route_eca_split/2',
    'waypointCount', jsonb_array_length(v_wps),
    'chokepoints', coalesce(v_route -> 'chokepoints', '[]'::jsonb),
    'reversed', v_route -> 'reversed', 'directionSpecific', v_route -> 'direction_specific', 'source', v_route ->> 'source');
end;
$split$;
revoke all on function public.fn_route_eca_split(text, text, date) from public, anon;
grant execute on function public.fn_route_eca_split(text, text, date) to authenticated, service_role;

-- ── 6 · Vessel economics profile: unknown facts, canonical actor, event log ──

alter table public.vessel_economics_profiles alter column first_transit drop not null;
alter table public.vessel_economics_profiles alter column first_transit drop default;
alter table public.vessel_economics_profiles alter column has_scrubber drop not null;
alter table public.vessel_economics_profiles alter column has_scrubber drop default;

create table if not exists public.vessel_economics_profile_events (
  id            bigserial primary key,
  vessel_id     uuid not null references public.vessels(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  action        text not null check (action in ('created','updated')),
  before        jsonb,
  after         jsonb not null,
  created_at    timestamptz not null default now()
);
create index if not exists vessel_economics_profile_events_vessel_idx on public.vessel_economics_profile_events (vessel_id, created_at);
alter table public.vessel_economics_profile_events enable row level security;
revoke all on table public.vessel_economics_profile_events from public, anon, authenticated;
grant select, insert on table public.vessel_economics_profile_events to service_role;
grant usage, select on sequence public.vessel_economics_profile_events_id_seq to service_role;
drop trigger if exists trg_vep_events_append_only on public.vessel_economics_profile_events;
create trigger trg_vep_events_append_only before update or delete on public.vessel_economics_profile_events for each row execute function public.fn_suez_events_append_only();

create or replace function public.upsert_vessel_economics_profile(p_vessel_id uuid, p_profile jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $upsert_profile$
declare
  v_actor uuid := public.fn_market_actor();
  v_states text[] := array['sea_laden','sea_ballast','port_working','port_idle','anchorage','eca_sea'];
  v_cons jsonb := '{}'::jsonb;
  v_state text;
  v_entry jsonb;
  v_res numeric;
  v_dis numeric;
  v_before jsonb;
  v_after jsonb;
  v_speed_l numeric; v_speed_b numeric;
  v_scnt integer; v_scgt integer; v_gt integer;
begin
  if v_actor is null then
    raise exception 'VE_FORBIDDEN: no application actor for this session' using errcode = '42501';
  end if;
  if p_vessel_id is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'VE_INVALID: vessel id and a profile object are required' using errcode = '22023';
  end if;
  if not coalesce(public.fn_vessel_economics_allowed(p_vessel_id), false) then
    raise exception 'VE_FORBIDDEN: you do not manage this vessel' using errcode = '42501';
  end if;

  v_speed_l := nullif(p_profile ->> 'speedLadenKn', '')::numeric;
  v_speed_b := nullif(p_profile ->> 'speedBallastKn', '')::numeric;
  v_scnt := nullif(p_profile ->> 'scnt', '')::integer;
  v_scgt := nullif(p_profile ->> 'scgt', '')::integer;
  v_gt := nullif(p_profile ->> 'gt', '')::integer;
  if (v_speed_l is not null and (v_speed_l < 3 or v_speed_l > 40)) or (v_speed_b is not null and (v_speed_b < 3 or v_speed_b > 40)) then
    raise exception 'VE_INVALID: speeds must be between 3 and 40 knots' using errcode = '22023';
  end if;
  if (v_scnt is not null and v_scnt <= 0) or (v_scgt is not null and v_scgt <= 0) or (v_gt is not null and v_gt <= 0) then
    raise exception 'VE_INVALID: tonnages must be positive' using errcode = '22023';
  end if;
  foreach v_state in array v_states loop
    v_entry := p_profile -> 'consumption' -> v_state;
    if v_entry is not null and jsonb_typeof(v_entry) = 'object' then
      v_res := nullif(v_entry ->> 'residual', '')::numeric;
      v_dis := nullif(v_entry ->> 'distillate', '')::numeric;
      if (v_res is not null and (v_res < 0 or v_res > 500)) or (v_dis is not null and (v_dis < 0 or v_dis > 500)) then
        raise exception 'VE_INVALID: consumption for % out of range (0–500 MT/day)', v_state using errcode = '22023';
      end if;
      if v_res is not null or v_dis is not null then
        v_cons := v_cons || jsonb_build_object(v_state, jsonb_strip_nulls(jsonb_build_object('residual', v_res, 'distillate', v_dis)));
      end if;
    end if;
  end loop;

  select to_jsonb(p) - 'updated_by' - 'updated_at' into v_before from public.vessel_economics_profiles p where p.vessel_id = p_vessel_id;

  insert into public.vessel_economics_profiles as p (
    vessel_id, scgt, scnt, gt, suez_category, last_suez_transit, first_transit,
    searchlight_compliant, mooring_cranes_ok, speed_laden_kn, speed_ballast_kn,
    consumption, has_scrubber, vessel_class, source, updated_by, updated_at)
  values (
    p_vessel_id, v_scgt, v_scnt, v_gt,
    nullif(p_profile ->> 'suezCategory', ''),
    nullif(p_profile ->> 'lastSuezTransit', '')::date,
    (p_profile ->> 'firstTransit')::boolean,
    (p_profile ->> 'searchlightCompliant')::boolean,
    (p_profile ->> 'mooringCranesOk')::boolean,
    v_speed_l, v_speed_b, v_cons,
    (p_profile ->> 'hasScrubber')::boolean,
    nullif(p_profile ->> 'vesselClass', ''),
    case when public.fn_is_admin() then 'admin' else 'member' end,
    v_actor, now())
  on conflict (vessel_id) do update set
    scgt = excluded.scgt, scnt = excluded.scnt, gt = excluded.gt,
    suez_category = excluded.suez_category, last_suez_transit = excluded.last_suez_transit,
    first_transit = excluded.first_transit, searchlight_compliant = excluded.searchlight_compliant,
    mooring_cranes_ok = excluded.mooring_cranes_ok, speed_laden_kn = excluded.speed_laden_kn,
    speed_ballast_kn = excluded.speed_ballast_kn, consumption = excluded.consumption,
    has_scrubber = excluded.has_scrubber, vessel_class = excluded.vessel_class,
    source = excluded.source, updated_by = excluded.updated_by, updated_at = now();

  select to_jsonb(p) - 'updated_by' - 'updated_at' into v_after from public.vessel_economics_profiles p where p.vessel_id = p_vessel_id;
  insert into public.vessel_economics_profile_events (vessel_id, actor_user_id, action, before, after)
  values (p_vessel_id, v_actor, case when v_before is null then 'created' else 'updated' end, v_before, v_after);

  return public.get_vessel_economics_profile(p_vessel_id);
end;
$upsert_profile$;

-- ── 7 · Settings: the auxiliary distillate product becomes data; seed marker so
--        the DOWN removes only the seeded settings row ───────────────────────
update public.app_settings
   set value = jsonb_set(value, '{eca,distillateProductKey}', '"LSMGO"'::jsonb, true)
 where key = 'voyage_settings' and jsonb_typeof(value -> 'eca') = 'object' and not (value -> 'eca' ? 'distillateProductKey');
update public.app_settings
   set value = value || jsonb_build_object('seedMarker', 'stream-s-20261003')
 where key = 'voyage_settings' and not (value ? 'seedMarker');

comment on table public.suez_tariff_sources is 'Governed evidence for Suez tariff versions: issuer, document, issue date, SHA-256 of the file when on disk.';
comment on table public.suez_tariff_events is 'Append-only audit of Suez tariff versions, items, tiers, SDR rates and seed corrections.';
