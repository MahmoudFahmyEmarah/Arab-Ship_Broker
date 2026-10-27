-- ════════════════════════════════════════════════════════════════════════
-- PDA · the desk records an agency's emailed quote (owner choice 19 Oct 2026; spec A3 fallback; Agents phase 4)
--
-- While few agencies have portal accounts, an agency listed at a port may answer a member's request by email. An
-- owner-tier admin records that quote against the same request, on the agency's behalf: the same validation as a
-- portal quote, append-only, attributed to the agency, marked "recorded by the desk" with the source the admin
-- names (e.g. "Email from ops@agency, 19 Oct 10:42"). Only for an agency with NO active staff account — an agency
-- that has one answers in its own inbox. The member sees the quote like any other, and may accept it (phase 3).
--
--   pda_agency_quotes.entered_via / desk_source  — 'agency' (portal) or 'desk' (recorded by an admin, source required)
--   fn_pda_recipient_quotes                      — adds enteredVia (never the desk source text) for both sides
--   pda_admin_list_quote_requests(actor)         — service only: open requests awaiting agencies without an account
--   pda_admin_record_agency_quote(actor, …)      — service only: records the emailed quote; notifies the requester
-- Plain SQL. DOWN: supabase/rollback/20261019120000_pda_desk_quotes_down.sql (refuses while desk quotes exist).
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

alter table public.pda_agency_quotes add column if not exists entered_via text not null default 'agency';
alter table public.pda_agency_quotes add column if not exists desk_source text;
alter table public.pda_agency_quotes drop constraint if exists pda_agency_quotes_entered_via_ck;
alter table public.pda_agency_quotes add constraint pda_agency_quotes_entered_via_ck check (
  entered_via in ('agency', 'desk')
  and (entered_via = 'desk') = (desk_source is not null)
  and (desk_source is null or char_length(desk_source) between 3 and 300));

-- the quotes of one recipient row, latest revision first; now saying how each was entered (replaces the 20261019110000 body)
create or replace function public.fn_pda_recipient_quotes(p_request_id uuid, p_agency uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'quoteId', q.id, 'revision', q.revision, 'currency', q.currency, 'lines', q.lines, 'total', q.total,
    'validUntil', q.valid_until, 'reference', q.reference, 'note', q.note, 'createdAt', q.created_at,
    'accepted', a.quote_id is not null, 'acceptedAt', a.created_at, 'enteredVia', q.entered_via
  ) order by q.revision desc), '[]'::jsonb)
  from public.pda_agency_quotes q
  left join public.pda_quote_acceptances a on a.quote_id = q.id
  where q.request_id = p_request_id and q.agency_org_id = p_agency;
$$;
revoke all on function public.fn_pda_recipient_quotes(uuid, uuid) from public, anon, authenticated;

-- does this listed agency have an active staff account (then it answers in its own inbox)?
create or replace function public.fn_pda_agency_has_staff(p_agency_org_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.organization_members m join public.users u on u.id = m.user_id and u.is_active
    where m.org_id = p_agency_org_id and m.is_current and m.status = 'active');
$$;
revoke all on function public.fn_pda_agency_has_staff(uuid) from public, anon, authenticated;

