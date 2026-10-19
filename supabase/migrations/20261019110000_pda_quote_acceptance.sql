-- ════════════════════════════════════════════════════════════════════════
-- PDA · accept an agency quote into a new version of the saved estimate (owner decision O2ALL-009 A4; Agents phase 3)
--
-- The requester accepts ONE quote: the server recomputes the route from the saved set's own input, prices the quoted
-- port from the quote's lines (basis 'agency_quote', attributed to the agency) and saves a new set that supersedes
-- the one the request was made from. The database re-checks that the quoted leg IS the quote — same port, currency,
-- lines in order and total, no tariff version — so no other figure can be passed off as an agency quote.
--
--   pda_estimate_lines.basis        — also accepts 'agency_quote' (manual, attributed, never a tariff rule or source)
--   pda_quote_acceptances           — one row per accepted quote (one per request); append-only
--   pda_quote_acceptance_context(actor, quote)   service only: what the server needs to rebuild the route (incl. the
--                                                saved route input, which never goes to the browser)
--   pda_accept_agency_quote(actor, org, quote, legs…, route)   service only: checks, saves the superseding set through
--                                                pda_save_estimate_set, records the acceptance, notifies the agency
--   fn_pda_recipient_quotes         — now also says which quote was accepted (both sides)
--   list_agency_pda_quote_requests  — requestStatus 'accepted' once a quote of the request is accepted
--   a request with an accepted quote is CLOSED: no new quote, decline or withdraw (triggers)
--   fn_pda_leg_matches_quote        — the one check that a priced leg IS a quote (native + governed FX figures)
--   fn_pda_carried_quote            — the other port's still-effective accepted quote along the supersede lineage
-- Plain SQL. DOWN: supabase/rollback/20261019110000_pda_quote_acceptance_down.sql (refuses while acceptances exist).
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

-- a saved line may carry the basis 'agency_quote' (an accepted agency quote's line; manual, attributed, no tariff rule)
alter table public.pda_estimate_lines drop constraint if exists pda_estimate_lines_basis_ck;
alter table public.pda_estimate_lines add constraint pda_estimate_lines_basis_ck check (basis in (
    'flat','per_call','per_day','per_hour','per_gt','per_nt','per_scnrt','per_dwt','per_loa',
    'per_cargo_mt','per_unit','per_gt_day','per_loa_day','per_loa_hour',
    'percentage','tiered_flat','tiered_rate','progressive','manual_quote','manual','agency_quote'
  ));
alter table public.pda_estimate_lines drop constraint if exists pda_estimate_lines_agency_quote_ck;
alter table public.pda_estimate_lines add constraint pda_estimate_lines_agency_quote_ck check (
  basis <> 'agency_quote' or (is_manual and tariff_rule_id is null and source_id is null));

create table if not exists public.pda_quote_acceptances (
  quote_id       uuid primary key references public.pda_agency_quotes(id),
  request_id     uuid not null unique references public.pda_quote_requests(id),
  agency_org_id  uuid not null references public.pda_agencies(org_id),
  set_id         uuid not null unique references public.pda_estimate_sets(id),
  accepted_by    uuid not null references public.users(id),
  created_at     timestamptz not null default now()
);
alter table public.pda_quote_acceptances enable row level security;
revoke all on table public.pda_quote_acceptances from public, anon, authenticated, service_role;
comment on table public.pda_quote_acceptances is
  'PDA Agents phase 3 (O2ALL-009 A4): the quote a requester accepted and the estimate set it became. Append-only.';

create or replace function public.fn_pda_quote_acceptance_immutable()
returns trigger language plpgsql set search_path to '' as $$
begin
  raise exception 'PDA_IMMUTABLE: an accepted quote is never edited or deleted' using errcode = '55000';
end $$;
revoke all on function public.fn_pda_quote_acceptance_immutable() from public, anon, authenticated;
drop trigger if exists pda_quote_acceptances_immutable on public.pda_quote_acceptances;
create trigger pda_quote_acceptances_immutable before update or delete on public.pda_quote_acceptances
  for each row execute function public.fn_pda_quote_acceptance_immutable();
drop trigger if exists pda_quote_acceptances_no_truncate on public.pda_quote_acceptances;
create trigger pda_quote_acceptances_no_truncate before truncate on public.pda_quote_acceptances
  for each statement execute function public.fn_pda_quote_acceptance_immutable();

-- the quotes of one recipient row, latest revision first; now with the acceptance (replaces the 20261019100000 body)
create or replace function public.fn_pda_recipient_quotes(p_request_id uuid, p_agency uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'quoteId', q.id, 'revision', q.revision, 'currency', q.currency, 'lines', q.lines, 'total', q.total,
    'validUntil', q.valid_until, 'reference', q.reference, 'note', q.note, 'createdAt', q.created_at,
    'accepted', a.quote_id is not null, 'acceptedAt', a.created_at
  ) order by q.revision desc), '[]'::jsonb)
  from public.pda_agency_quotes q
  left join public.pda_quote_acceptances a on a.quote_id = q.id
  where q.request_id = p_request_id and q.agency_org_id = p_agency;
