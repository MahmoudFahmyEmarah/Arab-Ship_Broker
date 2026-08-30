-- Market freshness — the live market shows RECENT postings only.
--
-- The freshness clock is the POSTING date (refreshed_at), never the laycan:
-- a SPOT cargo posted yesterday is fresh; a dated cargo posted six weeks ago
-- is stale. Tiers differ in how far back the archive filter may reach; the
-- caps live in app_settings('market_visibility') so admins tune them in
-- Admin → Settings without a deploy:
--   { "freshDays": 7, "laycanException": true,
--     "archiveDaysByTier": { "T1": 0, "T2": 0, "T3": 30, "T4": 60 } }
-- laycanException keeps a listing visible past the posted-date window while
-- its laycan (cargo) / open date (vessel) is still in the future.
-- Owners always see their own listings; admins see everything.

alter table public.cargo_listings
  add column if not exists refreshed_at timestamptz not null default now();
alter table public.vessel_availability
  add column if not exists refreshed_at timestamptz not null default now();

-- Existing rows: the freshness clock starts at their original posting.
update public.cargo_listings      set refreshed_at = created_at where refreshed_at > created_at;
update public.vessel_availability set refreshed_at = created_at where refreshed_at > created_at;

create index if not exists idx_cl_refreshed on public.cargo_listings (refreshed_at desc);
create index if not exists idx_va_refreshed on public.vessel_availability (refreshed_at desc);

-- Default configuration (idempotent — an existing row wins).
insert into public.app_settings (key, value, updated_at)
values (
  'market_visibility',
  '{"freshDays": 7, "laycanException": true, "archiveDaysByTier": {"T1": 0, "T2": 0, "T3": 30, "T4": 60}}'::jsonb,
  now()
)
on conflict (key) do nothing;

-- Row-level freshness gate. SECURITY DEFINER so its config/ownership lookups
-- work regardless of the caller's own row access.
create or replace function public.fn_market_fresh_ok(
  p_listing_id uuid,
  p_type public.listing_type_enum,
  p_refreshed timestamptz,
  p_future date
) returns boolean
language plpgsql stable security definer set search_path to ''
as $$
declare cfg jsonb; v_tier text; cap int; fresh int; lex boolean;
begin
  if public.fn_is_admin() then return true; end if;

  -- owners always see their own listings, any age
  if auth.uid() is not null and exists (
    select 1 from public.listing_ownership lo
    where lo.listing_id = p_listing_id
      and lo.listing_type = p_type
      and lo.owner_user_id = auth.uid()
  ) then return true; end if;

  select value into cfg from public.app_settings where key = 'market_visibility';
  fresh := coalesce((cfg->>'freshDays')::int, 7);
  lex   := coalesce((cfg->>'laycanException')::boolean, true);
  select u.subscription_tier::text into v_tier from public.users u where u.id = auth.uid();
  cap := greatest(fresh, coalesce((cfg->'archiveDaysByTier'->>coalesce(v_tier, 'T1'))::int, 0));

  if p_refreshed >= now() - make_interval(days => cap) then return true; end if;
  if lex and p_future is not null and p_future >= current_date then return true; end if;
  return false;
end $$;

-- RESTRICTIVE policies AND onto the existing permissive ones — nothing about
-- ownership/approval visibility changes; stale rows simply drop out for the
-- tiers whose horizon they exceed.
drop policy if exists "cl: freshness horizon" on public.cargo_listings;
create policy "cl: freshness horizon" on public.cargo_listings
  as restrictive for select to public
  using (public.fn_market_fresh_ok(id, 'cargo', refreshed_at, laycan_to));

drop policy if exists "va: freshness horizon" on public.vessel_availability;
create policy "va: freshness horizon" on public.vessel_availability
  as restrictive for select to public
  using (public.fn_market_fresh_ok(id, 'vessel_availability', refreshed_at, open_date));

-- Viewer-resolved visibility settings for the UI (one call, one truth).
create or replace function public.get_market_visibility()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare cfg jsonb; v_tier text; fresh int; lex boolean; cap int; is_adm boolean;
begin
  is_adm := public.fn_is_admin();
  select value into cfg from public.app_settings where key = 'market_visibility';
  fresh := coalesce((cfg->>'freshDays')::int, 7);
  lex   := coalesce((cfg->>'laycanException')::boolean, true);
  select u.subscription_tier::text into v_tier from public.users u where u.id = auth.uid();
  cap := case when is_adm then 3650
              else greatest(fresh, coalesce((cfg->'archiveDaysByTier'->>coalesce(v_tier, 'T1'))::int, 0)) end;
  return jsonb_build_object(
    'freshDays', fresh,
    'archiveCapDays', cap,
    'laycanException', lex,
    'tier', coalesce(v_tier, 'T1'),
    'isAdmin', is_adm
  );
end $$;

grant execute on function public.get_market_visibility() to authenticated;
