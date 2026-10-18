-- DOWN for 20261018120000: removes the PDA estimate sets. Plain SQL.
-- Saved sets are immutable member records; the DOWN refuses while any exists unless the caller confirms in the same
-- transaction:  set local asb.pda_sets_down = 'history-exported:<reference>';
-- (the leg estimates themselves, in pda_estimates, are untouched). Roll the application back to a build without
-- saving/history/export first.
set local lock_timeout = '5s';

do $$
declare v_rows bigint := 0;
begin
  if to_regclass('public.pda_estimate_sets') is not null then
    execute 'select count(*) from public.pda_estimate_sets' into v_rows;
  end if;
  if v_rows > 0 and coalesce(current_setting('asb.pda_sets_down', true), '') !~ '^history-exported:.{3,200}$' then
    raise exception 'PDA_DOWN_REFUSED: % saved estimate set(s) would be destroyed; export them, then set local asb.pda_sets_down = ''history-exported:<ref>'' in this transaction', v_rows
      using errcode = '55000';
  end if;
end $$;

drop function if exists public.get_pda_estimate_set(uuid);
drop function if exists public.list_my_pda_estimate_sets(integer, timestamptz);
drop function if exists public.pda_save_estimate_set(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid);
drop trigger if exists pda_estimate_sets_immutable on public.pda_estimate_sets;
drop table if exists public.pda_estimate_sets;
drop function if exists public.fn_pda_estimate_set_immutable();
