-- ════════════════════════════════════════════════════════════════════════
-- PDA · quote requests answered by the agencies themselves (owner decisions O2ALL-009 A1 c / A5; Agents phase 2)
--
-- A member asks the ASB-invited agencies listed at ONE port of a SAVED (latest) estimate set for a real quote. The
-- request snapshot is built HERE from the saved leg — masked by default (A5): vessel type and size, cargo quantity and
-- status, call date, days, location and the services wanted; never the vessel name, IMO, listing ids or the member.
-- The member may choose to reveal their company name. Staff of a listed agency (its organisation's active members)
-- answer in their agency inbox with a quote or a decline. Accepting a quote into a new estimate version is phase 3.
--
--   pda_quote_requests            — one request (set, leg, port, masked snapshot, services, note, reveal, expiry);
--                                   only open → withdrawn may change, by its requester
--   pda_quote_request_recipients  — one row per addressed agency (sent | quoted | declined)
--   pda_agency_quotes             — append-only quotes; a revision is a new row (revision n+1), never an edit
--   All: RLS on, no API grant. Notifications through the shared core (fn_notification_enqueue): the agency's active
--   members on a new request; the requester on a quote or a decline.
--
--   create_pda_quote_request(set, leg, agencies, services, note, reveal)  member (estimator gate) who can read the set
--   withdraw_pda_quote_request(request)                                    its requester
--   list_my_pda_quote_requests(set default null)                           requester + active colleagues of its org
--   list_agency_pda_quote_requests()                                       staff of an active listed agency
--   submit_pda_agency_quote(request, currency, lines, valid until, ref, note)  agency staff, open + addressed + unexpired
--   decline_pda_quote_request(request, reason)                             agency staff
-- Plain SQL. DOWN: supabase/rollback/20261019100000_pda_quote_requests_down.sql (refuses while requests exist).
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

create table if not exists public.pda_quote_requests (
  id                 uuid primary key default gen_random_uuid(),
  set_id             uuid not null references public.pda_estimate_sets(id),
  leg                text not null check (leg in ('load', 'discharge')),
  port_locode        text not null references public.ports(locode),
  requester_user_id  uuid not null references public.users(id),
  requester_org_id   uuid,
  reveal_identity    boolean not null default false,
  snapshot           jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  services           text[] not null check (cardinality(services) between 1 and 9
                       and services <@ array['port_dues','pilotage','towage','mooring','cargo_handling','agency','waste','security','launch']::text[]),
  note               text check (note is null or char_length(note) <= 1000),
  status             text not null default 'open' check (status in ('open', 'withdrawn')),
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null default now() + interval '14 days',
  withdrawn_at       timestamptz
);
create index if not exists pda_quote_requests_requester_idx on public.pda_quote_requests (requester_user_id, created_at desc);
create index if not exists pda_quote_requests_set_idx on public.pda_quote_requests (set_id);

create table if not exists public.pda_quote_request_recipients (
  request_id     uuid not null references public.pda_quote_requests(id),
  agency_org_id  uuid not null references public.pda_agencies(org_id),
  status         text not null default 'sent' check (status in ('sent', 'quoted', 'declined')),
  decline_reason text check (decline_reason is null or char_length(decline_reason) between 3 and 500),
  responded_at   timestamptz,
  primary key (request_id, agency_org_id)
);
create index if not exists pda_quote_request_recipients_agency_idx on public.pda_quote_request_recipients (agency_org_id, request_id);

create table if not exists public.pda_agency_quotes (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null,
  agency_org_id  uuid not null,
  revision       integer not null check (revision >= 1),
  submitted_by   uuid not null references public.users(id),
  currency       text not null check (currency ~ '^[A-Z]{3}$'),
  lines          jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 50),
  total          numeric(18,2) not null check (total >= 0),
  valid_until    date not null,
  reference      text check (reference is null or char_length(reference) <= 120),
  note           text check (note is null or char_length(note) <= 1000),
  created_at     timestamptz not null default now(),
  foreign key (request_id, agency_org_id) references public.pda_quote_request_recipients(request_id, agency_org_id),
  unique (request_id, agency_org_id, revision)
);

