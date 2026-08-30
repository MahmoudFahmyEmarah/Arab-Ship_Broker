-- get_market_visibility also returns the per-tier archive map, so the Posted
-- filter can label a locked option with the tier that unlocks it ("Tier 3+")
-- instead of a generic upgrade hint. The map is configuration, not a secret.
create or replace function public.get_market_visibility()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare cfg jsonb; v_tier text; fresh int; lex boolean; cap int; is_adm boolean; ladder jsonb;
begin
  is_adm := public.fn_is_admin();
  select value into cfg from public.app_settings where key = 'market_visibility';
  fresh := coalesce((cfg->>'freshDays')::int, 7);
  lex   := coalesce((cfg->>'laycanException')::boolean, true);
  select u.subscription_tier::text into v_tier from public.users u where u.id = auth.uid();
  cap := case when is_adm then 3650
              else greatest(fresh, coalesce((cfg->'archiveDaysByTier'->>coalesce(v_tier, 'T1'))::int, 0)) end;
  select coalesce(jsonb_agg(d order by d), '[]'::jsonb) into ladder
  from (
    select distinct d from (
      select fresh as d
      union select (cfg->'archiveDaysByTier'->>'T1')::int
      union select (cfg->'archiveDaysByTier'->>'T2')::int
      union select (cfg->'archiveDaysByTier'->>'T3')::int
      union select (cfg->'archiveDaysByTier'->>'T4')::int
    ) x where d is not null and d >= fresh
  ) y;
  return jsonb_build_object(
    'freshDays', fresh,
    'archiveCapDays', cap,
    'laycanException', lex,
    'tier', coalesce(v_tier, 'T1'),
    'isAdmin', is_adm,
    'ladder', ladder,
    'tiers', coalesce(cfg->'archiveDaysByTier', '{"T1":0,"T2":0,"T3":30,"T4":60}'::jsonb)
  );
end $$;

grant execute on function public.get_market_visibility() to authenticated;
