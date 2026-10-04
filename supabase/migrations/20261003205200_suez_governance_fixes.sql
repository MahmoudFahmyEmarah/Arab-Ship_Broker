-- 20261003205200_suez_governance_fixes.sql — Stream S (4 Oct 2026), additive on 205000/205100.
--
-- Found by supabase/tests/voyage_economics/suez_governance_smoke.sql on the local stack:
--   1. fn_suez_validate_version let a MISSING params key through: comparing jsonb_typeof(NULL)
--      with the not-equal operator yields NULL, never true, so {"basis":"flat","params":{}} published.
--   2. The event triggers called fn_market_actor() directly, which raises MARKET_AUTH for the
--      service role — every admin server action that closes a version window, withdraws or
--      deletes a draft (incl. the window close inside publication) failed.
-- Fixes: null-safe validation; fn_suez_actor() resolves the actor as (a) the public.users.id an
-- admin RPC handed over in this transaction (GUC asb.actor_user_id), else (b) the authenticated
-- member, else (c) null — the event row is still written; admin RPCs that carry the actor.

-- ── 1 · actor resolution that survives service-role writes ──────────────────
create or replace function public.fn_suez_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare v uuid;
begin
  begin
    v := nullif(current_setting('asb.actor_user_id', true), '')::uuid;
  exception when others then
    v := null;
  end;
  if v is not null then return v; end if;
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then return null; end if;
  return public.fn_market_actor();
end;
$fn$;
revoke all on function public.fn_suez_actor() from public, anon, authenticated;

create or replace function public.fn_suez_version_events()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $vev$
begin
  if tg_op = 'INSERT' then
    insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
    values ('version', new.id, new.id, 'created', coalesce(new.created_by, public.fn_suez_actor()), jsonb_build_object('versionNo', new.version_no, 'effectiveFrom', new.effective_from, 'effectiveTo', new.effective_to, 'sourceRef', new.source_ref));
  elsif tg_op = 'UPDATE' then
    if new.status <> old.status then
      insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
      values ('version', new.id, new.id, new.status, coalesce(new.published_by, public.fn_suez_actor()), jsonb_build_object('from', old.status, 'to', new.status, 'versionNo', new.version_no));
    end if;
    if new.effective_to is distinct from old.effective_to then
      insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
      values ('version', new.id, new.id, 'window_changed', public.fn_suez_actor(), jsonb_build_object('from', old.effective_to, 'to', new.effective_to));
    end if;
  elsif tg_op = 'DELETE' then
    insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
    values ('version', old.id, old.id, 'draft_deleted', public.fn_suez_actor(), jsonb_build_object('versionNo', old.version_no, 'sourceRef', old.source_ref));
  end if;
  return coalesce(new, old);
end;
$vev$;
revoke all on function public.fn_suez_version_events() from public, anon, authenticated;

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
  values ('sdr_rate', new.id, 'voided', coalesce(new.voided_by, public.fn_suez_actor()), jsonb_build_object('asOf', new.as_of, 'rateUsd', new.rate_usd, 'reason', new.void_reason));
  return new;
end;
$sdr_guard$;
revoke all on function public.fn_sdr_rates_guard() from public, anon, authenticated;

create or replace function public.fn_sdr_rates_events()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $sdr_ev$
begin
  insert into public.suez_tariff_events (entity, entity_id, action, actor_user_id, details)
  values ('sdr_rate', new.id, 'recorded', coalesce(new.created_by, public.fn_suez_actor()), jsonb_build_object('asOf', new.as_of, 'rateUsd', new.rate_usd, 'source', new.source));
  return new;
end;
$sdr_ev$;
revoke all on function public.fn_sdr_rates_events() from public, anon, authenticated;