alter table public.pda_quote_requests enable row level security;
alter table public.pda_quote_request_recipients enable row level security;
alter table public.pda_agency_quotes enable row level security;
revoke all on table public.pda_quote_requests, public.pda_quote_request_recipients, public.pda_agency_quotes
  from public, anon, authenticated, service_role;

-- a request changes only open → withdrawn; a quote never changes; a recipient row only records its answer
create or replace function public.fn_pda_quote_guard()
returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_table_name = 'pda_agency_quotes' or tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'PDA_IMMUTABLE: quote records are never edited or deleted' using errcode = '55000';
  end if;
  if tg_table_name = 'pda_quote_requests' then
    if old.status <> 'open' or new.status <> 'withdrawn' or new.withdrawn_at is null
       or (to_jsonb(new) - 'status' - 'withdrawn_at') <> (to_jsonb(old) - 'status' - 'withdrawn_at') then
      raise exception 'PDA_IMMUTABLE: a quote request only moves from open to withdrawn' using errcode = '55000';
    end if;
  elsif tg_table_name = 'pda_quote_request_recipients' then
    if (to_jsonb(new) - 'status' - 'decline_reason' - 'responded_at') <> (to_jsonb(old) - 'status' - 'decline_reason' - 'responded_at') then
      raise exception 'PDA_IMMUTABLE: a recipient row only records its answer' using errcode = '55000';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.fn_pda_quote_guard() from public, anon, authenticated;
drop trigger if exists pda_quote_requests_guard on public.pda_quote_requests;
create trigger pda_quote_requests_guard before update or delete on public.pda_quote_requests for each row execute function public.fn_pda_quote_guard();
drop trigger if exists pda_quote_requests_no_truncate on public.pda_quote_requests;
create trigger pda_quote_requests_no_truncate before truncate on public.pda_quote_requests for each statement execute function public.fn_pda_quote_guard();
drop trigger if exists pda_quote_request_recipients_guard on public.pda_quote_request_recipients;
create trigger pda_quote_request_recipients_guard before update or delete on public.pda_quote_request_recipients for each row execute function public.fn_pda_quote_guard();
drop trigger if exists pda_agency_quotes_guard on public.pda_agency_quotes;
create trigger pda_agency_quotes_guard before update or delete on public.pda_agency_quotes for each row execute function public.fn_pda_quote_guard();
drop trigger if exists pda_agency_quotes_no_truncate on public.pda_agency_quotes;
create trigger pda_agency_quotes_no_truncate before truncate on public.pda_agency_quotes for each statement execute function public.fn_pda_quote_guard();

-- is the caller an active member of this ACTIVE listed agency?
create or replace function public.fn_pda_is_agency_staff(p_agency_org_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.pda_agencies a
    join public.organization_members m on m.org_id = a.org_id and m.is_current and m.status = 'active'
    join public.users u on u.id = m.user_id and u.is_active
    where a.org_id = p_agency_org_id and a.status = 'active' and m.user_id = public.fn_app_user_id()
  );
$$;
revoke all on function public.fn_pda_is_agency_staff(uuid) from public, anon, authenticated;

-- may the caller read this request (its requester, or an active colleague in the requester's organisation)?
create or replace function public.fn_pda_can_read_quote_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.pda_quote_requests r
    where r.id = p_request_id and (
      r.requester_user_id = public.fn_app_user_id()
      or (r.requester_org_id is not null and exists (
            select 1 from public.organization_members m
             where m.org_id = r.requester_org_id and m.user_id = public.fn_app_user_id() and m.is_current and m.status = 'active')))
  );
$$;
revoke all on function public.fn_pda_can_read_quote_request(uuid) from public, anon, authenticated;

