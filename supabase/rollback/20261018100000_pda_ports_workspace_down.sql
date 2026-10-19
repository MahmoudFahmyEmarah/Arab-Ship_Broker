-- DOWN for 20261018100000: removes the Ports workspace read. Plain SQL; safe at any time (read only, no data).
-- Roll the application back to a build without the Ports workspace first, or the Ports tab reports that it could
-- not load.
set local lock_timeout = '5s';

drop function if exists public.list_pda_ports_workspace(date);
