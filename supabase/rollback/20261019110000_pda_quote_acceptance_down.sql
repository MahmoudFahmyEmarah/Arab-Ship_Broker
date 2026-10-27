-- DOWN for 20261019110000: removes quote acceptance and restores fn_pda_recipient_quotes and
-- list_agency_pda_quote_requests to their 20261019100000 bodies.
-- Plain SQL. The accepted sets themselves stay (they are ordinary estimate sets); only the acceptance records go, so the
-- DOWN refuses while any exists unless the caller confirms in the same transaction:
--   set local asb.pda_acceptances_down = 'history-exported:<reference>';
-- Roll the application back to a build without "Accept quote" first.
set local lock_timeout = '5s';

do $$
declare v_rows bigint := 0;
begin
  if to_regclass('public.pda_quote_acceptances') is not null then
    execute 'select count(*) from public.pda_quote_acceptances' into v_rows;
  end if;
  if v_rows > 0 and coalesce(current_setting('asb.pda_acceptances_down', true), '') !~ '^history-exported:.{3,200}$' then
    raise exception 'PDA_DOWN_REFUSED: % accepted quote(s) would lose their record; export them, then set local asb.pda_acceptances_down = ''history-exported:<ref>'' in this transaction', v_rows
      using errcode = '55000';
  end if;
  -- saved agency-quote lines are immutable history: the narrower basis check cannot come back while any exists
  if exists (select 1 from public.pda_estimate_lines where basis = 'agency_quote') then
    raise exception 'PDA_DOWN_REFUSED: saved estimates hold accepted agency-quote lines; they are immutable, so the basis check cannot be narrowed again'
      using errcode = '55000';
  end if;
end $$;

drop function if exists public.pda_accept_agency_quote(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb);
drop function if exists public.fn_pda_leg_matches_quote(jsonb, jsonb, uuid, text);
drop trigger if exists pda_agency_quotes_closed on public.pda_agency_quotes;
drop trigger if exists pda_quote_request_recipients_closed on public.pda_quote_request_recipients;
drop trigger if exists pda_quote_requests_closed on public.pda_quote_requests;
drop function if exists public.fn_pda_quote_request_closed();

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

drop function if exists public.pda_quote_acceptance_context(uuid, uuid);
drop function if exists public.fn_pda_carried_quote(uuid, text);

create or replace function public.fn_pda_recipient_quotes(p_request_id uuid, p_agency uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'quoteId', q.id, 'revision', q.revision, 'currency', q.currency, 'lines', q.lines, 'total', q.total,
    'validUntil', q.valid_until, 'reference', q.reference, 'note', q.note, 'createdAt', q.created_at
  ) order by q.revision desc), '[]'::jsonb)
  from public.pda_agency_quotes q where q.request_id = p_request_id and q.agency_org_id = p_agency;
$$;
revoke all on function public.fn_pda_recipient_quotes(uuid, uuid) from public, anon, authenticated;

drop table if exists public.pda_quote_acceptances;
alter table public.pda_estimate_lines drop constraint if exists pda_estimate_lines_agency_quote_ck;
alter table public.pda_estimate_lines drop constraint if exists pda_estimate_lines_basis_ck;
alter table public.pda_estimate_lines add constraint pda_estimate_lines_basis_ck check (basis in (
    'flat','per_call','per_day','per_hour','per_gt','per_nt','per_scnrt','per_dwt','per_loa',
    'per_cargo_mt','per_unit','per_gt_day','per_loa_day','per_loa_hour',
    'percentage','tiered_flat','tiered_rate','progressive','manual_quote','manual'
  ));
drop function if exists public.fn_pda_quote_acceptance_immutable();
