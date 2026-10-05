-- 20261003205400_suez_voyage_audit_remediation.sql — Stream S (5 Oct 2026), additive on 200000–205300.
-- Answers Codex audit C2O-039 (AMEND / production NO-GO on e4da2e0).
--
--   P0-1  category-scoped `surcharge` layer (temporary SCA surcharges per vessel category, laden/ballast and
--         direction), item confidence official|reported, and a version-level surcharge regime
--         (unknown | none | modelled): a version that has not modelled the surcharges can never price a
--         trusted toll.
--   P0-2  the last toll band of every category/status must be open-ended (validator, replace RPC).
--   P0-5  every admin write is one locked transactional RPC that writes its event in the same transaction;
--         the service role loses direct INSERT/UPDATE/DELETE on the governed tariff tables; publication is
--         serialized by an advisory lock and closes the preceding open version in the same transaction;
--         a version needs at least one cited source to publish.
--   P0-6  saved voyage runs and lines refuse UPDATE and DELETE for everyone (service role: SELECT/INSERT
--         only); a deleted user anonymises the run (actor set null) instead of erasing the ledger.
--   P1-7  the save binds an explicit owner organisation and checks the actor may reference the vessel,
--         position and cargo, and that the position belongs to the vessel.
--   P1-9  estimate lines persist their governed status.
--   P1-10 citation/publication rules enforced in the database, events in the same transaction.
--   P1-11 ECA geometry versions are append-only (eca_zone_versions); a geometry version can never change.
--   P1-12 the DOWN refuses a used database unless the operator confirms an export (see the rollback file).

-- ── 1 · actor + event helpers ───────────────────────────────────────────────

-- The acting admin: an active public.users row with the admin role. Hands the id to the trigger trail.
create or replace function public.fn_suez_require_admin(p_actor uuid)
returns void
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if p_actor is null or not exists (
       select 1 from public.users u where u.id = p_actor and u.is_active and lower(coalesce(u.role, '')) = 'admin') then
    raise exception 'SUEZ_ACTOR: an active admin public.users.id is required' using errcode = '42501';
  end if;
  perform set_config('asb.actor_user_id', p_actor::text, true);
end;
$fn$;
revoke all on function public.fn_suez_require_admin(uuid) from public, anon, authenticated;

-- A row change that only clears user/organisation/object references (the ON DELETE SET NULL of a deleted
-- user, vessel, listing …) is an anonymisation, not an edit: append-only ledgers accept exactly that.
create or replace function public.fn_is_anonymisation(p_old jsonb, p_new jsonb, p_refs text[])
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $fn$
declare r text;
begin
  if (p_new - p_refs) is distinct from (p_old - p_refs) then return false; end if;
  foreach r in array p_refs loop
    if (p_new ->> r) is not null and (p_new ->> r) is distinct from (p_old ->> r) then return false; end if;
  end loop;
  return true;
end;
$fn$;
revoke all on function public.fn_is_anonymisation(jsonb, jsonb, text[]) from public, anon, authenticated;

create or replace function public.fn_suez_events_append_only()
returns trigger language plpgsql set search_path = pg_catalog, public as $ev$
begin
  if tg_op = 'UPDATE' and public.fn_is_anonymisation(to_jsonb(old), to_jsonb(new), array['actor_user_id']) then
    return new;
  end if;
  raise exception 'SUEZ_IMMUTABLE: events are append-only' using errcode = '55000';
end; $ev$;
revoke all on function public.fn_suez_events_append_only() from public, anon, authenticated;

create or replace function public.fn_sdr_rates_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $sdr_guard$
begin
  if tg_op = 'DELETE' then
    raise exception 'SUEZ_IMMUTABLE: SDR rates are never deleted; void the row' using errcode = '55000';
  end if;
  if public.fn_is_anonymisation(to_jsonb(old), to_jsonb(new), array['created_by','voided_by']) then
    return new;
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
  values ('sdr_rate', new.id, 'voided', coalesce(new.voided_by, public.fn_suez_actor()), jsonb_build_object('asOf', new.as_of, 'rateUsd', new.rate_usd, 'reason', new.void_reason));
  return new;
end;
$sdr_guard$;
revoke all on function public.fn_sdr_rates_guard() from public, anon, authenticated;