create or replace function public.create_pda_quote_request(
  p_set_id uuid, p_leg text, p_agency_ids uuid[], p_services text[], p_note text default null, p_reveal_identity boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path to ''
as $$
declare
  v_user uuid := public.fn_app_user_id();
  s public.pda_estimate_sets;
  e public.pda_estimates;
  v_agencies uuid[];
  v_services text[];
  v_id uuid;
  v_snapshot jsonb;
  v_org uuid;
  v_agency uuid;
  v_member uuid;
begin
  if v_user is null then raise exception 'PDA_AUTH: sign in required' using errcode = '42501'; end if;
  if not public.fn_pda_member_entitled() then
    raise exception 'PDA_TIER: PDA Estimator requires Subscriber tier (T3+)' using errcode = '42501';
  end if;
  if p_leg not in ('load', 'discharge') then raise exception 'PDA_VALIDATION: choose the load or the discharge port' using errcode = '22023'; end if;
  select * into s from public.pda_estimate_sets x where x.id = p_set_id;
  if s.id is null or not public.fn_can_read_pda_estimate(s.load_estimate_id) then
    raise exception 'PDA_AUTH: estimate set is not accessible' using errcode = '42501';
  end if;
  if exists (select 1 from public.pda_estimate_sets n where n.supersedes_id = s.id) then
    raise exception 'PDA_CONFLICT: request quotes from the latest version of this estimate' using errcode = '40001';
  end if;
  select * into e from public.pda_estimates x where x.id = case when p_leg = 'load' then s.load_estimate_id else s.discharge_estimate_id end;

  select coalesce(array_agg(distinct x order by x), '{}') into v_services from unnest(coalesce(p_services, '{}')) x;
  if cardinality(v_services) = 0 or not v_services <@ array['port_dues','pilotage','towage','mooring','cargo_handling','agency','waste','security','launch']::text[] then
    raise exception 'PDA_VALIDATION: choose one or more of the nine port services' using errcode = '22023';
  end if;
  if p_note is not null and char_length(p_note) > 1000 then raise exception 'PDA_VALIDATION: the note is limited to 1000 characters' using errcode = '22023'; end if;

  -- only active agencies listed (active) at THIS port can be addressed
  select coalesce(array_agg(distinct a.org_id order by a.org_id), '{}') into v_agencies
  from public.pda_agencies a join public.pda_port_agents pa on pa.org_id = a.org_id
  where a.status = 'active' and pa.status = 'active' and pa.port_locode = e.port_locode and a.org_id = any (coalesce(p_agency_ids, '{}'));
  if cardinality(v_agencies) = 0 or cardinality(v_agencies) <> (select count(distinct x) from unnest(coalesce(p_agency_ids, '{}')) x) then
    raise exception 'PDA_VALIDATION: every agency must be listed at % (choose from the Agents tab)', e.port_locode using errcode = '22023';
  end if;
  if cardinality(v_agencies) > 10 then raise exception 'PDA_VALIDATION: at most 10 agencies per request' using errcode = '22023'; end if;

  select m.org_id into v_org from public.organization_members m
   where m.user_id = v_user and m.is_current and m.status = 'active' order by m.org_id limit 1;

  -- the MASKED snapshot (A5): what an agency needs to price the call, never who or which vessel
  v_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'port', jsonb_build_object('locode', e.port_locode, 'name', (select p.trade_name from public.ports p where p.locode = e.port_locode),
                               'terminal', e.terminal_name),
    'callDate', e.call_date,
    'vessel', jsonb_build_object(
      'type', e.input_snapshot#>>'{vessel,vesselType}', 'gt', e.input_snapshot#>'{vessel,gt}', 'scnrt', e.input_snapshot#>'{vessel,scnrt}',
      'dwt', e.input_snapshot#>'{vessel,dwt}', 'loaM', e.input_snapshot#>'{vessel,loaM}',
      'registeredMaxDraftM', e.input_snapshot#>'{vessel,registeredMaxDraftM}', 'flagState', e.input_snapshot#>>'{vessel,flagState}'),
    'call', jsonb_build_object(
      'days', e.input_snapshot#>'{call,days}', 'cargoQuantityMt', e.input_snapshot#>'{call,cargoQuantityMt}',
      'cargoStatus', e.input_snapshot#>>'{call,cargoStatus}', 'voyageScope', e.input_snapshot#>>'{call,voyageScope}',
      'location', e.input_snapshot#>>'{call,location}'),
    'requester', case when coalesce(p_reveal_identity, false)
                      then (select jsonb_build_object('company', o.name) from public.organizations o where o.id = v_org)
                      end
  ));

  insert into public.pda_quote_requests (set_id, leg, port_locode, requester_user_id, requester_org_id, reveal_identity, snapshot, services, note)
  values (s.id, p_leg, e.port_locode, v_user, v_org, coalesce(p_reveal_identity, false), v_snapshot, v_services, nullif(btrim(p_note), ''))
  returning id into v_id;

  foreach v_agency in array v_agencies loop
    insert into public.pda_quote_request_recipients (request_id, agency_org_id) values (v_id, v_agency);
    for v_member in
      select m.user_id from public.organization_members m join public.users u on u.id = m.user_id and u.is_active
       where m.org_id = v_agency and m.is_current and m.status = 'active'
    loop
      perform public.fn_notification_enqueue(v_member, 'pda.quote_request', 'pda-qr:' || v_id || ':' || v_member,
        'New PDA quote request', 'A quote is requested for a call at ' || e.port_locode || ' on ' || e.call_date || '.',
        '/dashboard/agency', 'normal', jsonb_build_object('requestId', v_id, 'port', e.port_locode));
    end loop;
  end loop;

  return jsonb_build_object('requestId', v_id, 'port', e.port_locode, 'agencies', cardinality(v_agencies));
end;
$$;
revoke all on function public.create_pda_quote_request(uuid, text, uuid[], text[], text, boolean) from public, anon;
grant execute on function public.create_pda_quote_request(uuid, text, uuid[], text[], text, boolean) to authenticated, service_role;

create or replace function public.withdraw_pda_quote_request(p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare r public.pda_quote_requests;
begin
  select * into r from public.pda_quote_requests x where x.id = p_request_id for update;
  if r.id is null or r.requester_user_id is distinct from public.fn_app_user_id() then
    raise exception 'PDA_AUTH: only the requester can withdraw this request' using errcode = '42501';
  end if;
  if r.status <> 'open' then return jsonb_build_object('requestId', r.id, 'status', r.status); end if;
  update public.pda_quote_requests set status = 'withdrawn', withdrawn_at = now() where id = r.id;
  return jsonb_build_object('requestId', r.id, 'status', 'withdrawn');
end $$;
revoke all on function public.withdraw_pda_quote_request(uuid) from public, anon;
grant execute on function public.withdraw_pda_quote_request(uuid) to authenticated, service_role;

-- the quotes of one recipient row, latest revision first (shared by both sides)
create or replace function public.fn_pda_recipient_quotes(p_request_id uuid, p_agency uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'quoteId', q.id, 'revision', q.revision, 'currency', q.currency, 'lines', q.lines, 'total', q.total,
    'validUntil', q.valid_until, 'reference', q.reference, 'note', q.note, 'createdAt', q.created_at
  ) order by q.revision desc), '[]'::jsonb)
  from public.pda_agency_quotes q where q.request_id = p_request_id and q.agency_org_id = p_agency;
