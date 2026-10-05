-- 20261003205500_suez_voyage_review_fixes.sql — Stream S (5 Oct 2026), additive on 205400.
-- Answers Codex C2O-043 (early review of the 205400 tree) and Opus B B2O-012 PR-03/PR-04:
--   C2O-043 #2  `reported` confidence only on surcharge items (it is evidence for a surcharge rate only)
--   C2O-043 #5  a status change is attributed to the acting admin (publisher only for publication); notes changes
--               are audited
--   C2O-043 #6  vessel claims are keyed by the Auth user id; a position needs its vessel; a member's estimate that
--               links an organisation-owned listing must be owned by that organisation
--   C2O-043 #7  durable event origin (system | command) for the DOWN's used-state guard
--   C2O-043 #8  estimate-line status is NOT NULL; the service role can no longer insert runs/lines directly
--   C2O-043 #10 a version copy locks its source
--   C2O-043 #11 / PR-03 · route ECA split v3 also reports which zones contain the start and end of the route
--               (port-in-ECA from governed geometry) and a point lookup for the Suez anchorage
--   PR-04       voyage settings carry the Suez anchorage points and the list of owner-confirmed constants;
--               every other constant is shown as "platform assumption"

-- ── 1 · reported evidence is for surcharge rates only ───────────────────────
alter table public.suez_tariff_items drop constraint if exists suez_tariff_items_reported_ck;
alter table public.suez_tariff_items add constraint suez_tariff_items_reported_ck check (confidence = 'official' or layer = 'surcharge');

-- ── 2 · event attribution + durable origin ──────────────────────────────────
alter table public.suez_tariff_events add column if not exists origin text;
-- Rows written so far: a null actor at write time could only come from a migration (seed) or the system.
alter table public.suez_tariff_events disable trigger trg_suez_events_append_only;
update public.suez_tariff_events set origin = case when actor_user_id is null then 'system' else 'command' end where origin is null;
alter table public.suez_tariff_events enable trigger trg_suez_events_append_only;
alter table public.suez_tariff_events alter column origin set not null;
alter table public.suez_tariff_events drop constraint if exists suez_tariff_events_origin_ck;
alter table public.suez_tariff_events add constraint suez_tariff_events_origin_ck check (origin in ('system','command'));

-- Origin is decided once, at insert, from the actor the command carried; anonymisation later never changes it.
create or replace function public.fn_suez_event_origin()
returns trigger language plpgsql set search_path = pg_catalog, public as $fn$
begin
  new.origin := case when new.actor_user_id is null then 'system' else 'command' end;
  return new;
end; $fn$;
revoke all on function public.fn_suez_event_origin() from public, anon, authenticated;
drop trigger if exists trg_suez_event_origin on public.suez_tariff_events;
create trigger trg_suez_event_origin before insert on public.suez_tariff_events for each row execute function public.fn_suez_event_origin();

create or replace function public.fn_suez_version_events()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $vev$
declare v_actor uuid := public.fn_suez_actor();
begin
  if tg_op = 'INSERT' then
    insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
    values ('version', new.id, new.id, 'created', coalesce(v_actor, new.created_by),
            jsonb_build_object('versionNo', new.version_no, 'effectiveFrom', new.effective_from, 'effectiveTo', new.effective_to, 'sourceRef', new.source_ref, 'surchargeRegime', new.surcharge_regime));
  elsif tg_op = 'UPDATE' then
    if new.status <> old.status then
      insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
      values ('version', new.id, new.id, new.status,
              case when new.status = 'published' then coalesce(new.published_by, v_actor) else v_actor end,
              jsonb_build_object('from', old.status, 'to', new.status, 'versionNo', new.version_no));
    end if;
    if new.effective_to is distinct from old.effective_to then
      insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
      values ('version', new.id, new.id, 'window_changed', v_actor, jsonb_build_object('from', old.effective_to, 'to', new.effective_to));
    end if;
    if new.notes is distinct from old.notes then
      insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
      values ('version', new.id, new.id, 'notes_changed', v_actor, jsonb_build_object('from', old.notes, 'to', new.notes));
    end if;
  elsif tg_op = 'DELETE' then
    insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
    values ('version', old.id, old.id, 'draft_deleted', v_actor, jsonb_build_object('versionNo', old.version_no, 'sourceRef', old.source_ref));
  end if;
  return coalesce(new, old);
