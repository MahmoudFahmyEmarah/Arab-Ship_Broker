-- Port routes (09 Aug 2026) — measured ECDIS distances + geometry for the
-- 430 pairs the platform's real cargo history trades (ArabShipBroker MASTER
-- Port Routes workbook + 422 BVS8 voyage-plan exports).
--
--   port_routes           one row per unordered port pair (A|B): measured
--                         total NM (authoritative), computed NM (audit),
--                         trade rank, source, verified flag
--   port_route_waypoints  ordered geometry in the measured direction
--   port_route_alias      retired→canonical locode map (routes were exported
--                         before the July port dedupe; lookups accept both)
--
-- DELIBERATELY NO FK to ports(locode): routes are a standalone reference
-- layer — an endpoint that is missing from the curated ports table (UN/LOCODE
-- backstop ports, future imports) must never fail an import or a lookup.
-- get_port_route returns {"found": false} for unknown pairs; every consumer
-- falls back to its existing estimator. Nothing here can crash a page.
--
-- Rollback: drop function get_port_route; drop tables port_route_waypoints,
-- port_route_alias, port_routes. No other object depends on them.

create table if not exists public.port_routes (
  id             uuid primary key default gen_random_uuid(),
  pol_locode     text not null,           -- as-measured direction
  pod_locode     text not null,
  pair_key       text generated always as
                 (least(pol_locode, pod_locode) || '|' || greatest(pol_locode, pod_locode)) stored,
  total_nm       numeric(7,1) not null check (total_nm > 0),
  computed_nm    numeric(7,1),            -- recomputed from waypoints (audit)
  waypoint_count int not null default 0,
  times_traded   int,                     -- rank signal from real cargo history
  source         text not null default 'ECDIS voyage plan',
  method         text,
  verified       boolean not null default false,
  imported_at    timestamptz not null default now()
);
create unique index if not exists idx_port_routes_pair on public.port_routes (pair_key);
create index if not exists idx_port_routes_pol on public.port_routes (pol_locode);
create index if not exists idx_port_routes_pod on public.port_routes (pod_locode);

create table if not exists public.port_route_waypoints (
  route_id      uuid not null references public.port_routes(id) on delete cascade,
  seq           int not null,
  latitude      numeric(9,6) not null,
  longitude     numeric(9,6) not null,
  cumulative_nm numeric(7,1),
  primary key (route_id, seq)
);

create table if not exists public.port_route_alias (
  alias     text primary key,
  canonical text not null
);

-- Retired→canonical map, from the two dedupe migrations' documented
-- resolutions (20260725120000 round 1 · 20260726120000 round 2).
insert into public.port_route_alias (alias, canonical) values
  ('ALDUR','ALDRZ'), ('AEFUJ','AEFJR'), ('TRANT','TRAYT'), ('ITBAR','ITBLT'),
  ('DZTNS','DZTEN'), ('GRSKH','GRSKG'), ('GRTHS','GRSKG'), ('GRTGI','GRTSI'),
  ('LYTRP','LYTIP'), ('ESSGN','ESSAG'), ('INKAN','INIXY'), ('ITORT','ITOTN'),
  ('SOBER','SOBBO'), ('TRTRC','TRTZX'), ('TRGLE','TRGEM'),
  ('GRATH','GRPIR'), ('TREGS','TRERE'), ('GRSNC','GRNKV'), ('ITORI','ITQOS'),
  ('ITTER','ITTRI'), ('ITTMI','ITTRI'), ('TRZMT','TRIZT'),
  ('SAJAZ','SAGIZ'), ('SAJIZ','SAGIZ'), ('VEPJO','VEJOT'),
  ('LYBEN','LYBGN'), ('GEBAT','GEBUS'), ('MANAD','MANDR'), ('TRHRK','TRHER'),
  ('ESMAL','ESAGP'), ('OMSOR','OMSOH'), ('GBLIVP','GBLIV'),
  ('EGSFW','EGSGA'), ('EGSFG','EGSGA'), ('INMOR','INIXE'),
  ('UAPIV','UAYUZ'), ('GRELE','GRFLS'), ('TNBIA','TNBIZ'), ('DJDJI','DJJIB'),
  ('ITGHE','ITPMA'), ('ITCAR','ITCAA')
on conflict (alias) do update set canonical = excluded.canonical;

-- ── RLS: world-readable reference data; writes via service role only ────────
alter table public.port_routes          enable row level security;
alter table public.port_route_waypoints enable row level security;
alter table public.port_route_alias     enable row level security;

drop policy if exists "routes read"    on public.port_routes;
drop policy if exists "waypoints read" on public.port_route_waypoints;
drop policy if exists "alias read"     on public.port_route_alias;
create policy "routes read"    on public.port_routes          for select to anon, authenticated using (true);
create policy "waypoints read" on public.port_route_waypoints for select to anon, authenticated using (true);
create policy "alias read"     on public.port_route_alias     for select to anon, authenticated using (true);

grant select on public.port_routes, public.port_route_waypoints, public.port_route_alias to anon, authenticated;
grant all on public.port_routes, public.port_route_waypoints, public.port_route_alias to service_role;

-- ── lookup: symmetric, alias-aware, never errors ────────────────────────────
-- Returns {"found":false} for anything it cannot resolve — callers keep their
-- existing estimated route. Waypoints come back oriented in the REQUESTED
-- direction (reversed + re-cumulated when the pair was measured the other way).
create or replace function public.get_port_route(p_pol text, p_pod text)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $$
declare
  v_pol text := upper(trim(coalesce(p_pol, '')));
  v_pod text := upper(trim(coalesce(p_pod, '')));
  r     public.port_routes%rowtype;
  v_fwd boolean;
  v_wps jsonb;
begin
  if v_pol = '' or v_pod = '' or v_pol = v_pod then
    return jsonb_build_object('found', false);
  end if;
  select coalesce((select canonical from public.port_route_alias where alias = v_pol), v_pol) into v_pol;
  select coalesce((select canonical from public.port_route_alias where alias = v_pod), v_pod) into v_pod;

  select * into r from public.port_routes
  where pair_key = least(v_pol, v_pod) || '|' || greatest(v_pol, v_pod)
  limit 1;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  v_fwd := (r.pol_locode = v_pol);
  if v_fwd then
    select jsonb_agg(jsonb_build_array(w.latitude, w.longitude, w.cumulative_nm) order by w.seq)
      into v_wps from public.port_route_waypoints w where w.route_id = r.id;
  else
    select jsonb_agg(jsonb_build_array(w.latitude, w.longitude,
             case when w.cumulative_nm is null then null
                  else round(greatest(r.total_nm - w.cumulative_nm, 0)::numeric, 1) end)
           order by w.seq desc)
      into v_wps from public.port_route_waypoints w where w.route_id = r.id;
  end if;

  return jsonb_build_object(
    'found', true,
    'total_nm', r.total_nm,
    'verified', r.verified,
    'source', r.source,
    'times_traded', r.times_traded,
    'waypoints', coalesce(v_wps, '[]'::jsonb)
  );
end $$;

grant execute on function public.get_port_route(text, text) to anon, authenticated, service_role;