-- ── 2 · null-safe validation (a missing key is as invalid as a wrong type) ──
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
          if jsonb_typeof(t -> 'from') is distinct from 'number' or (t ->> 'from')::numeric is distinct from prev_to then
            raise exception 'SUEZ_INVALID: item % tiers must be contiguous from 0 (band starting at % after %)', it.code, coalesce(t ->> 'from', 'null'), prev_to using errcode = '23514';
          end if;
          if jsonb_typeof(t -> 'amount') is distinct from 'number' or jsonb_typeof(t -> 'includedUnits') is distinct from 'number' then
            raise exception 'SUEZ_INVALID: item % tier needs numeric amount and includedUnits', it.code using errcode = '23514';
          end if;
          if t -> 'to' is null or jsonb_typeof(t -> 'to') = 'null' then prev_to := null; exit; end if;
          if jsonb_typeof(t -> 'to') is distinct from 'number' then
            raise exception 'SUEZ_INVALID: item % tier upper bound must be a number or null', it.code using errcode = '23514';
          end if;
          prev_to := (t ->> 'to')::numeric;
        end loop;
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
    -- Conditions with tariff-defined thresholds must carry them (no constants in code).
    if it.condition_key = 'no_mooring_cranes' and (jsonb_typeof(it.params -> 'gtThreshold') is distinct from 'number' or jsonb_typeof(it.params -> 'swlMt') is distinct from 'number' or jsonb_typeof(it.params -> 'boats') is distinct from 'number') then
      raise exception 'SUEZ_INVALID: item % needs gtThreshold, swlMt and boats in params', it.code using errcode = '23514';
    end if;
    if it.condition_key = 'overage' and jsonb_typeof(it.params -> 'ageYears') is distinct from 'number' then
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

-- ── 3 · admin RPCs: the acting admin (public.users.id) travels into the trigger trail ──
create or replace function public.fn_suez_require_actor(p_actor uuid)
returns void
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if p_actor is null or not exists (select 1 from public.users u where u.id = p_actor and u.is_active) then
    raise exception 'SUEZ_ACTOR: an active public.users.id is required' using errcode = '42501';
  end if;
  perform set_config('asb.actor_user_id', p_actor::text, true);
end;
$fn$;
revoke all on function public.fn_suez_require_actor(uuid) from public, anon, authenticated;

create or replace function public.admin_suez_set_window(p_version_id uuid, p_actor uuid, p_effective_to date, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform public.fn_suez_require_actor(p_actor);
  update public.suez_tariff_versions
     set effective_to = p_effective_to,
         notes = coalesce(p_notes, notes)
   where id = p_version_id;
  if not found then raise exception 'SUEZ_NOT_FOUND: version %', p_version_id using errcode = 'P0002'; end if;
end;
$fn$;
revoke all on function public.admin_suez_set_window(uuid, uuid, date, text) from public, anon, authenticated;
grant execute on function public.admin_suez_set_window(uuid, uuid, date, text) to service_role;

create or replace function public.admin_suez_set_status(p_version_id uuid, p_actor uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform public.fn_suez_require_actor(p_actor);
  if p_status not in ('published', 'withdrawn', 'superseded') then
    raise exception 'SUEZ_INVALID: status % is not a transition', p_status using errcode = '23514';
  end if;
  update public.suez_tariff_versions
     set status = p_status,
         published_at = case when p_status = 'published' then now() else published_at end,
         published_by = case when p_status = 'published' then p_actor else published_by end
   where id = p_version_id;
  if not found then raise exception 'SUEZ_NOT_FOUND: version %', p_version_id using errcode = 'P0002'; end if;
end;
$fn$;
revoke all on function public.admin_suez_set_status(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_suez_set_status(uuid, uuid, text) to service_role;

create or replace function public.admin_suez_delete_draft(p_version_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform public.fn_suez_require_actor(p_actor);
  delete from public.suez_tariff_versions where id = p_version_id and status = 'draft';
  if not found then raise exception 'SUEZ_NOT_FOUND: no draft version %', p_version_id using errcode = 'P0002'; end if;
end;
$fn$;
revoke all on function public.admin_suez_delete_draft(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_suez_delete_draft(uuid, uuid) to service_role;