end;
$vev$;
revoke all on function public.fn_suez_version_events() from public, anon, authenticated;

-- ── 3 · a version copy reads a source that cannot change underneath it ─────
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
  -- Lock order everywhere: version-number lock → source parent (share) → new rows.
  perform pg_advisory_xact_lock(hashtext('asb.suez_tariff_version_no'));
  if p_copy_from is not null then
    perform 1 from public.suez_tariff_versions where id = p_copy_from for share;
    if not found then raise exception 'SUEZ_NOT_FOUND: version to copy from %', p_copy_from using errcode = 'P0002'; end if;
  end if;
  select coalesce(max(version_no), 0) + 1 into v_no from public.suez_tariff_versions;
  insert into public.suez_tariff_versions (version_no, status, effective_from, effective_to, source_ref, source_url, notes, surcharge_regime, created_by)
  values (v_no, 'draft', (p_version ->> 'effectiveFrom')::date, nullif(p_version ->> 'effectiveTo', '')::date,
          p_version ->> 'sourceRef', nullif(p_version ->> 'sourceUrl', ''), nullif(p_version ->> 'notes', ''), v_regime, p_actor)
  returning id into v_id;
  if p_copy_from is not null then
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
revoke all on function public.admin_suez_create_version(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.admin_suez_create_version(uuid, jsonb, uuid) to service_role;

-- Draft children lock their parent FOR UPDATE (fn_suez_lock_draft), so a copy holding FOR SHARE serializes with them.

-- ── 4 · saved runs: statused lines only, writes only through the save command ──
alter table public.voyage_estimate_lines disable trigger trg_voyage_lines_immutable;
update public.voyage_estimate_lines set status = 'unrecorded' where status is null;
alter table public.voyage_estimate_lines enable trigger trg_voyage_lines_immutable;
alter table public.voyage_estimate_lines drop constraint if exists voyage_estimate_lines_status_ck;
alter table public.voyage_estimate_lines add constraint voyage_estimate_lines_status_ck
  check (status in ('trusted','fallback','manual','unavailable','invalid','unrecorded'));
alter table public.voyage_estimate_lines alter column status set not null;
comment on column public.voyage_estimate_lines.status is
  'Governed status of the line. unrecorded = saved before 20261003205400 recorded statuses; the save command never writes it.';
revoke insert on table public.voyage_estimate_runs, public.voyage_estimate_lines from service_role;

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
        -- vessel_claims.user_id is the Auth user id (FK auth.users); map the application actor to it.
        when 'vessel' then exists (select 1 from public.vessel_claims vc join public.users u on u.id = p_actor
                                    where vc.vessel_id = p_id and vc.user_id = coalesce(u.supabase_user_id, u.id))
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
  v_admin boolean;
  v_vessel uuid := nullif(p_payload ->> 'vesselId', '')::uuid;
  v_avail uuid := nullif(p_payload ->> 'availabilityId', '')::uuid;
  v_cargo uuid := nullif(p_payload ->> 'cargoListingId', '')::uuid;
  v_req_org uuid := nullif(p_payload ->> 'ownerOrgId', '')::uuid;
  v_listing_org uuid;
begin
  if p_actor is null or not exists (select 1 from public.users u where u.id = p_actor and u.is_active) then
    raise exception 'VOYAGE_INVALID: unknown or inactive actor' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload -> 'input') <> 'object'
     or jsonb_typeof(p_payload -> 'result') <> 'object' or jsonb_typeof(p_payload -> 'totals') <> 'object' then
    raise exception 'VOYAGE_INVALID: payload needs input, result and totals objects' using errcode = '22023';
  end if;
  select exists (select 1 from public.users u where u.id = p_actor and lower(coalesce(u.role, '')) = 'admin') into v_admin;

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

  if v_avail is not null and v_vessel is null then
    raise exception 'VOYAGE_INVALID: a position is linked without its vessel' using errcode = '22023';
  end if;
  if not public.fn_voyage_may_reference(p_actor, 'vessel', v_vessel)
     or not public.fn_voyage_may_reference(p_actor, 'availability', v_avail)
     or not public.fn_voyage_may_reference(p_actor, 'cargo', v_cargo) then
    raise exception 'VOYAGE_FORBIDDEN: the estimate references a vessel, position or cargo you may not use' using errcode = '42501';
  end if;
  if v_avail is not null and not exists (select 1 from public.vessel_availability a where a.id = v_avail and a.vessel_id = v_vessel) then
    raise exception 'VOYAGE_INVALID: the position does not belong to the vessel' using errcode = '22023';
  end if;
  -- A member's estimate on an organisation-owned listing belongs to that organisation.
  if not v_admin then
    for v_listing_org in
      select lo.owner_org_id from public.listing_ownership lo
       where lo.is_current and lo.role = 'primary'::public.ownership_role_enum and lo.owner_org_id is not null
         and ((lo.listing_type::text = 'vessel_availability' and lo.listing_id = v_avail) or (lo.listing_type::text = 'cargo' and lo.listing_id = v_cargo))
    loop
      if v_org is distinct from v_listing_org then
        raise exception 'VOYAGE_FORBIDDEN: an estimate on an organisation listing must be owned by that organisation' using errcode = '42501';
      end if;
    end loop;
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

