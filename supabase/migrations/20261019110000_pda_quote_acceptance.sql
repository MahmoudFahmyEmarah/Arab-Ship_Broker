-- ════════════════════════════════════════════════════════════════════════
-- PDA · accept an agency quote into a new version of the saved estimate (owner decision O2ALL-009 A4; Agents phase 3)
--
-- The requester accepts ONE quote: the server recomputes the route from the saved set's own input, prices the quoted
-- port from the quote's lines (basis 'agency_quote', attributed to the agency) and saves a new set that supersedes
-- the one the request was made from. The database re-checks that the quoted leg IS the quote — same port, currency,
-- lines in order and total, no tariff version — so no other figure can be passed off as an agency quote.
--
--   pda_quote_acceptances           — one row per accepted quote (one per request); append-only
--   pda_quote_acceptance_context(actor, quote)   service only: what the server needs to rebuild the route (incl. the
--                                                saved route input, which never goes to the browser)
--   pda_accept_agency_quote(actor, org, quote, legs…, route)   service only: checks, saves the superseding set through
--                                                pda_save_estimate_set, records the acceptance, notifies the agency
--   fn_pda_recipient_quotes         — now also says which quote was accepted (both sides)
-- Plain SQL. DOWN: supabase/rollback/20261019110000_pda_quote_acceptance_down.sql (refuses while acceptances exist).
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

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
    'lines', q.lines, 'routeInput', s.route_input, 'requestStatus', r.status,
    'setIsLatest', not exists (select 1 from public.pda_estimate_sets n where n.supersedes_id = s.id),
    'latestRevision', not exists (select 1 from public.pda_agency_quotes x
                                   where x.request_id = q.request_id and x.agency_org_id = q.agency_org_id and x.revision > q.revision),
    'accepted', exists (select 1 from public.pda_quote_acceptances a where a.request_id = r.id));
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
  v_saved jsonb;
  v_member uuid;
begin
  select * into q from public.pda_agency_quotes x where x.id = p_quote_id;
  select * into r from public.pda_quote_requests x where x.id = q.request_id for update;
  if q.id is null or r.requester_user_id is distinct from p_actor then
    raise exception 'PDA_AUTH: only the member who requested this quote can accept it' using errcode = '42501';
  end if;
  if r.status <> 'open' then raise exception 'PDA_STATE: this quote request was withdrawn' using errcode = '55000'; end if;
  if q.valid_until < current_date then raise exception 'PDA_STATE: this quote is no longer valid; ask the agency for a new one' using errcode = '55000'; end if;
  if exists (select 1 from public.pda_agency_quotes x where x.request_id = q.request_id and x.agency_org_id = q.agency_org_id and x.revision > q.revision) then
    raise exception 'PDA_STATE: the agency has sent a newer revision; accept that one' using errcode = '55000';
  end if;
  if exists (select 1 from public.pda_quote_acceptances a where a.request_id = r.id) then
    raise exception 'PDA_CONFLICT: a quote from this request has already been accepted' using errcode = '40001';
  end if;
  select a.display_name into v_agency from public.pda_agencies a where a.org_id = q.agency_org_id;

  v_req := case when r.leg = 'load' then p_load_request else p_discharge_request end;
  v_res := case when r.leg = 'load' then p_load_result else p_discharge_result end;
  v_other := case when r.leg = 'load' then p_discharge_result else p_load_result end;
  -- the quoted port must be priced exactly as the agency quoted: same port, currency, lines in order and total
  if upper(coalesce(v_req->>'portLocode', '')) <> r.port_locode
     or coalesce(v_res->>'coverage', '') <> 'manual_required' or nullif(v_res->>'tariffVersionId', '') is not null
     or upper(coalesce(v_res->>'nativeCurrency', '')) <> q.currency
     or jsonb_typeof(v_res->'lines') is distinct from 'array'
     or (v_res#>>'{totals,native}')::numeric is distinct from q.total
     or jsonb_array_length(v_res->'lines') <> jsonb_array_length(q.lines)
     or exists (
          select 1 from jsonb_array_elements(v_res->'lines') with ordinality l(v, n)
          join jsonb_array_elements(q.lines) with ordinality ql(v, n) on ql.n = l.n
          where l.v->>'basis' is distinct from 'agency_quote'
             or (l.v->>'amount')::numeric is distinct from (ql.v->>'amount')::numeric
             or l.v->>'label' is distinct from ql.v->>'label'
             or coalesce(l.v->>'ruleCode', '') <> coalesce(ql.v->>'serviceCode', '')
             or nullif(l.v->>'ruleId', '') is not null
             or l.v->>'enteredBy' is distinct from v_agency) then
    raise exception 'PDA_VALIDATION: the accepted port must be priced exactly as the agency quoted' using errcode = '22023';
  end if;
  -- no other figure may be passed off as an agency quote
  if exists (select 1 from jsonb_array_elements(coalesce(v_other->'lines', '[]'::jsonb)) l where l->>'basis' = 'agency_quote') then
    raise exception 'PDA_VALIDATION: only the accepted port carries the agency quote' using errcode = '22023';
  end if;

  -- the new version supersedes the set the request was made from (owner, same vessel + cargo, not yet superseded)
  v_saved := public.pda_save_estimate_set(p_actor, p_owner_org_id, p_load_request, p_load_result,
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
