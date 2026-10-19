-- ════════════════════════════════════════════════════════════════════════
-- PDA · immutable paired save and history (owner ruling O2ALL-008, 18 Oct 2026; increment A)
--
-- Design contract ("Persistence"): "The immutable estimate set will reference both immutable pda_estimates, both
-- tariff-version IDs, owner and organisation, route/timeline inputs, productivity, passage, OPEX, allocation, per-leg
-- coverage and not-sourced reasons. It carries a content hash and supersedes by creating a new set."
--
--   public.pda_estimate_sets — append-only (UPDATE and DELETE refused, PDA_IMMUTABLE); RLS on; no API grant.
--
--   pda_save_estimate_set(actor, org, load request, load result, discharge request, discharge result, route, supersedes)
--     service_role only. In ONE transaction it saves both legs through the existing pda_save_estimate (which re-checks
--     the actor's tier and organisation seat, the exact tariff version, line sums and every line's rule/source
--     evidence), then the set. The content hash is computed HERE from the canonical content (generatedAt excluded), never
--     taken from the caller. Saving the same content again while the owner's latest set already has it returns that
--     set (no duplicate). A supersede must name a set of the same owner, for the same vessel and cargo, that nothing
--     supersedes yet (one chain, serialised by an advisory lock), else PDA_CONFLICT.
--   list_my_pda_estimate_sets(limit, before)  — the caller's own sets and their organisation's (active seat), newest first
--   get_pda_estimate_set(id)                  — the full set with both legs (get_pda_estimate rules: owner, seat, admin)
--   Both reads: signed in + fn_pda_member_entitled(); authenticated + service_role.
--
-- Account erasure (H1) never deletes public.users (fn_anonymize_account, 20260923310000), so owner_user_id stays a
-- valid anonymous anchor and a saved set survives erasure; the test proves it.
-- Plain SQL. DOWN: supabase/rollback/20261018120000_pda_estimate_sets_down.sql (refuses while sets exist unless confirmed).
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

create table if not exists public.pda_estimate_sets (
  id                      uuid primary key default gen_random_uuid(),
  owner_user_id           uuid not null references public.users(id),
  owner_org_id            uuid,
  load_estimate_id        uuid not null references public.pda_estimates(id),
  discharge_estimate_id   uuid not null references public.pda_estimates(id),
  load_tariff_version_id      uuid,
  discharge_tariff_version_id uuid,
  vessel_availability_id  uuid not null,
  vessel_id               uuid,
  cargo_id                uuid not null,
  quantity_mt             numeric(18,3) not null check (quantity_mt > 0),
  allocation              text not null check (allocation in ('vessel', 'charterer')),
  display_currency        text not null check (display_currency ~ '^[A-Z]{3}$'),
  title                   text not null check (char_length(title) between 1 and 300),
  route_input             jsonb not null check (jsonb_typeof(route_input) = 'object'),
  timeline                jsonb not null check (jsonb_typeof(timeline) = 'object'),
  transits                jsonb not null check (jsonb_typeof(transits) = 'array'),
  totals                  jsonb not null check (jsonb_typeof(totals) = 'object'),
  not_sourced             jsonb not null check (jsonb_typeof(not_sourced) = 'array'),
  content_hash            text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  supersedes_id           uuid references public.pda_estimate_sets(id),
  created_at              timestamptz not null default now(),
  constraint pda_estimate_sets_legs_ck check (load_estimate_id <> discharge_estimate_id),
  constraint pda_estimate_sets_supersedes_once unique (supersedes_id)
);
create index if not exists pda_estimate_sets_owner_idx on public.pda_estimate_sets (owner_user_id, created_at desc);
create index if not exists pda_estimate_sets_org_idx on public.pda_estimate_sets (owner_org_id, created_at desc) where owner_org_id is not null;
alter table public.pda_estimate_sets enable row level security;
revoke all on table public.pda_estimate_sets from public, anon, authenticated, service_role;
comment on table public.pda_estimate_sets is
  'PDA paired save (O2ALL-008 A): one immutable set referencing both immutable leg estimates. Append-only; superseded only by a new set.';

create or replace function public.fn_pda_estimate_set_immutable()
returns trigger language plpgsql set search_path to '' as $$
begin
  raise exception 'PDA_IMMUTABLE: a saved estimate set is never edited or deleted; save a new set that supersedes it'
    using errcode = '55000';
