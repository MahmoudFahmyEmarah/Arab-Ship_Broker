-- DOWN for 20261019140000_pda_port_touch_census: drops the read function. It holds no data, so nothing to export.
set local lock_timeout = '5s';
drop function if exists public.get_port_touch_census();
