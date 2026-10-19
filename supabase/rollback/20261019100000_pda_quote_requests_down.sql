-- DOWN for 20261019100000: removes PDA quote requests and agency quotes. Plain SQL.
-- Requests and quotes are business records between members and agencies; the DOWN refuses while any request exists
-- unless the caller confirms in the same transaction:  set local asb.pda_quotes_down = 'history-exported:<reference>';
-- Roll the application back to a build without quote requests and the agency inbox first.
set local lock_timeout = '5s';

do $$
declare v_rows bigint := 0;
begin
  if to_regclass('public.pda_quote_requests') is not null then
    execute 'select count(*) from public.pda_quote_requests' into v_rows;
  end if;
  if v_rows > 0 and coalesce(current_setting('asb.pda_quotes_down', true), '') !~ '^history-exported:.{3,200}$' then
    raise exception 'PDA_DOWN_REFUSED: % quote request(s) would be destroyed; export them, then set local asb.pda_quotes_down = ''history-exported:<ref>'' in this transaction', v_rows
      using errcode = '55000';
  end if;
end $$;

drop function if exists public.decline_pda_quote_request(uuid, uuid, text);
drop function if exists public.submit_pda_agency_quote(uuid, uuid, text, jsonb, date, text, text);
drop function if exists public.list_agency_pda_quote_requests();
drop function if exists public.list_my_pda_quote_requests(uuid);
drop function if exists public.fn_pda_recipient_quotes(uuid, uuid);
drop function if exists public.withdraw_pda_quote_request(uuid);
drop function if exists public.create_pda_quote_request(uuid, text, uuid[], text[], text, boolean);
drop function if exists public.fn_pda_can_read_quote_request(uuid);
drop function if exists public.fn_pda_is_agency_staff(uuid);
drop table if exists public.pda_agency_quotes;
drop table if exists public.pda_quote_request_recipients;
drop table if exists public.pda_quote_requests;
drop function if exists public.fn_pda_quote_guard();