$$;
revoke all on function public.fn_pda_recipient_quotes(uuid, uuid) from public, anon, authenticated;

-- a request with an accepted quote is closed (pre-audit P1-1): no further quote, decline or withdraw
create or replace function public.fn_pda_quote_request_closed()
returns trigger language plpgsql set search_path to '' as $$
-- the row is read through to_jsonb: PL/pgSQL resolves record fields even in a branch that is not taken
declare v_request uuid := case when tg_table_name = 'pda_quote_requests' then (to_jsonb(old)->>'id')::uuid
                               else (to_jsonb(new)->>'request_id')::uuid end;
begin
  if exists (select 1 from public.pda_quote_acceptances a where a.request_id = v_request) then
    raise exception 'PDA_STATE: a quote from this request has already been accepted' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function public.fn_pda_quote_request_closed() from public, anon, authenticated;
drop trigger if exists pda_agency_quotes_closed on public.pda_agency_quotes;
create trigger pda_agency_quotes_closed before insert on public.pda_agency_quotes
  for each row execute function public.fn_pda_quote_request_closed();
drop trigger if exists pda_quote_request_recipients_closed on public.pda_quote_request_recipients;
create trigger pda_quote_request_recipients_closed before update on public.pda_quote_request_recipients
  for each row execute function public.fn_pda_quote_request_closed();
drop trigger if exists pda_quote_requests_closed on public.pda_quote_requests;
create trigger pda_quote_requests_closed before update on public.pda_quote_requests
  for each row execute function public.fn_pda_quote_request_closed();

-- the agency inbox, now saying 'accepted' (replaces the 20261019100000 body; the DOWN restores it)
create or replace function public.list_agency_pda_quote_requests()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_result jsonb;
begin
  if public.fn_app_user_id() is null then raise exception 'PDA_AUTH: sign in required' using errcode = '42501'; end if;
  -- the agency inbox: requests addressed to an active listed agency the caller staffs; the snapshot is already masked
  select coalesce(jsonb_agg(jsonb_build_object(
    'requestId', r.id, 'agencyId', rc.agency_org_id, 'agencyName', a.display_name,
    'port', r.port_locode, 'snapshot', r.snapshot, 'services', to_jsonb(r.services), 'note', r.note,
    'requestStatus', case when exists (select 1 from public.pda_quote_acceptances qa where qa.request_id = r.id) then 'accepted'
                          when r.status = 'withdrawn' then 'withdrawn' when r.expires_at < now() then 'expired' else 'open' end,
    'createdAt', r.created_at, 'expiresAt', r.expires_at,
    'myStatus', rc.status, 'declineReason', rc.decline_reason, 'respondedAt', rc.responded_at,
    'quotes', public.fn_pda_recipient_quotes(r.id, rc.agency_org_id)
  ) order by r.created_at desc), '[]'::jsonb) into v_result
  from public.pda_quote_request_recipients rc
  join public.pda_quote_requests r on r.id = rc.request_id
  join public.pda_agencies a on a.org_id = rc.agency_org_id
  where public.fn_pda_is_agency_staff(rc.agency_org_id);
  return v_result;
end $$;
revoke all on function public.list_agency_pda_quote_requests() from public, anon;
grant execute on function public.list_agency_pda_quote_requests() to authenticated, service_role;