$$;
revoke all on function public.fn_pda_recipient_quotes(uuid, uuid) from public, anon, authenticated;

create or replace function public.list_my_pda_quote_requests(p_set_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_result jsonb;
begin
  if public.fn_app_user_id() is null then raise exception 'PDA_AUTH: sign in required' using errcode = '42501'; end if;
  if not public.fn_pda_member_entitled() then
    raise exception 'PDA_TIER: PDA Estimator requires Subscriber tier (T3+)' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'requestId', r.id, 'setId', r.set_id, 'leg', r.leg, 'port', r.port_locode, 'services', to_jsonb(r.services),
    'note', r.note, 'revealIdentity', r.reveal_identity, 'status', r.status, 'createdAt', r.created_at, 'expiresAt', r.expires_at,
    'mine', r.requester_user_id = public.fn_app_user_id(),
    'agencies', (select coalesce(jsonb_agg(jsonb_build_object(
                   'agencyId', rc.agency_org_id, 'displayName', a.display_name, 'status', rc.status,
                   'declineReason', rc.decline_reason, 'respondedAt', rc.responded_at,
                   'quotes', public.fn_pda_recipient_quotes(r.id, rc.agency_org_id)) order by a.display_name), '[]'::jsonb)
                 from public.pda_quote_request_recipients rc join public.pda_agencies a on a.org_id = rc.agency_org_id
                 where rc.request_id = r.id)
  ) order by r.created_at desc), '[]'::jsonb) into v_result
  from public.pda_quote_requests r
  where public.fn_pda_can_read_quote_request(r.id) and (p_set_id is null or r.set_id = p_set_id);
  return v_result;
