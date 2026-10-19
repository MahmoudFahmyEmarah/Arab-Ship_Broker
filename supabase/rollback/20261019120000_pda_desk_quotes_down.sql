-- DOWN for 20261019120000: removes desk-recorded agency quotes support and restores fn_pda_recipient_quotes to its
-- 20261019110000 body. Plain SQL. A desk-recorded quote is a business record (and may already be accepted); dropping
-- its marker and source would make it look like a portal quote, so the DOWN refuses while any exists unless the
-- caller confirms in the same transaction:  set local asb.pda_desk_quotes_down = 'history-exported:<reference>';
-- Roll the application back to a build without the desk form first.
set local lock_timeout = '5s';

do $$
declare v_rows bigint := 0;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pda_agency_quotes' and column_name = 'entered_via') then
    execute 'select count(*) from public.pda_agency_quotes where entered_via = ''desk''' into v_rows;
  end if;
  if v_rows > 0 and coalesce(current_setting('asb.pda_desk_quotes_down', true), '') !~ '^history-exported:.{3,200}$' then
    raise exception 'PDA_DOWN_REFUSED: % desk-recorded quote(s) would lose their source; export them, then set local asb.pda_desk_quotes_down = ''history-exported:<ref>'' in this transaction', v_rows
      using errcode = '55000';
  end if;
end $$;

drop function if exists public.pda_admin_record_agency_quote(uuid, uuid, uuid, text, jsonb, date, text, text, text);
drop function if exists public.pda_admin_list_quote_requests(uuid);
drop function if exists public.fn_pda_agency_has_staff(uuid);

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

alter table public.pda_agency_quotes drop constraint if exists pda_agency_quotes_entered_via_ck;
alter table public.pda_agency_quotes drop column if exists desk_source;
alter table public.pda_agency_quotes drop column if exists entered_via;
