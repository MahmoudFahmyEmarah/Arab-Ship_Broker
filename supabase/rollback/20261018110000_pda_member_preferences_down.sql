-- DOWN for 20261018110000: removes the PDA member preferences. Plain SQL.
-- Members' saved preferences would be lost, so the DOWN refuses while any row exists unless the caller confirms in the
-- same transaction:  set local asb.pda_prefs_down = 'discard-preferences';
-- Roll the application back to a build without the Setup tab first.
set local lock_timeout = '5s';

do $$
declare v_rows bigint := 0;
begin
  if to_regclass('public.pda_member_preferences') is not null then
    execute 'select count(*) from public.pda_member_preferences' into v_rows;
  end if;
  if v_rows > 0 and coalesce(current_setting('asb.pda_prefs_down', true), '') <> 'discard-preferences' then
    raise exception 'PDA_DOWN_REFUSED: % member preference row(s) would be discarded; set local asb.pda_prefs_down = ''discard-preferences'' in this transaction to confirm', v_rows
      using errcode = '55000';
  end if;
end $$;

drop function if exists public.set_my_pda_preferences(text, text);
drop function if exists public.get_my_pda_preferences();
drop table if exists public.pda_member_preferences;