create or replace function public.pda_admin_list_quote_requests(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_result jsonb;
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  -- open, unexpired, not yet accepted requests, with each addressed agency that has no account and has not answered
  select coalesce(jsonb_agg(jsonb_build_object(
    'requestId', r.id, 'agencyId', rc.agency_org_id, 'agencyName', a.display_name, 'port', r.port_locode,
    'snapshot', r.snapshot, 'services', to_jsonb(r.services), 'note', r.note, 'createdAt', r.created_at, 'expiresAt', r.expires_at,
    'deskQuotes', (select count(*) from public.pda_agency_quotes q where q.request_id = r.id and q.agency_org_id = rc.agency_org_id)
  ) order by r.created_at), '[]'::jsonb) into v_result
  from public.pda_quote_requests r
  join public.pda_quote_request_recipients rc on rc.request_id = r.id
  join public.pda_agencies a on a.org_id = rc.agency_org_id
  where r.status = 'open' and r.expires_at >= now() and rc.status <> 'declined' and a.status = 'active'
    and not exists (select 1 from public.pda_quote_acceptances qa where qa.request_id = r.id)
    and not public.fn_pda_agency_has_staff(rc.agency_org_id);
  return v_result;
end $$;
revoke all on function public.pda_admin_list_quote_requests(uuid) from public, anon, authenticated;
grant execute on function public.pda_admin_list_quote_requests(uuid) to service_role;

create or replace function public.pda_admin_record_agency_quote(
  p_actor uuid, p_request_id uuid, p_agency_org_id uuid, p_currency text, p_lines jsonb, p_valid_until date,
  p_source text, p_reference text default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare
  r public.pda_quote_requests;
  rc public.pda_quote_request_recipients;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_rev integer;
  v_id uuid;
  v_agency text;
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  select * into r from public.pda_quote_requests x where x.id = p_request_id for update;
  select * into rc from public.pda_quote_request_recipients x where x.request_id = p_request_id and x.agency_org_id = p_agency_org_id for update;
  if r.id is null or rc.request_id is null then raise exception 'PDA_VALIDATION: this request is not addressed to that agency' using errcode = '22023'; end if;
  if not exists (select 1 from public.pda_agencies a where a.org_id = p_agency_org_id and a.status = 'active') then
    raise exception 'PDA_STATE: the agency is suspended' using errcode = '55000';
  end if;
  if public.fn_pda_agency_has_staff(p_agency_org_id) then
    raise exception 'PDA_STATE: this agency has a portal account; it answers in its own inbox' using errcode = '55000';
  end if;
  if r.status <> 'open' or r.expires_at < now() then raise exception 'PDA_STATE: the request is no longer open' using errcode = '55000'; end if;
  if rc.status = 'declined' then raise exception 'PDA_STATE: the agency declined this request' using errcode = '55000'; end if;
  if p_source is null or char_length(btrim(p_source)) not between 3 and 300 then
    raise exception 'PDA_VALIDATION: say where the quote came from (3 to 300 characters, e.g. the email and its date)' using errcode = '22023';
  end if;
  if p_currency is null or upper(p_currency) !~ '^[A-Z]{3}$' then raise exception 'PDA_VALIDATION: a 3-letter currency is required' using errcode = '22023'; end if;
  if p_valid_until is null or p_valid_until < current_date then raise exception 'PDA_VALIDATION: the quote must be valid today or later' using errcode = '22023'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'PDA_VALIDATION: a quote has 1 to 50 lines' using errcode = '22023';
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if char_length(btrim(coalesce(v_line->>'label', ''))) not between 1 and 200
       or coalesce(v_line->>'amount', '') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
       or (nullif(v_line->>'serviceCode', '') is not null and v_line->>'serviceCode' <> all (r.services)) then
      raise exception 'PDA_VALIDATION: each line needs a label, an amount (up to 12 digits and 2 decimals) and, if given, a requested service' using errcode = '22023';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'label', btrim(v_line->>'label'), 'serviceCode', nullif(v_line->>'serviceCode', ''), 'amount', (v_line->>'amount')::numeric)));
    v_total := v_total + (v_line->>'amount')::numeric;
  end loop;
  if p_reference is not null and char_length(p_reference) > 120 then raise exception 'PDA_VALIDATION: the reference is limited to 120 characters' using errcode = '22023'; end if;
  if p_note is not null and char_length(p_note) > 1000 then raise exception 'PDA_VALIDATION: the note is limited to 1000 characters' using errcode = '22023'; end if;

  select coalesce(max(q.revision), 0) + 1 into v_rev from public.pda_agency_quotes q where q.request_id = r.id and q.agency_org_id = p_agency_org_id;
  insert into public.pda_agency_quotes (request_id, agency_org_id, revision, submitted_by, currency, lines, total, valid_until, reference, note,
                                        entered_via, desk_source)
  values (r.id, p_agency_org_id, v_rev, p_actor, upper(p_currency), v_lines, v_total, p_valid_until, nullif(btrim(p_reference), ''),
          nullif(btrim(p_note), ''), 'desk', btrim(p_source))
  returning id into v_id;
  update public.pda_quote_request_recipients set status = 'quoted', responded_at = now(), decline_reason = null
   where request_id = r.id and agency_org_id = p_agency_org_id;

  select a.display_name into v_agency from public.pda_agencies a where a.org_id = p_agency_org_id;
  if exists (select 1 from public.users u where u.id = r.requester_user_id and u.is_active) then
    perform public.fn_notification_enqueue(r.requester_user_id, 'pda.quote_received', 'pda-q:' || v_id,
      'Quote received', v_agency || ' quoted ' || upper(p_currency) || ' ' || to_char(v_total, 'FM999G999G999G990D00') || ' for ' || r.port_locode || ' (recorded by Arab ShipBroker).',
      '/dashboard/ports-da', 'normal', jsonb_build_object('requestId', r.id, 'port', r.port_locode));
  end if;
  return jsonb_build_object('quoteId', v_id, 'revision', v_rev, 'total', v_total);
end $$;
revoke all on function public.pda_admin_record_agency_quote(uuid, uuid, uuid, text, jsonb, date, text, text, text) from public, anon, authenticated;
grant execute on function public.pda_admin_record_agency_quote(uuid, uuid, uuid, text, jsonb, date, text, text, text) to service_role;
