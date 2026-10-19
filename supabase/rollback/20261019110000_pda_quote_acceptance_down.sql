-- DOWN for 20261019110000: removes quote acceptance and restores fn_pda_recipient_quotes to its 20261019100000 body.
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
end $$;

drop function if exists public.pda_accept_agency_quote(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb);
drop function if exists public.pda_quote_acceptance_context(uuid, uuid);

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
drop function if exists public.fn_pda_quote_acceptance_immutable();
