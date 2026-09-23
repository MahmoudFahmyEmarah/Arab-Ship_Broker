-- ════════════════════════════════════════════════════════════════════════
-- Port master: coordinates, two missing ports, directional routes (10 Sep 2026)
--
-- Three follow-ups from the port identity work:
--
-- 1 · 19 active ports carried NO latitude/longitude. A port without
--     coordinates cannot be estimated at all — not from a stored route, not
--     from the sea-graph corridor, not even from the fallback arc; the map
--     simply refuses to draw. That is strictly worse than an approximate
--     line, and it affected 19 live listings plus the "North China"
--     reference port (Dalian). Filled here with approximate port positions,
--     marked in `notes` so the UN/LOCODE import can overwrite them with
--     authoritative values.
--
-- 2 · Two names sat in port_review_queue because the ports genuinely did not
--     exist in the registry: Vysotsk (RUVYS, Russian Baltic — the "Vyotsk"
--     spelling in the circular) and Tallinn (EETLL, of which "Vene Balti" is
--     a terminal). Added, aliased, and the queue rows resolved.
--     Zone note: the registry files Baltic ports under NCONT (Gdansk,
--     Gdynia, Szczecin, Klaipeda all are), so these follow that convention
--     rather than introducing the first BALTIC-zoned rows.
--
-- 3 · port_routes had a UNIQUE index on pair_key, so the table could hold
--     only ONE track per unordered pair. Today that loses nothing — all 420
--     surveyed pairs in the ECDIS master are one-directional and there is
--     not a single reciprocal pair — but the day a genuinely different
--     outbound/inbound track arrives (a Bosphorus TSS or a Suez convoy
--     case), the second one would have been silently rejected. The table now
--     accepts a direction-specific row alongside the symmetric one, and
--     get_port_route prefers an exact directional match, falling back to the
--     symmetric row reversed — and it now SAYS which of the two you got.
--
-- Additive + idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · coordinates for the 19 ports that had none ──────────────────────────
-- Approximate port/berth positions, good to well under a mile — ample for a
-- voyage estimate of hundreds or thousands of miles, and replaceable.
with fixes(locode, lat, lon) as (values
  ('EGAZN',  29.03,   33.06),    -- Abu Zenima, Gulf of Suez
  ('NGAPP',   6.45,    3.36),    -- Apapa, Lagos
  ('DZAZW',  35.85,   -0.32),    -- Arzew
  ('USASH',  41.90,  -80.79),    -- Ashtabula, Lake Erie
  ('CNDLC',  38.93,  121.63),    -- Dalian
  ('CNDDG',  39.83,  124.16),    -- Dandong, Yalu river approaches
  ('ITGOA',  44.41,    8.92),    -- Genoa
  ('BEGNE',  51.10,    3.72),    -- Ghent
  ('CNLYG',  34.75,  119.45),    -- Lianyungang
  ('ROMED',  44.25,   28.28),    -- Medgidia, Danube–Black Sea canal
  ('ESMOT',  36.72,   -3.52),    -- Motril
  ('TZMYW', -10.27,   40.19),    -- Mtwara
  ('GRNPE',  40.85,   24.30),    -- Nea Peramos, near Kavala
  ('DENOR',  52.43,    7.07),    -- Nordhorn (inland waterway location)
  ('NGONN',   4.70,    7.15),    -- Onne
  ('UAORL',  45.33,   28.47),    -- Orlivka, Danube
  ('BRPNG', -25.52,  -48.51),    -- Paranagua
  ('HRRJK',  45.33,   14.44),    -- Rijeka
  ('EGSUZ',  29.93,   32.55)     -- Suez
)
update public.ports p
   set latitude  = f.lat,
       longitude = f.lon,
       notes     = coalesce(nullif(p.notes, '') || ' · ', '')
                   || 'Coordinates approximate, added 10 Sep 2026 — replace on UN/LOCODE import'
  from fixes f
 where p.locode = f.locode
   and (p.latitude is null or p.longitude is null);