-- ── 5 · governed ECA facts for ports and the Suez anchorage ─────────────────

-- Zones in force on the date that contain a point.
create or replace function public.fn_point_eca_zones(p_lat numeric, p_lon numeric, p_as_of date default current_date)
returns text[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select coalesce(array_agg(z.code order by z.code), '{}')
    from public.eca_zones z
   where z.is_active and z.effective_from <= coalesce(p_as_of, current_date)
     and (z.effective_to is null or z.effective_to >= coalesce(p_as_of, current_date))
     and coalesce(public.fn_point_in_ring(p_lat, p_lon, z.polygon), false);
$fn$;
revoke all on function public.fn_point_eca_zones(numeric, numeric, date) from public, anon;
grant execute on function public.fn_point_eca_zones(numeric, numeric, date) to authenticated, service_role;

-- Split v3 = v2 + the zones containing the first and last waypoint (the ports' own ECA status) + `verified`.
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
  v_n integer;
  v_coarse boolean := false;
begin
  v_route := public.get_port_route(p_pol, p_pod);
  if v_route is null or coalesce((v_route ->> 'found')::boolean, false) = false then
    return jsonb_build_object('found', false, 'asOf', v_as_of, 'algorithmVersion', 'fn_route_eca_split/3');
  end if;
  v_total_nm := (v_route ->> 'total_nm')::numeric;
  v_wps := coalesce(v_route -> 'waypoints', '[]'::jsonb);
  v_n := jsonb_array_length(v_wps);
  if v_n < 2 then
    return jsonb_build_object('found', true, 'asOf', v_as_of, 'totalNm', v_total_nm, 'ecaNm', null, 'byZone', '{}'::jsonb,
                              'geometryVersions', '[]'::jsonb, 'method', 'distance_only', 'algorithmVersion', 'fn_route_eca_split/3',
                              'startZones', null, 'endZones', null, 'verified', coalesce((v_route ->> 'verified')::boolean, false),
                              'chokepoints', coalesce(v_route -> 'chokepoints', '[]'::jsonb), 'reversed', v_route -> 'reversed',
                              'directionSpecific', v_route -> 'direction_specific', 'source', v_route ->> 'source');
  end if;

  for v_zone in
    select code, polygon, geometry_version, confidence from public.eca_zones
     where is_active and effective_from <= v_as_of and (effective_to is null or effective_to >= v_as_of)
     order by code
  loop
    if v_zone.confidence <> 'official' then v_coarse := true; end if;
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
    'geometryVersions', v_versions, 'method', 'waypoints', 'algorithmVersion', 'fn_route_eca_split/3',
    'waypointCount', v_n,
    'startZones', to_jsonb(public.fn_point_eca_zones((v_wps -> 0 ->> 0)::numeric, (v_wps -> 0 ->> 1)::numeric, v_as_of)),
    'endZones', to_jsonb(public.fn_point_eca_zones((v_wps -> (v_n - 1) ->> 0)::numeric, (v_wps -> (v_n - 1) ->> 1)::numeric, v_as_of)),
    'verified', coalesce((v_route ->> 'verified')::boolean, false),
    'geometryConfidence', case when v_coarse then 'coarse' else 'official' end,
    'chokepoints', coalesce(v_route -> 'chokepoints', '[]'::jsonb),
    'reversed', v_route -> 'reversed', 'directionSpecific', v_route -> 'direction_specific', 'source', v_route ->> 'source');
end;
$split$;
revoke all on function public.fn_route_eca_split(text, text, date) from public, anon;
grant execute on function public.fn_route_eca_split(text, text, date) to authenticated, service_role;

-- ── 6 · settings: Suez anchorage points (data, admin-editable) ──────────────
-- Port Said outer anchorage (southbound convoys wait here) and Suez Bay anchorage (northbound), [lat, lon].
update public.app_settings
   set value = jsonb_set(value, '{suez,anchorages}', '{"SB": [31.35, 32.36], "NB": [29.88, 32.55]}'::jsonb, true)
 where key = 'voyage_settings' and jsonb_typeof(value -> 'suez') = 'object' and not (value -> 'suez' ? 'anchorages');

-- ── 7 · profile events vs vessel deletion (C2O-044 #11) ─────────────────────
-- The event log is append-only; deleting a vessel used to cascade into it and fail. The vessel reference is now
-- cleared instead (anonymisation), like the actor.
alter table public.vessel_economics_profile_events alter column vessel_id drop not null;
alter table public.vessel_economics_profile_events drop constraint if exists vessel_economics_profile_events_vessel_id_fkey;
alter table public.vessel_economics_profile_events add constraint vessel_economics_profile_events_vessel_id_fkey
  foreign key (vessel_id) references public.vessels(id) on delete set null;

create or replace function public.fn_suez_events_append_only()
returns trigger language plpgsql set search_path = pg_catalog, public as $ev$
begin
  if tg_op = 'UPDATE' and public.fn_is_anonymisation(to_jsonb(old), to_jsonb(new), array['actor_user_id','vessel_id']) then
    return new;
  end if;
  raise exception 'SUEZ_IMMUTABLE: events are append-only' using errcode = '55000';
end; $ev$;
revoke all on function public.fn_suez_events_append_only() from public, anon, authenticated;

-- ── 8 · publication of official figures needs official evidence on file (C2O-044 #6) ──
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
  -- Official toll bands or official items stand on an official instrument whose file is on record.
  if (exists (select 1 from public.suez_toll_tiers where version_id = p_version_id and confidence = 'official')
      or exists (select 1 from public.suez_tariff_items where version_id = p_version_id and is_active and confidence = 'official' and layer <> 'toll'))
     and not exists (select 1 from public.suez_tariff_version_sources vs join public.suez_tariff_sources s on s.id = vs.source_id
                      where vs.version_id = p_version_id and s.authority = 'official' and s.evidence_status = 'on_file') then
    raise exception 'SUEZ_INVALID: official figures need an official source on file (authority official, SHA-256 recorded) cited on the version' using errcode = '23514';
  end if;
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
revoke all on function public.admin_suez_publish(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_suez_publish(uuid, uuid, text) to service_role;
