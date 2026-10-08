-- DOWN for 20261009400000_pda_followups: restores the 20260902223515 fn_normalize_flag body byte for byte and the
-- 20261007310000 service_role privileges on pda_fx_rates (SELECT only; INSERT stays revoked as 20261008200000 left it).
create or replace function public.fn_normalize_flag(p text)
returns text
language plpgsql stable
set search_path to ''
as $$
declare k text; v text;
begin
  if p is null then return null; end if;
  k := public.fn_flag_key(p);
  if k is null then return null; end if;
  if k in ('iacs','bv','dnv','abs','lr','rina','ccs','krs','rs','tbc','n a','na','nil','none') then
    return null;
  end if;
  select f.name into v
  from public.flag_states f
  where f.is_active
    and (public.fn_flag_key(f.name) = k
         or exists (select 1 from unnest(f.aliases) a where public.fn_flag_key(a) = k))
  order by f.sort_order nulls last
  limit 1;
  return v;
end $$;

revoke all on table public.pda_fx_rates from service_role;
grant select on table public.pda_fx_rates to service_role;