-- ── 2 · the two ports the queue was waiting on ──────────────────────────────
insert into public.ports (locode, trade_name, country, zone, port_type, latitude, longitude, notes, unlocode_status)
values
  ('RUVYS', 'Vysotsk', 'Russia',  'NCONT', 'Sea Port', 60.63, 28.57,
   'Baltic grain / coal terminal near Vyborg. Circulars write it "Vyotsk". Coordinates approximate, added 10 Sep 2026 — replace on UN/LOCODE import', 'AI'),
  ('EETLL', 'Tallinn', 'Estonia', 'NCONT', 'Sea Port', 59.45, 24.77,
   'Muuga / Paldiski / Bekker terminal complex; "Vene-Balti" is one of its berths. Coordinates approximate, added 10 Sep 2026 — replace on UN/LOCODE import', 'AI')
on conflict (locode) do nothing;

insert into public.port_aliases (alias_key, alias_text, locode, canonical_name, note) values
  ('vyotsk',     'Vyotsk',     'RUVYS', null, 'Circular spelling of Vysotsk'),
  ('vysotsk',    'Vysotsk',    'RUVYS', null, null),
  ('vene balti', 'Vene Balti', 'EETLL', null, 'Vene-Balti terminal, port of Tallinn'),
  ('venebalti',  'VeneBalti',  'EETLL', null, 'Vene-Balti terminal, port of Tallinn')
on conflict (alias_key) do nothing;

update public.port_review_queue
   set status = 'mapped', resolved_kind = 'alias', resolved_at = now(),
       mapped_locode = case when name_key in ('vyotsk', 'vysotsk') then 'RUVYS' else 'EETLL' end
 where status = 'pending' and name_key in ('vyotsk', 'vysotsk', 'vene balti', 'venebalti');

-- Re-classify the staged rows' listings, if any of that text reached a listing.
alter table public.cargo_listings disable trigger trg_matches_on_cargo;
update public.cargo_listings set load_port_scope = null
 where public.fn_port_key(public.fn_port_strip_notation(coalesce(load_port_name, ''))) in ('vyotsk', 'vysotsk', 'vene balti', 'venebalti');
update public.cargo_listings set disch_port_scope = null
 where public.fn_port_key(public.fn_port_strip_notation(coalesce(disch_port_name, ''))) in ('vyotsk', 'vysotsk', 'vene balti', 'venebalti');
alter table public.cargo_listings enable trigger trg_matches_on_cargo;

-- ── 3 · make room for a genuinely directional route ─────────────────────────
alter table public.port_routes
  add column if not exists direction_specific boolean not null default false;
comment on column public.port_routes.direction_specific is
  'true = this track applies ONLY pol→pod (a one-way TSS, a canal convoy, a river passage). false = symmetric: the reverse is served by reversing this track. Verified 10 Sep 2026: all 420 surveyed ECDIS pairs are symmetric, none reciprocal.';

-- One symmetric row per pair, as before — but a directional row may sit
-- alongside it, unique on the ordered pair.
drop index if exists public.idx_port_routes_pair;
create unique index if not exists idx_port_routes_pair
  on public.port_routes (pair_key) where not direction_specific;
create unique index if not exists idx_port_routes_directional
  on public.port_routes (pol_locode, pod_locode) where direction_specific;

-- Exact direction first, then the symmetric row reversed. Now reports which.
create or replace function public.get_port_route(p_pol text, p_pod text)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
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

  -- 1 · a track surveyed for exactly this direction wins outright
  select * into r from public.port_routes
   where direction_specific and pol_locode = v_pol and pod_locode = v_pod
   limit 1;

  -- 2 · otherwise the symmetric row for the pair, reversed if needed
  if not found then
    select * into r from public.port_routes
     where not direction_specific
       and pair_key = least(v_pol, v_pod) || '|' || greatest(v_pol, v_pod)
     limit 1;
  end if;
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
    'chokepoints', to_jsonb(coalesce(r.chokepoints, '{}'::text[])),
    -- how this answer was produced, so a caller can be honest about it
    'reversed', not v_fwd,
    'direction_specific', r.direction_specific,
    'surveyed_as', r.pol_locode || ' → ' || r.pod_locode,
    'waypoints', coalesce(v_wps, '[]'::jsonb)
  );
end $function$;
