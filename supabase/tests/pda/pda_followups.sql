-- PDA follow-ups (20261009400000): fn_normalize_flag decides on an exact canonical name alone; aliases unchanged;
-- service_role holds SELECT only on pda_fx_rates and tariff_sources; anon/authenticated hold nothing. Rolled back.
begin;

do $$
declare denied boolean;
begin
  insert into public.flag_states (name, iso2, category, aliases, is_active, sort_order) values
    ('Atlantis Register', 'AT', 'national', '{}', false, 1),
    ('Neptune Register', 'NP', 'national', array['Atlantis Register', 'Neptune Reg'], true, 2),
    ('Oceania Register', 'OC', 'national', array['Shared Alias'], true, 3),
    ('Pacifica Register', 'PC', 'national', array['Shared Alias'], true, 4);

  -- F1 · an exact canonical name decides: active → itself; inactive → null (never another register's alias)
  if public.fn_normalize_flag('Neptune Register') is distinct from 'Neptune Register' then raise exception 'F1: active exact name'; end if;
  if public.fn_normalize_flag('  atlantis register ') is not null then
    raise exception 'F1: an inactive exact name fell through to an alias: %', public.fn_normalize_flag('atlantis register'); end if;
  -- F2 · aliases unchanged when no register has that exact name (active only, sort order, first match)
  if public.fn_normalize_flag('Neptune Reg') is distinct from 'Neptune Register' then raise exception 'F2: alias'; end if;
  if public.fn_normalize_flag('Shared Alias') is distinct from 'Oceania Register' then raise exception 'F2: alias sort order changed'; end if;
  -- F3 · unknown text, class societies and n/a tokens stay null
  if public.fn_normalize_flag('Nowhere Land') is not null or public.fn_normalize_flag('DNV') is not null
     or public.fn_normalize_flag('n/a') is not null or public.fn_normalize_flag(null) is not null then
    raise exception 'F3: unknown/class/n-a text normalised'; end if;

  -- G1 · service_role: SELECT only on the governed PDA tables
  if exists (select 1 from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
             where has_table_privilege('service_role', 'public.pda_fx_rates', p)
                or has_table_privilege('service_role', 'public.tariff_sources', p)) then
    raise exception 'G1: service_role holds a non-SELECT privilege on pda_fx_rates or tariff_sources'; end if;
  if not has_table_privilege('service_role', 'public.pda_fx_rates', 'SELECT') then raise exception 'G1: service_role cannot read FX rates'; end if;
  -- G2 · members and signed-out callers hold nothing on them (they read through the governed RPCs only)
  if exists (select 1 from unnest(array['anon','authenticated']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p,
                         unnest(array['public.pda_fx_rates','public.tariff_sources','public.tariff_source_attestations']) t
             where has_table_privilege(r, t, p)) then
    raise exception 'G2: anon/authenticated hold a privilege on a governed PDA table'; end if;
end $$;

do $m$ begin raise notice 'PDA FOLLOW-UPS: ALL ASSERTIONS PASSED'; end $m$;
rollback;