-- is this priced leg exactly the quote? native lines in order (label, service, amount, attribution, no rule), currency,
-- total, no tariff version; converted figures only at the governed rate for the call date (pre-audit P2-10)
create or replace function public.fn_pda_leg_matches_quote(p_req jsonb, p_res jsonb, p_quote_id uuid, p_port text)
returns boolean language plpgsql stable security definer set search_path to '' as $$
declare
  q public.pda_agency_quotes;
  v_agency text;
  v_conv text := nullif(upper(coalesce(p_res->>'convertedCurrency', '')), '');
  v_rate numeric;
begin
  select * into q from public.pda_agency_quotes x where x.id = p_quote_id;
  if q.id is null then return false; end if;
  select a.display_name into v_agency from public.pda_agencies a where a.org_id = q.agency_org_id;
  if upper(coalesce(p_req->>'portLocode', '')) <> p_port
     or coalesce(p_res->>'coverage', '') <> 'manual_required' or nullif(p_res->>'tariffVersionId', '') is not null
     or upper(coalesce(p_res->>'nativeCurrency', '')) <> q.currency
     or jsonb_typeof(p_res->'lines') is distinct from 'array'
     or (p_res#>>'{totals,native}')::numeric is distinct from q.total
     or jsonb_array_length(p_res->'lines') <> jsonb_array_length(q.lines)
     or exists (
          select 1 from jsonb_array_elements(p_res->'lines') with ordinality l(v, n)
          join jsonb_array_elements(q.lines) with ordinality ql(v, n) on ql.n = l.n
          where l.v->>'basis' is distinct from 'agency_quote'
             or (l.v->>'amount')::numeric is distinct from (ql.v->>'amount')::numeric
             or l.v->>'label' is distinct from ql.v->>'label'
             or coalesce(l.v->>'ruleCode', '') <> coalesce(ql.v->>'serviceCode', '')
             or nullif(l.v->>'ruleId', '') is not null
             or l.v->>'enteredBy' is distinct from v_agency) then
    return false;
  end if;
  if v_conv is null or v_conv = q.currency then
    -- not converted: no converted figure may be carried
    return nullif(p_res#>>'{totals,converted}', '') is null
       and not exists (select 1 from jsonb_array_elements(p_res->'lines') l where nullif(l->>'convertedAmount', '') is not null);
  end if;
  v_rate := nullif(public.fn_pda_fx_rate(q.currency, v_conv, (p_req->>'callDate')::date)->>'rate', '')::numeric;
  if v_rate is null or v_rate <= 0 then return false; end if;
  return not exists (
           select 1 from jsonb_array_elements(p_res->'lines') l
           where nullif(l->>'convertedAmount', '') is null
              or abs((l->>'convertedAmount')::numeric - round((l->>'amount')::numeric * v_rate, 2)) > 0.005)
     and abs(coalesce(nullif(p_res#>>'{totals,converted}', '')::numeric, -1)
             - (select sum(round((l->>'amount')::numeric * v_rate, 2)) from jsonb_array_elements(p_res->'lines') l)) <= 0.005;
end $$;
revoke all on function public.fn_pda_leg_matches_quote(jsonb, jsonb, uuid, text) from public, anon, authenticated;

-- the quote the OTHER port of a set still carries (Codex C2O-159 P1-4): when that leg of the set holds agency_quote
-- lines, the latest acceptance for that leg along the set's supersede lineage (the set itself, then what it
-- superseded, …). A plain re-save that dropped the agency lines carries nothing.
create or replace function public.fn_pda_carried_quote(p_set_id uuid, p_leg text, out quote_id uuid, out port_locode text)
language plpgsql stable security definer set search_path to '' as $$
declare v_leg_estimate uuid;
begin
  select case when p_leg = 'load' then s.load_estimate_id else s.discharge_estimate_id end into v_leg_estimate
    from public.pda_estimate_sets s where s.id = p_set_id;
  if v_leg_estimate is null
     or not exists (select 1 from public.pda_estimate_lines l where l.estimate_id = v_leg_estimate and l.basis = 'agency_quote') then
    return;
  end if;
  with recursive chain(id, depth) as (
    select p_set_id, 0
    union all
    select s.supersedes_id, c.depth + 1 from chain c join public.pda_estimate_sets s on s.id = c.id
     where s.supersedes_id is not null and c.depth < 1000
  )
  select pa.quote_id, pr.port_locode into quote_id, port_locode
    from chain c
    join public.pda_quote_acceptances pa on pa.set_id = c.id
    join public.pda_quote_requests pr on pr.id = pa.request_id and pr.leg = p_leg
   order by c.depth
   limit 1;
end $$;
revoke all on function public.fn_pda_carried_quote(uuid, text) from public, anon, authenticated;

create or replace function public.pda_quote_acceptance_context(p_actor uuid, p_quote_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare q public.pda_agency_quotes; r public.pda_quote_requests; s public.pda_estimate_sets;
begin
  select * into q from public.pda_agency_quotes x where x.id = p_quote_id;
  select * into r from public.pda_quote_requests x where x.id = q.request_id;
  if q.id is null or r.requester_user_id is distinct from p_actor then
    raise exception 'PDA_AUTH: only the member who requested this quote can accept it' using errcode = '42501';
  end if;
  select * into s from public.pda_estimate_sets x where x.id = r.set_id;
  return jsonb_build_object(
    'quoteId', q.id, 'requestId', r.id, 'setId', s.id, 'leg', r.leg, 'port', r.port_locode,
    'agencyName', (select a.display_name from public.pda_agencies a where a.org_id = q.agency_org_id),
    'currency', q.currency, 'total', q.total, 'revision', q.revision, 'reference', q.reference, 'validUntil', q.valid_until,
    'lines', q.lines, 'routeInput', s.route_input,
    'requestStatus', case when r.status = 'open' and r.expires_at < now() then 'expired' else r.status end,
    'setIsLatest', not exists (select 1 from public.pda_estimate_sets n where n.supersedes_id = s.id),
    'latestRevision', not exists (select 1 from public.pda_agency_quotes x
                                   where x.request_id = q.request_id and x.agency_org_id = q.agency_org_id and x.revision > q.revision),
    'accepted', exists (select 1 from public.pda_quote_acceptances a where a.request_id = r.id),
    'agencyActive', exists (select 1 from public.pda_agencies a where a.org_id = q.agency_org_id and a.status = 'active'),
    -- the other port's still-effective accepted quote, found through the supersede lineage (C2O-159 P1-4)
    'carried', (select jsonb_build_object('leg', case when r.leg = 'load' then 'discharge' else 'load' end, 'quoteId', pq.id, 'port', c.port_locode,
                  'agencyName', (select a.display_name from public.pda_agencies a where a.org_id = pq.agency_org_id),
                  'currency', pq.currency, 'total', pq.total, 'revision', pq.revision, 'reference', pq.reference,
                  'validUntil', pq.valid_until, 'lines', pq.lines)
                from public.fn_pda_carried_quote(r.set_id, case when r.leg = 'load' then 'discharge' else 'load' end) c
                join public.pda_agency_quotes pq on pq.id = c.quote_id));
end $$;
revoke all on function public.pda_quote_acceptance_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pda_quote_acceptance_context(uuid, uuid) to service_role;

create or replace function public.pda_accept_agency_quote(
  p_actor uuid, p_owner_org_id uuid, p_quote_id uuid,
  p_load_request jsonb, p_load_result jsonb, p_discharge_request jsonb, p_discharge_result jsonb, p_route jsonb)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare
  q public.pda_agency_quotes;
  r public.pda_quote_requests;
  v_agency text;
  v_req jsonb;
  v_res jsonb;
  v_other jsonb;
  v_other_req jsonb;
  v_carried uuid;
  v_carried_port text;
  v_saved jsonb;
  v_member uuid;
begin
  select * into q from public.pda_agency_quotes x where x.id = p_quote_id;
  select * into r from public.pda_quote_requests x where x.id = q.request_id for update;
  if q.id is null or r.requester_user_id is distinct from p_actor then
    raise exception 'PDA_AUTH: only the member who requested this quote can accept it' using errcode = '42501';
  end if;
  if r.status <> 'open' then raise exception 'PDA_STATE: this quote request was withdrawn' using errcode = '55000'; end if;
  if r.expires_at < now() then raise exception 'PDA_STATE: this quote request has expired; request quotes again' using errcode = '55000'; end if;
  if q.valid_until < current_date then raise exception 'PDA_STATE: this quote is no longer valid; ask the agency for a new one' using errcode = '55000'; end if;
  if exists (select 1 from public.pda_agency_quotes x where x.request_id = q.request_id and x.agency_org_id = q.agency_org_id and x.revision > q.revision) then
    raise exception 'PDA_STATE: the agency has sent a newer revision; accept that one' using errcode = '55000';
  end if;
  if exists (select 1 from public.pda_quote_acceptances a where a.request_id = r.id) then
    raise exception 'PDA_CONFLICT: a quote from this request has already been accepted' using errcode = '40001';
  end if;
  select a.display_name into v_agency from public.pda_agencies a where a.org_id = q.agency_org_id;

  if not exists (select 1 from public.pda_agencies a where a.org_id = q.agency_org_id and a.status = 'active') then
    raise exception 'PDA_STATE: this agency is suspended; its quotes cannot be accepted now' using errcode = '55000';
  end if;
  -- the new version is the SAME route: only the quoted port is re-priced (pre-audit P2-10)
  if (p_route->'routeInput') is distinct from (select s.route_input from public.pda_estimate_sets s where s.id = r.set_id) then
    raise exception 'PDA_VALIDATION: the new version must keep the saved route input' using errcode = '22023';
  end if;

  v_req := case when r.leg = 'load' then p_load_request else p_discharge_request end;
  v_res := case when r.leg = 'load' then p_load_result else p_discharge_result end;
  v_other_req := case when r.leg = 'load' then p_discharge_request else p_load_request end;
  v_other := case when r.leg = 'load' then p_discharge_result else p_load_result end;
  if not public.fn_pda_leg_matches_quote(v_req, v_res, q.id, r.port_locode) then
    raise exception 'PDA_VALIDATION: the accepted port must be priced exactly as the agency quoted' using errcode = '22023';
  end if;
  -- the other port carries agency_quote lines only as its still-effective accepted quote along the set's lineage,
  -- and then exactly that quote (pre-audit P1-2, C2O-159 P1-4: no acceptance is silently dropped)
  select c.quote_id, c.port_locode into v_carried, v_carried_port
    from public.fn_pda_carried_quote(r.set_id, case when r.leg = 'load' then 'discharge' else 'load' end) c;
  if exists (select 1 from jsonb_array_elements(coalesce(v_other->'lines', '[]'::jsonb)) l where l->>'basis' = 'agency_quote') then
    if v_carried is null or not public.fn_pda_leg_matches_quote(v_other_req, v_other, v_carried, v_carried_port) then
      raise exception 'PDA_VALIDATION: only the accepted port carries the agency quote' using errcode = '22023';
    end if;
  elsif v_carried is not null then
    raise exception 'PDA_VALIDATION: the other port was priced from an accepted quote and must keep it' using errcode = '22023';
  end if;

  -- the new version supersedes the set the request was made from (owner, same vessel + cargo, not yet superseded)
  -- C2O-159 P1-5: the organisation is the request set's, never the caller's (pda_save_estimate_set keeps it as well)
  v_saved := public.pda_save_estimate_set(p_actor, (select s.owner_org_id from public.pda_estimate_sets s where s.id = r.set_id),
                                          p_load_request, p_load_result,
                                          p_discharge_request, p_discharge_result, p_route, r.set_id);
  if coalesce((v_saved->>'replayed')::boolean, false) then
    raise exception 'PDA_CONFLICT: this estimate already holds that content; open the latest version' using errcode = '40001';
  end if;
  insert into public.pda_quote_acceptances (quote_id, request_id, agency_org_id, set_id, accepted_by)
  values (q.id, r.id, q.agency_org_id, (v_saved->>'id')::uuid, p_actor);

  for v_member in
    select m.user_id from public.organization_members m join public.users u on u.id = m.user_id and u.is_active
     where m.org_id = q.agency_org_id and m.is_current and m.status = 'active'
  loop
    perform public.fn_notification_enqueue(v_member, 'pda.quote_accepted', 'pda-qa:' || q.id || ':' || v_member,
      'Quote accepted', 'Your quote for ' || r.port_locode || ' (revision ' || q.revision || ') was accepted.',
      '/dashboard/agency', 'normal', jsonb_build_object('requestId', r.id, 'port', r.port_locode));
  end loop;

  return v_saved || jsonb_build_object('acceptedRevision', q.revision);
end $$;
revoke all on function public.pda_accept_agency_quote(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.pda_accept_agency_quote(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