end $$;
revoke all on function public.fn_pda_estimate_set_immutable() from public, anon, authenticated;
drop trigger if exists pda_estimate_sets_immutable on public.pda_estimate_sets;
create trigger pda_estimate_sets_immutable before update or delete on public.pda_estimate_sets
  for each row execute function public.fn_pda_estimate_set_immutable();
drop trigger if exists pda_estimate_sets_no_truncate on public.pda_estimate_sets;
create trigger pda_estimate_sets_no_truncate before truncate on public.pda_estimate_sets
  for each statement execute function public.fn_pda_estimate_set_immutable();

create or replace function public.pda_save_estimate_set(
  p_actor uuid,
  p_owner_org_id uuid,
  p_load_request jsonb,
  p_load_result jsonb,
  p_discharge_request jsonb,
  p_discharge_result jsonb,
  p_route jsonb,
  p_supersedes_id uuid default null
)
returns jsonb
language plpgsql volatile security definer set search_path to ''
as $$
declare
  v_hash text;
  v_existing public.pda_estimate_sets;
  v_prev public.pda_estimate_sets;
  v_load uuid;
  v_discharge uuid;
  v_id uuid;
  v_canonical jsonb := p_route->'canonical';
begin
  if p_route is null or jsonb_typeof(p_route) <> 'object' or jsonb_typeof(v_canonical) <> 'object'
     or jsonb_typeof(p_route->'routeInput') <> 'object' or jsonb_typeof(p_route->'timeline') <> 'object'
     or jsonb_typeof(p_route->'transits') <> 'array' or jsonb_typeof(p_route->'totals') <> 'object'
     or jsonb_typeof(p_route->'notSourced') <> 'array' then
    raise exception 'PDA_INPUT: the route snapshot is incomplete' using errcode = '22023';
  end if;
  if upper(trim(p_load_request->>'portLocode')) is distinct from upper(trim(p_route#>>'{routeInput,load,portLocode}'))
     or upper(trim(p_discharge_request->>'portLocode')) is distinct from upper(trim(p_route#>>'{routeInput,discharge,portLocode}')) then
    raise exception 'PDA_INPUT: the leg requests do not match the route' using errcode = '22023';
  end if;

  -- the hash of what was estimated (generation instants excluded, so the same content always has the same hash)
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'load', jsonb_build_object('request', p_load_request, 'result', p_load_result - 'generatedAt'),
    'discharge', jsonb_build_object('request', p_discharge_request, 'result', p_discharge_result - 'generatedAt'),
    'route', jsonb_build_object('canonical', v_canonical, 'routeInput', p_route->'routeInput', 'timeline', p_route->'timeline',
                                'transits', p_route->'transits', 'totals', p_route->'totals', 'notSourced', p_route->'notSourced',
                                'allocation', p_route->'allocation', 'displayCurrency', p_route->'displayCurrency')
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtext('pda_estimate_set_owner:' || p_actor::text));

  -- the actor is re-checked before ANY answer, the replay included (B2O-044 P2-5): active, T3+/partner/admin
  if not exists (select 1 from public.users u where u.id = p_actor and u.is_active
                 and (lower(coalesce(u.role, '')) = 'admin' or u.subscription_tier::text in ('T3','T4')
                      or coalesce((to_jsonb(u)->>'is_market_partner')::boolean, false))) then
    raise exception 'PDA_TIER: actor requires an active Subscriber (T3+) account' using errcode = '42501';
  end if;

  -- idempotent: the same content again, while it is still the owner's latest version of it, returns that set
  select s.* into v_existing from public.pda_estimate_sets s
   where s.owner_user_id = p_actor and s.content_hash = v_hash
     and not exists (select 1 from public.pda_estimate_sets n where n.supersedes_id = s.id)
   order by s.created_at desc limit 1;
  if v_existing.id is not null and v_existing.owner_org_id is not distinct from p_owner_org_id
     and (p_supersedes_id is null or p_supersedes_id = v_existing.id or p_supersedes_id = v_existing.supersedes_id) then
    return jsonb_build_object('id', v_existing.id, 'contentHash', v_existing.content_hash, 'createdAt', v_existing.created_at,
                              'loadEstimateId', v_existing.load_estimate_id, 'dischargeEstimateId', v_existing.discharge_estimate_id,
                              'replayed', true);
  end if;

  if p_supersedes_id is not null then
    select s.* into v_prev from public.pda_estimate_sets s where s.id = p_supersedes_id;
    if v_prev.id is null or v_prev.owner_user_id <> p_actor then
      raise exception 'PDA_AUTH: only the owner of a saved set can supersede it' using errcode = '42501';
    end if;
    if v_prev.vessel_availability_id <> (v_canonical->>'vesselAvailabilityId')::uuid or v_prev.cargo_id <> (v_canonical->>'cargoId')::uuid then
      raise exception 'PDA_CONFLICT: a new version must be for the same vessel and cargo; save a different route as a new estimate' using errcode = '40001';
    end if;
    if exists (select 1 from public.pda_estimate_sets n where n.supersedes_id = v_prev.id) then
      raise exception 'PDA_CONFLICT: this saved set has already been superseded; open the latest version' using errcode = '40001';
    end if;
  end if;

  -- both legs through the existing governed save (tier, seat, version, sums, evidence), in this same transaction
  v_load := public.pda_save_estimate(p_actor, p_owner_org_id, p_load_request, p_load_result,
                                     case when v_prev.id is not null then v_prev.load_estimate_id end);
  v_discharge := public.pda_save_estimate(p_actor, p_owner_org_id, p_discharge_request, p_discharge_result,
                                          case when v_prev.id is not null then v_prev.discharge_estimate_id end);

  insert into public.pda_estimate_sets (
    owner_user_id, owner_org_id, load_estimate_id, discharge_estimate_id,
    load_tariff_version_id, discharge_tariff_version_id,
    vessel_availability_id, vessel_id, cargo_id, quantity_mt, allocation, display_currency, title,
    route_input, timeline, transits, totals, not_sourced, content_hash, supersedes_id
  ) values (
    p_actor, p_owner_org_id, v_load, v_discharge,
    nullif(p_load_result->>'tariffVersionId','')::uuid, nullif(p_discharge_result->>'tariffVersionId','')::uuid,
    (v_canonical->>'vesselAvailabilityId')::uuid, nullif(v_canonical->>'vesselId','')::uuid, (v_canonical->>'cargoId')::uuid,
    (v_canonical->>'quantityMt')::numeric, p_route->>'allocation', upper(p_route->>'displayCurrency'), p_route->>'title',
    p_route->'routeInput', p_route->'timeline', p_route->'transits', p_route->'totals', p_route->'notSourced', v_hash, v_prev.id
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'contentHash', v_hash, 'createdAt', now(),
                            'loadEstimateId', v_load, 'dischargeEstimateId', v_discharge, 'replayed', false);
end;
$$;
revoke all on function public.pda_save_estimate_set(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.pda_save_estimate_set(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid) to service_role;

create or replace function public.list_my_pda_estimate_sets(p_limit integer default 20, p_before timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare v_user uuid := public.fn_app_user_id(); v_result jsonb;
begin
  if v_user is null then
    raise exception 'PDA_AUTH: sign in required' using errcode = '42501';
  end if;
  if not public.fn_pda_member_entitled() then
    raise exception 'PDA_TIER: PDA Estimator requires Subscriber tier (T3+)' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id desc), '[]'::jsonb) into v_result
  from (
    select s.created_at, s.id, jsonb_build_object(
      'id', s.id, 'title', s.title, 'createdAt', s.created_at,
      'loadPort', s.route_input#>>'{load,portLocode}', 'dischargePort', s.route_input#>>'{discharge,portLocode}',
      'displayCurrency', s.display_currency, 'allocation', s.allocation,
      'allInKnown', s.totals->'allInKnown', 'allInComplete', s.totals->'allInComplete',
      'notSourcedCount', jsonb_array_length(s.not_sourced),
      'contentHash', s.content_hash, 'supersedesId', s.supersedes_id,
      'isLatest', not exists (select 1 from public.pda_estimate_sets n where n.supersedes_id = s.id),
      'mine', s.owner_user_id = v_user
    ) as item
    from public.pda_estimate_sets s
    where (s.owner_user_id = v_user
           or (s.owner_org_id is not null and exists (
                 select 1 from public.organization_members m
                  where m.org_id = s.owner_org_id and m.user_id = v_user and m.is_current and m.status = 'active')))
      and (p_before is null or s.created_at < p_before)
    order by s.created_at desc, s.id desc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  ) x;
  return v_result;
end;
$$;
revoke all on function public.list_my_pda_estimate_sets(integer, timestamptz) from public, anon;
grant execute on function public.list_my_pda_estimate_sets(integer, timestamptz) to authenticated, service_role;

-- One leg as a MEMBER sees it (B2O-044 P1-1, C2O-120/126): no tariff-version, rule, source or terminal id and no raw
-- request; the published edition by its frozen label; evidence by title/page/sheet/excerpt only. A manual line saved
-- with the owner marker '@owner' (B2O-044 P1-4) is attributed at READ time: the owner's current name, or
-- "Deleted account" once the account is erased - no name is frozen in the immutable record.
create or replace function public.fn_pda_member_leg(p_estimate_id uuid, p_owner uuid)
returns jsonb
language sql stable security definer set search_path to ''
as $fn$
  select jsonb_build_object(
    'portLocode', e.port_locode,
    'terminalName', e.terminal_name,
    'coverage', e.coverage,
    'editionLabel', v.edition_label,
    'callDate', e.call_date,
    'nativeCurrency', e.native_currency,
    'nativeTotal', e.native_total,
    'convertedCurrency', e.converted_currency,
    'convertedTotal', e.converted_total,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lineNo', l.line_no, 'ruleCode', l.rule_code, 'label', l.label, 'basis', l.basis,
        'quantity', l.quantity, 'rate', l.rate, 'amount', l.amount, 'convertedAmount', l.converted_amount,
        'explanation', l.explanation,
        'evidence', jsonb_strip_nulls(jsonb_build_object('title', l.evidence->>'title', 'page', l.evidence->>'page',
                                                         'sheet', l.evidence->>'sheet', 'excerpt', l.evidence->>'excerpt')),
        'manual', l.is_manual, 'manualReason', l.manual_reason,
        'enteredBy', case
          when l.entered_by_label = '@owner' then
            (select case when u.erased_at is not null then 'Deleted account' else coalesce(nullif(btrim(u.full_name), ''), 'Member') end
               from public.users u where u.id = p_owner)
          else l.entered_by_label end
      ) order by l.line_no)
      from public.pda_estimate_lines l where l.estimate_id = e.id), '[]'::jsonb)
  )
  from public.pda_estimates e
  left join public.port_tariff_versions v on v.id = e.tariff_version_id
  where e.id = p_estimate_id;