create or replace function public.fn_suez_event(p_entity text, p_entity_id uuid, p_version_id uuid, p_action text, p_details jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
  values (p_entity, p_entity_id, p_version_id, p_action, public.fn_suez_actor(), coalesce(p_details, '{}'::jsonb));
end;
$fn$;
revoke all on function public.fn_suez_event(text, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ── 2 · surcharge layer, category scope, confidence, surcharge regime ─────────

alter table public.suez_tariff_items drop constraint if exists suez_tariff_items_layer_check;
alter table public.suez_tariff_items add constraint suez_tariff_items_layer_check
  check (layer in ('toll','fixed','conditional','waste','surcharge'));
alter table public.suez_tariff_items add column if not exists category_scope text[];
alter table public.suez_tariff_items add column if not exists confidence text not null default 'official';
alter table public.suez_tariff_items drop constraint if exists suez_tariff_items_confidence_ck;
alter table public.suez_tariff_items add constraint suez_tariff_items_confidence_ck check (confidence in ('official','reported'));
alter table public.suez_tariff_items drop constraint if exists suez_tariff_items_category_scope_ck;
alter table public.suez_tariff_items add constraint suez_tariff_items_category_scope_ck check (
  category_scope is null
  or (cardinality(category_scope) between 1 and 20
      and array_to_string(category_scope, ',') ~ '^[a-z][a-z0-9_]{1,40}(,[a-z][a-z0-9_]{1,40})*$'));
alter table public.suez_tariff_items drop constraint if exists suez_tariff_items_surcharge_ck;
alter table public.suez_tariff_items add constraint suez_tariff_items_surcharge_ck check (
  layer <> 'surcharge' or (category_scope is not null and basis = 'pct_of_toll'));

alter table public.suez_tariff_versions add column if not exists surcharge_regime text not null default 'unknown';
alter table public.suez_tariff_versions drop constraint if exists suez_tariff_versions_surcharge_regime_ck;
alter table public.suez_tariff_versions add constraint suez_tariff_versions_surcharge_regime_ck
  check (surcharge_regime in ('unknown','none','modelled'));

comment on column public.suez_tariff_versions.surcharge_regime is
  'unknown = category surcharges not modelled (every toll is partial); none = no surcharge was in force for the window; modelled = surcharge items carry them.';
comment on column public.suez_tariff_items.category_scope is 'SCA vessel categories the item applies to; null = every category.';
comment on column public.suez_tariff_items.confidence is 'official = the instrument is on file; reported = taken from a relay/press report (the estimate stays partial).';

-- ── 3 · version guard: a non-draft version changes only effective_to, notes and an allowed status ──

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
  -- A deleted admin's references are cleared, never block the deletion (anonymisation).
  if public.fn_is_anonymisation(to_jsonb(old), to_jsonb(new), array['created_by','published_by']) then
    return new;
  end if;
  -- Whole-row comparison: any column added later is frozen too.
  if (to_jsonb(new) - array['effective_to','notes','status']) is distinct from (to_jsonb(old) - array['effective_to','notes','status']) then
    raise exception 'SUEZ_IMMUTABLE: a % version only accepts effective_to, notes and a status transition', old.status using errcode = '55000';
  end if;
  if new.status <> old.status and not (old.status = 'published' and new.status in ('superseded','withdrawn')) then
    raise exception 'SUEZ_IMMUTABLE: % → % is not an allowed transition', old.status, new.status using errcode = '55000';
  end if;
  return new;
end;
$suez_guard$;
revoke all on function public.fn_suez_version_guard() from public, anon, authenticated;

-- Competing publications are serialized: one advisory lock for every path that makes a version published.
create or replace function public.fn_suez_version_no_overlap()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $suez_overlap$
begin
  if new.status = 'published' then
    perform pg_advisory_xact_lock(hashtext('asb.suez_tariff_publish'));
    if exists (
      select 1 from public.suez_tariff_versions v
       where v.id <> new.id and v.status = 'published'
         and daterange(v.effective_from, coalesce(v.effective_to, 'infinity'::date), '[]')
             && daterange(new.effective_from, coalesce(new.effective_to, 'infinity'::date), '[]')
    ) then
      raise exception 'SUEZ_OVERLAP: another published Suez tariff version covers part of % .. %',
        new.effective_from, coalesce(new.effective_to::text, 'open') using errcode = '23P01';
    end if;
  end if;
  return new;
end;
$suez_overlap$;
revoke all on function public.fn_suez_version_no_overlap() from public, anon, authenticated;

-- ── 4 · validation: bands open-ended last, citation required, surcharge rules ─────────

create or replace function public.fn_suez_validate_tiers(p_version_id uuid)
returns void
language plpgsql
stable
set search_path = pg_catalog, public
as $tiers$
declare
  g record;
  it record;
  prev_to numeric;
begin
  for g in select vessel_category, cargo_status from public.suez_toll_tiers where version_id = p_version_id group by 1, 2 order by 1, 2 loop
    prev_to := 0;
    for it in select * from public.suez_toll_tiers where version_id = p_version_id and vessel_category = g.vessel_category and cargo_status = g.cargo_status order by tier_order loop
      if prev_to is null then
        raise exception 'SUEZ_INVALID: % %: a band follows an open-ended band', g.vessel_category, g.cargo_status using errcode = '23514';
      end if;
      if it.scnt_from <> prev_to then
        raise exception 'SUEZ_INVALID: % %: band % starts at % but the previous band ends at %', g.vessel_category, g.cargo_status, it.tier_order, it.scnt_from, prev_to using errcode = '23514';
      end if;
      prev_to := it.scnt_to;
    end loop;
    -- A finite last band would silently stop charging above its ceiling.
    if prev_to is not null then
      raise exception 'SUEZ_INVALID: % %: the last band must be open-ended (ends at % SCNT)', g.vessel_category, g.cargo_status, prev_to using errcode = '23514';
    end if;
  end loop;
end;
$tiers$;
revoke all on function public.fn_suez_validate_tiers(uuid) from public, anon, authenticated;

create or replace function public.fn_suez_validate_version(p_version_id uuid)
returns void
language plpgsql
stable
set search_path = pg_catalog, public
as $validate$
declare
  it record;
  prev_to numeric;
  n integer;
  t jsonb;
  v_regime text;
begin
  select surcharge_regime into v_regime from public.suez_tariff_versions where id = p_version_id;
  if v_regime is null then raise exception 'SUEZ_NOT_FOUND: version %', p_version_id using errcode = 'P0002'; end if;

  select count(*) into n from public.suez_tariff_items where version_id = p_version_id and is_active;
  if n = 0 then raise exception 'SUEZ_INVALID: a version needs at least one active item' using errcode = '23514'; end if;
  select count(*) into n from public.suez_tariff_version_sources where version_id = p_version_id;
  if n = 0 then raise exception 'SUEZ_INVALID: a version cites no source record; register and cite the circular it is built from' using errcode = '23514'; end if;

  for it in select * from public.suez_tariff_items where version_id = p_version_id and is_active loop
    if it.layer = 'conditional' and it.condition_key is null then
      raise exception 'SUEZ_INVALID: item % is conditional without a condition key', it.code using errcode = '23514';
    end if;
    if it.layer = 'toll' and it.basis <> 'toll_tiered_scnt' then
      raise exception 'SUEZ_INVALID: item % in the toll layer must use toll_tiered_scnt', it.code using errcode = '23514';
    end if;
    if it.layer = 'surcharge' and (it.category_scope is null or jsonb_typeof(it.params -> 'pct') is distinct from 'number'
                                    or (it.params ->> 'pct')::numeric < 0 or (it.params ->> 'pct')::numeric > 1000) then
      raise exception 'SUEZ_INVALID: surcharge % needs a category scope and a pct between 0 and 1000', it.code using errcode = '23514';
    end if;
    case it.basis
      when 'flat' then
        if jsonb_typeof(it.params -> 'amount') is distinct from 'number' or (it.params ->> 'amount')::numeric < 0 then
          raise exception 'SUEZ_INVALID: item % (flat) needs a non-negative numeric amount', it.code using errcode = '23514';
        end if;
      when 'pct_of_toll' then
        if not coalesce(jsonb_typeof(it.params -> 'pct') = 'number', false)
           and not coalesce(jsonb_typeof(it.params -> 'pctPerUnit') = 'number', false)
           and not coalesce(jsonb_typeof(it.params -> 'bands') = 'array' and jsonb_array_length(it.params -> 'bands') > 0, false) then
          raise exception 'SUEZ_INVALID: item % (pct_of_toll) needs pct, pctPerUnit or bands', it.code using errcode = '23514';
        end if;
      when 'tier_by_scnt' then
        if jsonb_typeof(it.params -> 'tiers') is distinct from 'array' or jsonb_array_length(it.params -> 'tiers') = 0 then
          raise exception 'SUEZ_INVALID: item % (tier_by_scnt) needs tiers', it.code using errcode = '23514';
        end if;
        prev_to := 0;
        for t in select value from jsonb_array_elements(it.params -> 'tiers') loop
          if prev_to is null then
            raise exception 'SUEZ_INVALID: item % has a band after an open-ended band', it.code using errcode = '23514';
          end if;
          if jsonb_typeof(t -> 'from') is distinct from 'number' or (t ->> 'from')::numeric is distinct from prev_to then
            raise exception 'SUEZ_INVALID: item % tiers must be contiguous from 0 (band starting at % after %)', it.code, coalesce(t ->> 'from', 'null'), prev_to using errcode = '23514';
          end if;
          if jsonb_typeof(t -> 'amount') is distinct from 'number' or jsonb_typeof(t -> 'includedUnits') is distinct from 'number' then
            raise exception 'SUEZ_INVALID: item % tier needs numeric amount and includedUnits', it.code using errcode = '23514';
          end if;
          if t -> 'to' is null or jsonb_typeof(t -> 'to') = 'null' then prev_to := null; continue; end if;
          if jsonb_typeof(t -> 'to') is distinct from 'number' then
            raise exception 'SUEZ_INVALID: item % tier upper bound must be a number or null', it.code using errcode = '23514';
          end if;
          prev_to := (t ->> 'to')::numeric;
        end loop;
        if prev_to is not null then
          raise exception 'SUEZ_INVALID: item % (tier_by_scnt) needs an open-ended last band', it.code using errcode = '23514';
        end if;
      when 'per_unit' then
        if jsonb_typeof(it.params -> 'rate') is distinct from 'number' or jsonb_typeof(it.params -> 'unit') is distinct from 'string' then
          raise exception 'SUEZ_INVALID: item % (per_unit) needs rate and unit', it.code using errcode = '23514';
        end if;
      when 'gt_threshold' then
        if jsonb_typeof(it.params -> 'threshold') is distinct from 'number' or jsonb_typeof(it.params -> 'below') is distinct from 'number' or jsonb_typeof(it.params -> 'atOrAbove') is distinct from 'number' then
          raise exception 'SUEZ_INVALID: item % (gt_threshold) needs threshold, below, atOrAbove', it.code using errcode = '23514';
        end if;
      else null;
    end case;
    if it.condition_key = 'no_mooring_cranes' and (jsonb_typeof(it.params -> 'gtThreshold') is distinct from 'number' or jsonb_typeof(it.params -> 'swlMt') is distinct from 'number' or jsonb_typeof(it.params -> 'boats') is distinct from 'number') then
      raise exception 'SUEZ_INVALID: item % needs gtThreshold, swlMt and boats in params', it.code using errcode = '23514';
    end if;
    if it.condition_key = 'overage' and jsonb_typeof(it.params -> 'ageYears') is distinct from 'number' then
      raise exception 'SUEZ_INVALID: item % needs ageYears in params', it.code using errcode = '23514';
    end if;
  end loop;

  select count(*) into n from public.suez_tariff_items where version_id = p_version_id and is_active and layer = 'surcharge';
  if v_regime = 'modelled' and n = 0 then
    raise exception 'SUEZ_INVALID: the surcharge regime is "modelled" but the version has no surcharge item' using errcode = '23514';
  end if;
  if v_regime = 'none' and n > 0 then
    raise exception 'SUEZ_INVALID: the surcharge regime is "none" but the version carries % surcharge item(s)', n using errcode = '23514';
  end if;

  perform public.fn_suez_validate_tiers(p_version_id);
end;
$validate$;
revoke all on function public.fn_suez_validate_version(uuid) from public, anon, authenticated;
grant execute on function public.fn_suez_validate_version(uuid) to service_role;

-- ── 5 · member context v3: surcharge regime, category scope, item confidence ──

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
           'categoryScope', to_jsonb(i.category_scope), 'confidence', i.confidence,
           'conditionKey', i.condition_key, 'payerParty', i.payer_party, 'sortOrder', i.sort_order,
           'notes', i.notes) order by i.sort_order, i.code), '[]'::jsonb)
    into v_items from public.suez_tariff_items i where i.version_id = v_version.id and i.is_active;

  select coalesce(jsonb_agg(jsonb_build_object(
           'vesselCategory', t.vessel_category, 'cargoStatus', t.cargo_status, 'tierOrder', t.tier_order,
           'scntFrom', t.scnt_from, 'scntTo', t.scnt_to, 'sdrPerScnt', t.sdr_per_scnt, 'confidence', t.confidence)
           order by t.vessel_category, t.cargo_status, t.tier_order), '[]'::jsonb)
    into v_tiers from public.suez_toll_tiers t where t.version_id = v_version.id;

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
      'publishedAt', v_version.published_at, 'surchargeRegime', v_version.surcharge_regime),
    'sources', v_sources,
    'items', v_items,
    'tiers', v_tiers,
    'sdr', v_sdr,
    'suezDays', coalesce(v_settings -> 'suez', '{}'::jsonb),
    'algorithmVersion', 'suez-engine/3'
  );