end $$;
revoke all on function public.list_my_pda_quote_requests(uuid) from public, anon;
grant execute on function public.list_my_pda_quote_requests(uuid) to authenticated, service_role;

create or replace function public.list_agency_pda_quote_requests()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_result jsonb;
begin
  if public.fn_app_user_id() is null then raise exception 'PDA_AUTH: sign in required' using errcode = '42501'; end if;
  -- the agency inbox: requests addressed to an active listed agency the caller staffs; the snapshot is already masked
  select coalesce(jsonb_agg(jsonb_build_object(
    'requestId', r.id, 'agencyId', rc.agency_org_id, 'agencyName', a.display_name,
    'port', r.port_locode, 'snapshot', r.snapshot, 'services', to_jsonb(r.services), 'note', r.note,
    'requestStatus', case when r.status = 'withdrawn' then 'withdrawn' when r.expires_at < now() then 'expired' else 'open' end,
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

create or replace function public.submit_pda_agency_quote(
  p_request_id uuid, p_agency_org_id uuid, p_currency text, p_lines jsonb, p_valid_until date, p_reference text default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare
  v_user uuid := public.fn_app_user_id();
  r public.pda_quote_requests;
  rc public.pda_quote_request_recipients;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_rev integer;
  v_id uuid;
  v_agency text;
begin
  if v_user is null or not public.fn_pda_is_agency_staff(p_agency_org_id) then
    raise exception 'PDA_AUTH: only staff of the addressed agency can quote' using errcode = '42501';
  end if;
  select * into r from public.pda_quote_requests x where x.id = p_request_id for update;
  select * into rc from public.pda_quote_request_recipients x where x.request_id = p_request_id and x.agency_org_id = p_agency_org_id for update;
  if r.id is null or rc.request_id is null then raise exception 'PDA_AUTH: this request is not addressed to your agency' using errcode = '42501'; end if;
  if r.status <> 'open' or r.expires_at < now() then
    raise exception 'PDA_STATE: the request is no longer open' using errcode = '55000';
  end if;
  if rc.status = 'declined' then raise exception 'PDA_STATE: your agency declined this request' using errcode = '55000'; end if;
  if p_currency is null or upper(p_currency) !~ '^[A-Z]{3}$' then raise exception 'PDA_VALIDATION: a 3-letter currency is required' using errcode = '22023'; end if;
  if p_valid_until is null or p_valid_until < current_date then raise exception 'PDA_VALIDATION: the quote must be valid today or later' using errcode = '22023'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'PDA_VALIDATION: a quote has 1 to 50 lines' using errcode = '22023';
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if char_length(btrim(coalesce(v_line->>'label', ''))) not between 1 and 200
       or coalesce(v_line->>'amount', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
       or (nullif(v_line->>'serviceCode', '') is not null and v_line->>'serviceCode' <> all (r.services)) then
      raise exception 'PDA_VALIDATION: each line needs a label, an amount (up to 2 decimals) and, if given, a requested service' using errcode = '22023';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'label', btrim(v_line->>'label'), 'serviceCode', nullif(v_line->>'serviceCode', ''), 'amount', (v_line->>'amount')::numeric)));
    v_total := v_total + (v_line->>'amount')::numeric;
  end loop;
  if p_reference is not null and char_length(p_reference) > 120 then raise exception 'PDA_VALIDATION: the reference is limited to 120 characters' using errcode = '22023'; end if;
  if p_note is not null and char_length(p_note) > 1000 then raise exception 'PDA_VALIDATION: the note is limited to 1000 characters' using errcode = '22023'; end if;

  select coalesce(max(q.revision), 0) + 1 into v_rev from public.pda_agency_quotes q where q.request_id = r.id and q.agency_org_id = p_agency_org_id;
  insert into public.pda_agency_quotes (request_id, agency_org_id, revision, submitted_by, currency, lines, total, valid_until, reference, note)
  values (r.id, p_agency_org_id, v_rev, v_user, upper(p_currency), v_lines, v_total, p_valid_until, nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''))
  returning id into v_id;
  update public.pda_quote_request_recipients set status = 'quoted', responded_at = now(), decline_reason = null
   where request_id = r.id and agency_org_id = p_agency_org_id;

  select a.display_name into v_agency from public.pda_agencies a where a.org_id = p_agency_org_id;
  perform public.fn_notification_enqueue(r.requester_user_id, 'pda.quote_received', 'pda-q:' || v_id,
    'Quote received', v_agency || ' quoted ' || upper(p_currency) || ' ' || to_char(v_total, 'FM999G999G999G990D00') || ' for ' || r.port_locode || '.',
    '/dashboard/ports-da', 'normal', jsonb_build_object('requestId', r.id, 'port', r.port_locode));
  return jsonb_build_object('quoteId', v_id, 'revision', v_rev, 'total', v_total);
end $$;
revoke all on function public.submit_pda_agency_quote(uuid, uuid, text, jsonb, date, text, text) from public, anon;
grant execute on function public.submit_pda_agency_quote(uuid, uuid, text, jsonb, date, text, text) to authenticated, service_role;

create or replace function public.decline_pda_quote_request(p_request_id uuid, p_agency_org_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare r public.pda_quote_requests; rc public.pda_quote_request_recipients; v_agency text;
begin
  if public.fn_app_user_id() is null or not public.fn_pda_is_agency_staff(p_agency_org_id) then
    raise exception 'PDA_AUTH: only staff of the addressed agency can decline' using errcode = '42501';
  end if;
  select * into r from public.pda_quote_requests x where x.id = p_request_id;
  select * into rc from public.pda_quote_request_recipients x where x.request_id = p_request_id and x.agency_org_id = p_agency_org_id for update;
  if r.id is null or rc.request_id is null then raise exception 'PDA_AUTH: this request is not addressed to your agency' using errcode = '42501'; end if;
  if r.status <> 'open' then raise exception 'PDA_STATE: the request is no longer open' using errcode = '55000'; end if;
  if rc.status <> 'sent' then raise exception 'PDA_STATE: your agency has already answered' using errcode = '55000'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'PDA_VALIDATION: give a short reason (3 to 500 characters)' using errcode = '22023';
  end if;
  update public.pda_quote_request_recipients set status = 'declined', decline_reason = btrim(p_reason), responded_at = now()
   where request_id = r.id and agency_org_id = p_agency_org_id;
  select a.display_name into v_agency from public.pda_agencies a where a.org_id = p_agency_org_id;
  perform public.fn_notification_enqueue(r.requester_user_id, 'pda.quote_declined', 'pda-qd:' || r.id || ':' || p_agency_org_id,
    'Quote request declined', v_agency || ' declined the quote request for ' || r.port_locode || '.',
    '/dashboard/ports-da', 'info', jsonb_build_object('requestId', r.id, 'port', r.port_locode));
  return jsonb_build_object('requestId', r.id, 'status', 'declined');
end $$;
revoke all on function public.decline_pda_quote_request(uuid, uuid, text) from public, anon;
grant execute on function public.decline_pda_quote_request(uuid, uuid, text) to authenticated, service_role;