$fn$;
revoke all on function public.fn_pda_member_leg(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_pda_estimate_set(p_set_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $fn$
declare s public.pda_estimate_sets;
begin
  if public.fn_app_user_id() is null then
    raise exception 'PDA_AUTH: sign in required' using errcode = '42501';
  end if;
  if not public.fn_pda_member_entitled() then
    raise exception 'PDA_TIER: PDA Estimator requires Subscriber tier (T3+)' using errcode = '42501';
  end if;
  select * into s from public.pda_estimate_sets x where x.id = p_set_id;
  -- the same reader rule as get_pda_estimate (owner, active organisation seat, admin); a stranger and an unknown id
  -- get the same answer
  if s.id is null or not public.fn_can_read_pda_estimate(s.load_estimate_id) then
    raise exception 'PDA_AUTH: estimate set is not accessible' using errcode = '42501';
  end if;
  -- an explicit member projection: the stored snapshot keeps its ids, the member never receives them
  return jsonb_build_object(
    'id', s.id, 'title', s.title, 'createdAt', s.created_at, 'contentHash', s.content_hash,
    'supersedesId', s.supersedes_id,
    'isLatest', not exists (select 1 from public.pda_estimate_sets n where n.supersedes_id = s.id),
    'allocation', s.allocation, 'displayCurrency', s.display_currency, 'quantityMt', s.quantity_mt,
    'route', jsonb_build_object(
      'loadPort', s.route_input#>>'{load,portLocode}', 'dischargePort', s.route_input#>>'{discharge,portLocode}',
      'loadCallDate', s.route_input#>>'{load,callDate}', 'dischargeCallDate', s.route_input#>>'{discharge,callDate}'),
    'timeline', s.timeline,
    'transits', coalesce((select jsonb_agg(t - 'tariffVersionId') from jsonb_array_elements(s.transits) t), '[]'::jsonb),
    'totals', s.totals,
    'notSourced', coalesce((select jsonb_agg(i #- '{provenance,tariffVersionId}' #- '{provenance,ruleId}' #- '{provenance,sourceId}')
                            from jsonb_array_elements(s.not_sourced) i), '[]'::jsonb),
    'load', public.fn_pda_member_leg(s.load_estimate_id, s.owner_user_id),
    'discharge', public.fn_pda_member_leg(s.discharge_estimate_id, s.owner_user_id)
  );
end;
$fn$;
revoke all on function public.get_pda_estimate_set(uuid) from public, anon;
grant execute on function public.get_pda_estimate_set(uuid) to authenticated, service_role;