end;
$suez_ctx$;
revoke all on function public.get_suez_tariff_context(date) from public, anon;
grant execute on function public.get_suez_tariff_context(date) to authenticated, service_role;

create or replace function public.admin_list_suez_tariff_versions()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $suez_admin_list$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'versionNo', v.version_no, 'status', v.status,
           'effectiveFrom', v.effective_from, 'effectiveTo', v.effective_to,
           'sourceRef', v.source_ref, 'sourceUrl', v.source_url, 'notes', v.notes,
           'createdAt', v.created_at, 'publishedAt', v.published_at, 'createdBy', v.created_by,
           'surchargeRegime', v.surcharge_regime,
           'itemCount', (select count(*) from public.suez_tariff_items i where i.version_id = v.id),
           'surchargeCount', (select count(*) from public.suez_tariff_items i where i.version_id = v.id and i.layer = 'surcharge' and i.is_active),
           'tierCount', (select count(*) from public.suez_toll_tiers t where t.version_id = v.id),
           'sourceCount', (select count(*) from public.suez_tariff_version_sources s where s.version_id = v.id))
           order by v.version_no desc), '[]'::jsonb)
    from public.suez_tariff_versions v;
$suez_admin_list$;
revoke all on function public.admin_list_suez_tariff_versions() from public, anon, authenticated;
grant execute on function public.admin_list_suez_tariff_versions() to service_role;

-- ── 6 · admin RPCs: one transaction per command, event inside it ─────────────

-- Locks a version row and asserts it is a draft (children may only change under a draft).
create or replace function public.fn_suez_lock_draft(p_version_id uuid)
returns public.suez_tariff_versions
language plpgsql
set search_path = pg_catalog, public
as $fn$
declare v public.suez_tariff_versions%rowtype;
begin
  select * into v from public.suez_tariff_versions where id = p_version_id for update;
  if not found then raise exception 'SUEZ_NOT_FOUND: version %', p_version_id using errcode = 'P0002'; end if;
  if v.status <> 'draft' then
    raise exception 'SUEZ_IMMUTABLE: version % is %; only a draft changes', v.version_no, v.status using errcode = '55000';
  end if;
  return v;
end;
$fn$;
revoke all on function public.fn_suez_lock_draft(uuid) from public, anon, authenticated;

