-- DOWN for 20261018130000: removes the port agency registry. Plain SQL.
-- Listings are curated by the owner and logged; the DOWN refuses while any agency exists unless the caller confirms in
-- the same transaction:  set local asb.pda_agencies_down = 'registry-exported:<reference>';
-- Roll the application back to a build without the Agents directory and the Port agents console first.
set local lock_timeout = '5s';

do $$
declare v_rows bigint := 0;
begin
  if to_regclass('public.pda_agencies') is not null then
    execute 'select count(*) from public.pda_agencies' into v_rows;
  end if;
  if v_rows > 0 and coalesce(current_setting('asb.pda_agencies_down', true), '') !~ '^registry-exported:.{3,200}$' then
    raise exception 'PDA_DOWN_REFUSED: % listed agenc(ies) would be removed; export the registry, then set local asb.pda_agencies_down = ''registry-exported:<ref>'' in this transaction', v_rows
      using errcode = '55000';
  end if;
end $$;

drop function if exists public.get_my_pda_agency();
drop function if exists public.list_pda_port_agents(text);
drop function if exists public.pda_admin_list_agencies(uuid);
drop function if exists public.pda_admin_set_port_agent(uuid, uuid, text, text[], boolean);
drop function if exists public.pda_admin_upsert_agency(uuid, uuid, jsonb);
drop trigger if exists pda_agency_events_append_only on public.pda_agency_events;
drop table if exists public.pda_agency_events;
drop table if exists public.pda_port_agents;
drop table if exists public.pda_agencies;
drop function if exists public.fn_pda_agency_events_append_only();
