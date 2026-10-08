-- PDA follow-ups from Opus's Tier B (O2C-063 P2s), 9 Oct 2026.
--  1. fn_normalize_flag: an exact canonical register name decides on its own. When a register carries that exact name
--     but is inactive, the text has no canonical flag (null) — it never falls through to another register's alias,
--     so Data Sync / DQ can no longer rewrite "Atlantis" (an inactive register) into an active alias owner before the
--     PDA prices the vessel. Aliases are consulted only when no register has that exact name; their behaviour is
--     unchanged (active registers, sort order, first match). Same rule as lib/pda/flag.ts (C2O-094).
--  2. pda_fx_rates: service_role keeps SELECT only (REVOKE ALL, then GRANT SELECT), like tariff_sources
--     (20261008210000); the governed SECURITY DEFINER commands remain the only writers.
-- DOWN: supabase/rollback/20261009400000_pda_followups_down.sql
create or replace function public.fn_normalize_flag(p text)
returns text
language plpgsql stable
set search_path to ''
as $$
declare k text; v text; v_active boolean;
begin
  if p is null then return null; end if;
  k := public.fn_flag_key(p);
  if k is null then return null; end if;
  if k in ('iacs','bv','dnv','abs','lr','rina','ccs','krs','rs','tbc','n a','na','nil','none') then
    return null;
  end if;
  -- an exact canonical name decides alone (active → that register; inactive → no canonical flag)
  select f.name, f.is_active into v, v_active
    from public.flag_states f
   where public.fn_flag_key(f.name) = k
   order by f.is_active desc, f.sort_order nulls last
   limit 1;
  if v is not null then
    return case when v_active then v else null end;
  end if;
  -- otherwise an alias of an active register (unchanged)
  select f.name into v
    from public.flag_states f
   where f.is_active
     and exists (select 1 from unnest(f.aliases) a where public.fn_flag_key(a) = k)
   order by f.sort_order nulls last
   limit 1;
  return v;
end $$;

revoke all on table public.pda_fx_rates from service_role;
grant select on table public.pda_fx_rates to service_role;