create or replace function public.admin_suez_create_version(p_actor uuid, p_version jsonb, p_copy_from uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_no integer;
  v_id uuid;
  n_items integer := 0; n_tiers integer := 0; n_sources integer := 0;
  v_regime text := coalesce(nullif(p_version ->> 'surchargeRegime', ''), 'unknown');
begin
  perform public.fn_suez_require_admin(p_actor);
  if jsonb_typeof(p_version) is distinct from 'object' then
    raise exception 'SUEZ_INVALID: version payload must be an object' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('asb.suez_tariff_version_no'));
  select coalesce(max(version_no), 0) + 1 into v_no from public.suez_tariff_versions;
  insert into public.suez_tariff_versions (version_no, status, effective_from, effective_to, source_ref, source_url, notes, surcharge_regime, created_by)
  values (v_no, 'draft', (p_version ->> 'effectiveFrom')::date, nullif(p_version ->> 'effectiveTo', '')::date,
          p_version ->> 'sourceRef', nullif(p_version ->> 'sourceUrl', ''), nullif(p_version ->> 'notes', ''), v_regime, p_actor)
  returning id into v_id;
  if p_copy_from is not null then
    if not exists (select 1 from public.suez_tariff_versions where id = p_copy_from) then
      raise exception 'SUEZ_NOT_FOUND: version to copy from %', p_copy_from using errcode = 'P0002';
    end if;
    insert into public.suez_tariff_items (version_id, code, label_en, label_ar, layer, basis, currency, params, direction_scope, cargo_status_scope,
                                          category_scope, confidence, condition_key, payer_party, sort_order, is_active, notes)
    select v_id, code, label_en, label_ar, layer, basis, currency, params, direction_scope, cargo_status_scope,
           category_scope, confidence, condition_key, payer_party, sort_order, is_active, notes
      from public.suez_tariff_items where version_id = p_copy_from;
    get diagnostics n_items = row_count;
    insert into public.suez_toll_tiers (version_id, vessel_category, cargo_status, tier_order, scnt_from, scnt_to, sdr_per_scnt, confidence)
    select v_id, vessel_category, cargo_status, tier_order, scnt_from, scnt_to, sdr_per_scnt, confidence
      from public.suez_toll_tiers where version_id = p_copy_from;
    get diagnostics n_tiers = row_count;
    insert into public.suez_tariff_version_sources (version_id, source_id)
    select v_id, source_id from public.suez_tariff_version_sources where version_id = p_copy_from;
    get diagnostics n_sources = row_count;
    perform public.fn_suez_event('version', v_id, v_id, 'copied_from',
      jsonb_build_object('fromVersionId', p_copy_from, 'items', n_items, 'tiers', n_tiers, 'sources', n_sources));
  end if;
  return jsonb_build_object('id', v_id, 'versionNo', v_no, 'items', n_items, 'tiers', n_tiers, 'sources', n_sources);
end;
$fn$;

-- Publication: typed confirmation, serialized, closes the preceding open version the day before, validates
-- (trigger), records the actor — all or nothing.
create or replace function public.admin_suez_publish(p_version_id uuid, p_actor uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v public.suez_tariff_versions%rowtype;
  o public.suez_tariff_versions%rowtype;
  v_closed integer;
begin
  perform public.fn_suez_require_admin(p_actor);
  if p_confirm is distinct from 'PUBLISH' then
    raise exception 'SUEZ_CONFIRM: type PUBLISH to confirm' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('asb.suez_tariff_publish'));
  v := public.fn_suez_lock_draft(p_version_id);
  select * into o from public.suez_tariff_versions
   where status = 'published' and effective_to is null and effective_from < v.effective_from
   order by effective_from desc limit 1 for update;
  if found then
    update public.suez_tariff_versions set effective_to = v.effective_from - 1 where id = o.id;
    v_closed := o.version_no;
  end if;
  update public.suez_tariff_versions
     set status = 'published', published_at = now(), published_by = p_actor
   where id = p_version_id;
  return jsonb_build_object(
    'versionNo', v.version_no, 'closedVersionNo', v_closed, 'makerIsChecker', v.created_by is not distinct from p_actor,
    'items', (select count(*) from public.suez_tariff_items where version_id = p_version_id and is_active),
    'surcharges', (select count(*) from public.suez_tariff_items where version_id = p_version_id and is_active and layer = 'surcharge'),
    'tiers', (select count(*) from public.suez_toll_tiers where version_id = p_version_id),
    'sources', (select count(*) from public.suez_tariff_version_sources where version_id = p_version_id),
    'surchargeRegime', v.surcharge_regime);
end;
$fn$;

-- Status transitions other than publication (publication has its own command above).
create or replace function public.admin_suez_set_status(p_version_id uuid, p_actor uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform public.fn_suez_require_admin(p_actor);
  if p_status not in ('withdrawn', 'superseded') then
    raise exception 'SUEZ_INVALID: status % is not a transition here (publish through admin_suez_publish)', p_status using errcode = '23514';
  end if;
  update public.suez_tariff_versions set status = p_status where id = p_version_id;
  if not found then raise exception 'SUEZ_NOT_FOUND: version %', p_version_id using errcode = 'P0002'; end if;
end;
$fn$;

create or replace function public.admin_suez_set_window(p_version_id uuid, p_actor uuid, p_effective_to date, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform public.fn_suez_require_admin(p_actor);
  perform pg_advisory_xact_lock(hashtext('asb.suez_tariff_publish'));
  update public.suez_tariff_versions
     set effective_to = p_effective_to, notes = coalesce(p_notes, notes)
   where id = p_version_id;
  if not found then raise exception 'SUEZ_NOT_FOUND: version %', p_version_id using errcode = 'P0002'; end if;
end;
$fn$;

create or replace function public.admin_suez_delete_draft(p_version_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform public.fn_suez_require_admin(p_actor);
  perform public.fn_suez_lock_draft(p_version_id);
  delete from public.suez_tariff_versions where id = p_version_id and status = 'draft';
end;
$fn$;

create or replace function public.admin_suez_save_item(p_version_id uuid, p_actor uuid, p_item_id uuid, p_item jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_id uuid;
  v_scope text[];
begin
  perform public.fn_suez_require_admin(p_actor);
  perform public.fn_suez_lock_draft(p_version_id);
  if jsonb_typeof(p_item) is distinct from 'object' or jsonb_typeof(p_item -> 'params') is distinct from 'object' then
    raise exception 'SUEZ_INVALID: item payload needs an object with params' using errcode = '22023';
  end if;
  v_scope := case when jsonb_typeof(p_item -> 'categoryScope') = 'array' and jsonb_array_length(p_item -> 'categoryScope') > 0
                  then array(select jsonb_array_elements_text(p_item -> 'categoryScope')) else null end;
  if p_item_id is null then
    insert into public.suez_tariff_items (version_id, code, label_en, label_ar, layer, basis, currency, params, direction_scope, cargo_status_scope,
                                          category_scope, confidence, condition_key, payer_party, sort_order, is_active, notes)
    values (p_version_id, p_item ->> 'code', p_item ->> 'labelEn', nullif(p_item ->> 'labelAr', ''), p_item ->> 'layer', p_item ->> 'basis',
            p_item ->> 'currency', p_item -> 'params', coalesce(p_item ->> 'directionScope', 'any'), coalesce(p_item ->> 'cargoStatusScope', 'any'),
            v_scope, coalesce(p_item ->> 'confidence', 'official'), nullif(p_item ->> 'conditionKey', ''), coalesce(p_item ->> 'payerParty', 'owner'),
            coalesce((p_item ->> 'sortOrder')::integer, 100), coalesce((p_item ->> 'isActive')::boolean, true), nullif(p_item ->> 'notes', ''))
    returning id into v_id;
  else
    update public.suez_tariff_items
       set code = p_item ->> 'code', label_en = p_item ->> 'labelEn', label_ar = nullif(p_item ->> 'labelAr', ''),
           layer = p_item ->> 'layer', basis = p_item ->> 'basis', currency = p_item ->> 'currency', params = p_item -> 'params',
           direction_scope = coalesce(p_item ->> 'directionScope', 'any'), cargo_status_scope = coalesce(p_item ->> 'cargoStatusScope', 'any'),
           category_scope = v_scope, confidence = coalesce(p_item ->> 'confidence', 'official'),
           condition_key = nullif(p_item ->> 'conditionKey', ''), payer_party = coalesce(p_item ->> 'payerParty', 'owner'),
           sort_order = coalesce((p_item ->> 'sortOrder')::integer, 100), is_active = coalesce((p_item ->> 'isActive')::boolean, true),
           notes = nullif(p_item ->> 'notes', '')
     where id = p_item_id and version_id = p_version_id
     returning id into v_id;
    if v_id is null then raise exception 'SUEZ_NOT_FOUND: item % in version %', p_item_id, p_version_id using errcode = 'P0002'; end if;
  end if;
  perform public.fn_suez_event('item', v_id, p_version_id, case when p_item_id is null then 'added' else 'updated' end,
    jsonb_build_object('code', p_item ->> 'code', 'layer', p_item ->> 'layer', 'basis', p_item ->> 'basis', 'params', p_item -> 'params',
                       'categoryScope', to_jsonb(v_scope), 'confidence', coalesce(p_item ->> 'confidence', 'official')));
  return v_id;
end;
$fn$;

create or replace function public.admin_suez_delete_item(p_version_id uuid, p_actor uuid, p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare v_code text;
begin
  perform public.fn_suez_require_admin(p_actor);
  perform public.fn_suez_lock_draft(p_version_id);
  delete from public.suez_tariff_items where id = p_item_id and version_id = p_version_id returning code into v_code;
  if v_code is null then raise exception 'SUEZ_NOT_FOUND: item % in version %', p_item_id, p_version_id using errcode = 'P0002'; end if;
  perform public.fn_suez_event('item', p_item_id, p_version_id, 'deleted', jsonb_build_object('code', v_code));
end;
$fn$;

-- Replace every toll band of a draft in one transaction; refuses a set the publication would refuse.
create or replace function public.admin_suez_replace_tiers(p_version_id uuid, p_actor uuid, p_rows jsonb, p_confidence text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare n integer; n_cat integer;
begin
  perform public.fn_suez_require_admin(p_actor);
  perform public.fn_suez_lock_draft(p_version_id);
  if p_confidence not in ('official', 'placeholder') then
    raise exception 'SUEZ_INVALID: confidence must be official or placeholder' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'SUEZ_INVALID: bands must be a non-empty array' using errcode = '22023';
  end if;
  delete from public.suez_toll_tiers where version_id = p_version_id;
  insert into public.suez_toll_tiers (version_id, vessel_category, cargo_status, tier_order, scnt_from, scnt_to, sdr_per_scnt, confidence)
  select p_version_id, r.vessel_category, r.cargo_status, r.tier_order, r.scnt_from, r.scnt_to, r.sdr_per_scnt, p_confidence
    from jsonb_to_recordset(p_rows) as r(vessel_category text, cargo_status text, tier_order smallint, scnt_from numeric, scnt_to numeric, sdr_per_scnt numeric);
  get diagnostics n = row_count;
  perform public.fn_suez_validate_tiers(p_version_id);
  select count(distinct vessel_category) into n_cat from public.suez_toll_tiers where version_id = p_version_id;
  perform public.fn_suez_event('tier', null, p_version_id, 'replaced', jsonb_build_object('bands', n, 'categories', n_cat, 'confidence', p_confidence));
  return jsonb_build_object('bands', n, 'categories', n_cat);
end;
$fn$;

create or replace function public.admin_suez_register_source(p_actor uuid, p_source jsonb, p_cite_version uuid default null)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare v_id uuid;
begin
  perform public.fn_suez_require_admin(p_actor);
  if jsonb_typeof(p_source) is distinct from 'object' then
    raise exception 'SUEZ_INVALID: source payload must be an object' using errcode = '22023';
  end if;
  if p_cite_version is not null then perform public.fn_suez_lock_draft(p_cite_version); end if;
  insert into public.suez_tariff_sources (title, issuer, document_no, issue_date, effective_from, authority, evidence_status, sha256,
                                          source_filename, source_uri, notes, registered_by)
  values (p_source ->> 'title', p_source ->> 'issuer', nullif(p_source ->> 'documentNo', ''), nullif(p_source ->> 'issueDate', '')::date,
          nullif(p_source ->> 'effectiveFrom', '')::date, p_source ->> 'authority', p_source ->> 'evidenceStatus',
          nullif(lower(p_source ->> 'sha256'), ''), nullif(p_source ->> 'sourceFilename', ''), nullif(p_source ->> 'sourceUri', ''),
          nullif(p_source ->> 'notes', ''), p_actor)
  returning id into v_id;
  perform public.fn_suez_event('source', v_id, null, 'registered',
    jsonb_build_object('title', p_source ->> 'title', 'issuer', p_source ->> 'issuer', 'documentNo', p_source ->> 'documentNo',
                       'evidenceStatus', p_source ->> 'evidenceStatus', 'sha256', p_source ->> 'sha256'));
  if p_cite_version is not null then
    insert into public.suez_tariff_version_sources (version_id, source_id) values (p_cite_version, v_id);
    perform public.fn_suez_event('version', p_cite_version, p_cite_version, 'source_cited', jsonb_build_object('sourceId', v_id, 'title', p_source ->> 'title'));
  end if;
  return v_id;
end;
$fn$;

create or replace function public.admin_suez_cite_source(p_version_id uuid, p_actor uuid, p_source_id uuid, p_cite boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform public.fn_suez_require_admin(p_actor);
  perform public.fn_suez_lock_draft(p_version_id);
  if not exists (select 1 from public.suez_tariff_sources where id = p_source_id) then
    raise exception 'SUEZ_NOT_FOUND: source %', p_source_id using errcode = 'P0002';
  end if;
  if p_cite then
    insert into public.suez_tariff_version_sources (version_id, source_id) values (p_version_id, p_source_id) on conflict do nothing;
    if found then perform public.fn_suez_event('version', p_version_id, p_version_id, 'source_cited', jsonb_build_object('sourceId', p_source_id)); end if;
  else
    delete from public.suez_tariff_version_sources where version_id = p_version_id and source_id = p_source_id;
    if found then perform public.fn_suez_event('version', p_version_id, p_version_id, 'source_uncited', jsonb_build_object('sourceId', p_source_id)); end if;
  end if;
end;
$fn$;

-- voyage_settings: the row and its event in one transaction. The value was validated by the action's schema;
-- the row loses the seed marker on purpose (it is now owner data, see the DOWN policy).
create or replace function public.admin_voyage_save_settings(p_actor uuid, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare v_before jsonb; v_existed boolean;
begin
  perform public.fn_suez_require_admin(p_actor);
  if jsonb_typeof(p_value) is distinct from 'object' or not (p_value ? 'speeds' and p_value ? 'opex' and p_value ? 'eca') then
    raise exception 'VOYAGE_INVALID: settings must be a voyage_settings object' using errcode = '22023';
  end if;
  select value, true into v_before, v_existed from public.app_settings where key = 'voyage_settings' for update;
  insert into public.app_settings (key, value, updated_at) values ('voyage_settings', p_value - 'seedMarker', now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.fn_suez_event('settings', null, null, case when coalesce(v_existed, false) then 'updated' else 'created' end,
    jsonb_build_object('before', v_before, 'after', p_value - 'seedMarker'));
end;
$fn$;

-- ── 7 · ECA geometry: append-only versions ──────────────────────────────────

create table if not exists public.eca_zone_versions (
  id                uuid primary key default gen_random_uuid(),
  code              text not null,
  geometry_version  text not null check (geometry_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  name              text not null,
  polygon           jsonb not null check (jsonb_typeof(polygon) = 'array' and jsonb_array_length(polygon) >= 3),
  sulphur_limit_pct numeric(4,2) not null,
  effective_from    date not null,
  confidence        text not null check (confidence in ('official','coarse')),
  source_ref        text,
  source_url        text,
  sha256            text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  created_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (code, geometry_version)
);
alter table public.eca_zone_versions enable row level security;
revoke all on table public.eca_zone_versions from public, anon, authenticated;
grant select on table public.eca_zone_versions to service_role;

create or replace function public.fn_eca_zone_versions_append_only()
returns trigger language plpgsql set search_path = pg_catalog, public as $fn$
begin
  if tg_op = 'UPDATE' and public.fn_is_anonymisation(to_jsonb(old), to_jsonb(new), array['created_by']) then
    return new;
  end if;
  raise exception 'ECA_IMMUTABLE: an ECA geometry version never changes; save a new geometry version' using errcode = '55000';
end; $fn$;
revoke all on function public.fn_eca_zone_versions_append_only() from public, anon, authenticated;
drop trigger if exists trg_eca_zone_versions_append_only on public.eca_zone_versions;
create trigger trg_eca_zone_versions_append_only before update or delete on public.eca_zone_versions
  for each row execute function public.fn_eca_zone_versions_append_only();

-- Every geometry the zone pointer carries is recorded once; re-using a version id with other geometry is refused.
create or replace function public.fn_eca_zone_record_version()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare v public.eca_zone_versions%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'ECA_IMMUTABLE: ECA zones are never deleted; deactivate the zone' using errcode = '55000';
  end if;
  select * into v from public.eca_zone_versions where code = new.code and geometry_version = new.geometry_version;
  if not found then
    insert into public.eca_zone_versions (code, geometry_version, name, polygon, sulphur_limit_pct, effective_from, confidence, source_ref, source_url, sha256, created_by)
    values (new.code, new.geometry_version, new.name, new.polygon, new.sulphur_limit_pct, new.effective_from, new.confidence, new.source_ref, new.source_url, new.sha256,
            coalesce(new.updated_by, public.fn_suez_actor()));
  elsif v.polygon is distinct from new.polygon or v.sulphur_limit_pct is distinct from new.sulphur_limit_pct
        or v.effective_from is distinct from new.effective_from or v.confidence is distinct from new.confidence
        or v.sha256 is distinct from new.sha256 then
    raise exception 'ECA_IMMUTABLE: geometry version %@% already exists with other geometry; use a new geometry version', new.code, new.geometry_version using errcode = '55000';
  end if;
  return new;
end;
$fn$;
revoke all on function public.fn_eca_zone_record_version() from public, anon, authenticated;
drop trigger if exists trg_eca_zone_record_version on public.eca_zones;
create trigger trg_eca_zone_record_version before insert or update or delete on public.eca_zones
  for each row execute function public.fn_eca_zone_record_version();

insert into public.eca_zone_versions (code, geometry_version, name, polygon, sulphur_limit_pct, effective_from, confidence, source_ref, source_url, sha256, created_by)
select code, geometry_version, name, polygon, sulphur_limit_pct, effective_from, confidence, source_ref, source_url, sha256, updated_by
  from public.eca_zones
on conflict (code, geometry_version) do nothing;

create or replace function public.admin_eca_save_zone(p_actor uuid, p_zone jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare v_code text := upper(p_zone ->> 'code'); v_before text;
begin
  perform public.fn_suez_require_admin(p_actor);
  if jsonb_typeof(p_zone) is distinct from 'object' then raise exception 'ECA_INVALID: zone payload must be an object' using errcode = '22023'; end if;
  select geometry_version into v_before from public.eca_zones where code = v_code for update;
  insert into public.eca_zones (code, name, polygon, sulphur_limit_pct, effective_from, effective_to, is_active, notes,
                                geometry_version, source_ref, source_url, sha256, confidence, updated_by, updated_at)
  values (v_code, p_zone ->> 'name', p_zone -> 'polygon', (p_zone ->> 'sulphurLimitPct')::numeric, (p_zone ->> 'effectiveFrom')::date,
          nullif(p_zone ->> 'effectiveTo', '')::date, coalesce((p_zone ->> 'isActive')::boolean, true), nullif(p_zone ->> 'notes', ''),
          p_zone ->> 'geometryVersion', p_zone ->> 'sourceRef', nullif(p_zone ->> 'sourceUrl', ''), nullif(lower(p_zone ->> 'sha256'), ''),
          p_zone ->> 'confidence', p_actor, now())
  on conflict (code) do update set
    name = excluded.name, polygon = excluded.polygon, sulphur_limit_pct = excluded.sulphur_limit_pct, effective_from = excluded.effective_from,
    effective_to = excluded.effective_to, is_active = excluded.is_active, notes = excluded.notes, geometry_version = excluded.geometry_version,
    source_ref = excluded.source_ref, source_url = excluded.source_url, sha256 = excluded.sha256, confidence = excluded.confidence,
    updated_by = excluded.updated_by, updated_at = now();
  perform public.fn_suez_event('eca_zone', null, null, case when v_before is null then 'added' else 'replaced' end,
    jsonb_build_object('code', v_code, 'fromGeometryVersion', v_before, 'geometryVersion', p_zone ->> 'geometryVersion',
                       'points', jsonb_array_length(p_zone -> 'polygon'), 'confidence', p_zone ->> 'confidence',
                       'sourceRef', p_zone ->> 'sourceRef', 'sha256', p_zone ->> 'sha256'));
end;
$fn$;

create or replace function public.admin_eca_set_active(p_actor uuid, p_code text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform public.fn_suez_require_admin(p_actor);
  update public.eca_zones set is_active = p_active, updated_by = p_actor, updated_at = now() where code = p_code;
  if not found then raise exception 'ECA_NOT_FOUND: zone %', p_code using errcode = 'P0002'; end if;
  perform public.fn_suez_event('eca_zone', null, null, case when p_active then 'activated' else 'deactivated' end, jsonb_build_object('code', p_code));
end;
$fn$;

-- ── 8 · grants: writes only through the RPCs above ──────────────────────────
-- The RPCs are SECURITY DEFINER (owner), so the service role keeps SELECT and loses direct writes on the
-- governed tables; sdr_rates keeps INSERT/UPDATE (its triggers write the event and allow only voiding).
revoke insert, update, delete, truncate on table
  public.suez_tariff_versions, public.suez_tariff_items, public.suez_toll_tiers,
  public.suez_tariff_sources, public.suez_tariff_version_sources, public.eca_zones
  from service_role;
revoke delete, truncate on table public.sdr_rates from service_role;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.admin_suez_create_version(uuid, jsonb, uuid)', 'public.admin_suez_publish(uuid, uuid, text)',
    'public.admin_suez_set_status(uuid, uuid, text)', 'public.admin_suez_set_window(uuid, uuid, date, text)',
    'public.admin_suez_delete_draft(uuid, uuid)', 'public.admin_suez_save_item(uuid, uuid, uuid, jsonb)',
    'public.admin_suez_delete_item(uuid, uuid, uuid)', 'public.admin_suez_replace_tiers(uuid, uuid, jsonb, text)',
    'public.admin_suez_register_source(uuid, jsonb, uuid)', 'public.admin_suez_cite_source(uuid, uuid, uuid, boolean)',
    'public.admin_voyage_save_settings(uuid, jsonb)', 'public.admin_eca_save_zone(uuid, jsonb)',
    'public.admin_eca_set_active(uuid, text, boolean)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.fn_suez_lock_draft(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end
$grants$;

-- ── 9 · saved voyage runs: no UPDATE, no DELETE; anonymised on user deletion ──

alter table public.voyage_estimate_runs drop constraint if exists voyage_estimate_runs_actor_user_id_fkey;
alter table public.voyage_estimate_runs alter column actor_user_id drop not null;
alter table public.voyage_estimate_runs add constraint voyage_estimate_runs_actor_user_id_fkey
  foreign key (actor_user_id) references public.users(id) on delete set null;
alter table public.voyage_estimate_lines add column if not exists status text;
alter table public.voyage_estimate_lines drop constraint if exists voyage_estimate_lines_status_ck;
alter table public.voyage_estimate_lines add constraint voyage_estimate_lines_status_ck
  check (status is null or status in ('trusted','fallback','manual','unavailable','invalid'));

comment on table public.voyage_estimate_runs is
  'Immutable voyage estimate snapshots (Stream S). Retention: kept indefinitely; never updated or deleted. When a referenced user, organisation, vessel, position or listing is deleted, only that reference is set null (anonymisation); the economics stay.';

create or replace function public.fn_voyage_run_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $immutable$
begin
  if tg_op = 'DELETE' then
    raise exception 'VOYAGE_IMMUTABLE: a saved voyage estimate is never deleted' using errcode = '55000';
  end if;
  -- The only permitted UPDATE is a referential anonymisation (ON DELETE SET NULL) on a run.
  if tg_table_name = 'voyage_estimate_runs'
     and public.fn_is_anonymisation(to_jsonb(old), to_jsonb(new), array['actor_user_id','owner_org_id','vessel_id','availability_id','cargo_listing_id']) then
    return new;
  end if;
  raise exception 'VOYAGE_IMMUTABLE: a saved voyage estimate never changes; save a new estimate' using errcode = '55000';
end;
$immutable$;
revoke all on function public.fn_voyage_run_immutable() from public, anon, authenticated;
drop trigger if exists trg_voyage_run_immutable on public.voyage_estimate_runs;
create trigger trg_voyage_run_immutable before update or delete on public.voyage_estimate_runs for each row execute function public.fn_voyage_run_immutable();
drop trigger if exists trg_voyage_lines_immutable on public.voyage_estimate_lines;
create trigger trg_voyage_lines_immutable before update or delete on public.voyage_estimate_lines for each row execute function public.fn_voyage_run_immutable();

revoke all on table public.voyage_estimate_runs, public.voyage_estimate_lines from service_role;
grant select, insert on table public.voyage_estimate_runs, public.voyage_estimate_lines to service_role;

-- May this actor reference that object on a saved estimate? Admins: any existing row. Members: their own.
create or replace function public.fn_voyage_may_reference(p_actor uuid, p_kind text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select case
    when p_id is null then true
    when exists (select 1 from public.users u where u.id = p_actor and u.is_active and lower(coalesce(u.role, '')) = 'admin') then
      case p_kind
        when 'vessel' then exists (select 1 from public.vessels where id = p_id)
        when 'availability' then exists (select 1 from public.vessel_availability where id = p_id)
        when 'cargo' then exists (select 1 from public.cargo_listings where id = p_id)
        else false end
    else
      case p_kind
        when 'availability' then public.fn_market_owns_listing(p_actor, 'vessel_availability', p_id)
        when 'cargo' then public.fn_market_owns_listing(p_actor, 'cargo', p_id)
        when 'vessel' then exists (select 1 from public.vessel_claims vc where vc.vessel_id = p_id and vc.user_id = p_actor)
                        or exists (select 1 from public.vessel_availability a where a.vessel_id = p_id
                                     and public.fn_market_owns_listing(p_actor, 'vessel_availability', a.id))
        else false end
  end;
$fn$;
revoke all on function public.fn_voyage_may_reference(uuid, text, uuid) from public, anon, authenticated, service_role;

create or replace function public.save_voyage_estimate(p_actor uuid, p_payload jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $save$
declare
  v_id uuid;
  v_line jsonb;
  v_seq integer := 0;
  v_org uuid;
  v_orgs uuid[];
  v_vessel uuid := nullif(p_payload ->> 'vesselId', '')::uuid;
  v_avail uuid := nullif(p_payload ->> 'availabilityId', '')::uuid;
  v_cargo uuid := nullif(p_payload ->> 'cargoListingId', '')::uuid;
  v_req_org uuid := nullif(p_payload ->> 'ownerOrgId', '')::uuid;
begin
  if p_actor is null or not exists (select 1 from public.users u where u.id = p_actor and u.is_active) then
    raise exception 'VOYAGE_INVALID: unknown or inactive actor' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload -> 'input') <> 'object'
     or jsonb_typeof(p_payload -> 'result') <> 'object' or jsonb_typeof(p_payload -> 'totals') <> 'object' then
    raise exception 'VOYAGE_INVALID: payload needs input, result and totals objects' using errcode = '22023';
  end if;

  -- Owner context: an explicit seat, or the actor's only seat; several seats and no choice is refused.
  select coalesce(array_agg(om.org_id order by om.added_at), '{}') into v_orgs
    from public.organization_members om
   where om.user_id = p_actor and om.is_current and om.status = 'active';
  if v_req_org is not null then
    if not (v_req_org = any (v_orgs)) then
      raise exception 'VOYAGE_FORBIDDEN: you hold no active seat in that organisation' using errcode = '42501';
    end if;
    v_org := v_req_org;
  elsif cardinality(v_orgs) = 1 then
    v_org := v_orgs[1];
  elsif cardinality(v_orgs) > 1 then
    raise exception 'VOYAGE_INVALID: you hold seats in % organisations; choose the one that owns this estimate', cardinality(v_orgs) using errcode = '22023';
  end if;

  -- Object visibility and agreement.
  if not public.fn_voyage_may_reference(p_actor, 'vessel', v_vessel)
     or not public.fn_voyage_may_reference(p_actor, 'availability', v_avail)
     or not public.fn_voyage_may_reference(p_actor, 'cargo', v_cargo) then
    raise exception 'VOYAGE_FORBIDDEN: the estimate references a vessel, position or cargo you may not use' using errcode = '42501';
  end if;
  if v_avail is not null and v_vessel is not null
     and not exists (select 1 from public.vessel_availability a where a.id = v_avail and a.vessel_id = v_vessel) then
    raise exception 'VOYAGE_INVALID: the position does not belong to the vessel' using errcode = '22023';
  end if;

  insert into public.voyage_estimate_runs (
    actor_user_id, owner_org_id, vessel_id, availability_id, cargo_listing_id, label,
    algorithm_version, settings_hash, input_snapshot, result_snapshot,
    fuel_index_snapshot, route_eca_snapshot, suez_cost_snapshot, port_cost_snapshot, totals, warnings)
  values (
    p_actor, v_org, v_vessel, v_avail, v_cargo,
    nullif(p_payload ->> 'label', ''),
    p_payload ->> 'algorithmVersion',
    p_payload ->> 'settingsHash',
    p_payload -> 'input', p_payload -> 'result',
    p_payload -> 'fuelIndexSnapshot', p_payload -> 'routeEcaSnapshot',
    p_payload -> 'suezCostSnapshot', p_payload -> 'portCostSnapshot',
    p_payload -> 'totals', coalesce(p_payload -> 'warnings', '[]'::jsonb))
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]'::jsonb)) loop
    if coalesce(v_line ->> 'status', '') not in ('trusted','fallback','manual','unavailable','invalid') then
      raise exception 'VOYAGE_INVALID: line % (%) carries no governed status', v_seq, v_line ->> 'code' using errcode = '22023';
    end if;
    insert into public.voyage_estimate_lines (run_id, seq, kind, code, label, status, quantity, unit, rate, amount_usd, explanation)
    values (v_id, v_seq, v_line ->> 'kind', v_line ->> 'code', coalesce(v_line ->> 'label', v_line ->> 'code'), v_line ->> 'status',
            nullif(v_line ->> 'quantity', '')::numeric, v_line ->> 'unit', nullif(v_line ->> 'rate', '')::numeric,
            nullif(v_line ->> 'amountUsd', '')::numeric, v_line ->> 'explanation');
    v_seq := v_seq + 1;
  end loop;
  return v_id;
end;
$save$;
revoke all on function public.save_voyage_estimate(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_voyage_estimate(uuid, jsonb) to service_role;

create or replace function public.get_voyage_estimate(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $get$
declare
  r public.voyage_estimate_runs%rowtype;
  v_lines jsonb;
begin
  if p_run_id is null or not coalesce(public.fn_can_read_voyage_run(p_run_id), false) then
    raise exception 'VOYAGE_NOT_FOUND: estimate was not found' using errcode = 'P0002';
  end if;
  select * into r from public.voyage_estimate_runs where id = p_run_id;
  select coalesce(jsonb_agg(jsonb_build_object('seq', l.seq, 'kind', l.kind, 'code', l.code, 'label', l.label, 'status', l.status,
           'quantity', l.quantity, 'unit', l.unit, 'rate', l.rate, 'amountUsd', l.amount_usd, 'explanation', l.explanation) order by l.seq), '[]'::jsonb)
    into v_lines from public.voyage_estimate_lines l where l.run_id = p_run_id;
  return jsonb_build_object(
    'id', r.id, 'label', r.label, 'createdAt', r.created_at, 'actorUserId', r.actor_user_id, 'ownerOrgId', r.owner_org_id,
    'vesselId', r.vessel_id, 'availabilityId', r.availability_id, 'cargoListingId', r.cargo_listing_id,
    'algorithmVersion', r.algorithm_version, 'settingsHash', r.settings_hash,
    'input', r.input_snapshot, 'result', r.result_snapshot, 'totals', r.totals, 'warnings', r.warnings,
    'fuelIndexSnapshot', r.fuel_index_snapshot, 'routeEcaSnapshot', r.route_eca_snapshot,
    'suezCostSnapshot', r.suez_cost_snapshot, 'portCostSnapshot', r.port_cost_snapshot, 'lines', v_lines);
end;
$get$;
revoke all on function public.get_voyage_estimate(uuid) from public, anon;
grant execute on function public.get_voyage_estimate(uuid) to authenticated, service_role;

-- ── 10 · SCNT / SCGT carry decimals (SCA certificates, e.g. 15,836.28); the profile keeps them exactly ──
alter table public.vessel_economics_profiles alter column scnt type numeric(10,2);
alter table public.vessel_economics_profiles alter column scgt type numeric(10,2);

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
  v_scnt numeric; v_scgt numeric; v_gt integer;
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
  v_scnt := nullif(p_profile ->> 'scnt', '')::numeric;
  v_scgt := nullif(p_profile ->> 'scgt', '')::numeric;
  v_gt := nullif(p_profile ->> 'gt', '')::integer;
  if (v_speed_l is not null and (v_speed_l < 3 or v_speed_l > 40)) or (v_speed_b is not null and (v_speed_b < 3 or v_speed_b > 40)) then
    raise exception 'VE_INVALID: speeds must be between 3 and 40 knots' using errcode = '22023';
  end if;
  if (v_scnt is not null and v_scnt <= 0) or (v_scgt is not null and v_scgt <= 0) or (v_gt is not null and v_gt <= 0) then
    raise exception 'VE_INVALID: tonnages must be positive' using errcode = '22023';
  end if;
  if (v_scnt is not null and v_scnt <> round(v_scnt, 2)) or (v_scgt is not null and v_scgt <> round(v_scgt, 2)) then
    raise exception 'VE_INVALID: SCNT and SCGT carry at most two decimals' using errcode = '22023';
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
revoke all on function public.upsert_vessel_economics_profile(uuid, jsonb) from public, anon;
grant execute on function public.upsert_vessel_economics_profile(uuid, jsonb) to authenticated, service_role;
