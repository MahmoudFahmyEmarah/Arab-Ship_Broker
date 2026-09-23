-- ════════════════════════════════════════════════════════════════════════
-- Port identity: notation stripper fix + dictionary top-up (10 Sep 2026)
--
-- The backfill left 3 sides unclassified and one of them exposed a real bug:
-- in fn_port_strip_notation the safe-port alternative `sps?` has no trailing
-- word boundary, so under the case-insensitive flag it ate the "Sp" of
-- "1SpainMed" → "ainMed", which then matched nothing. `\M` (end of word)
-- makes the alternative back off unless "sp"/"sb" really is its own token.
--
-- The other two were simply missing from the area dictionary:
-- "EC Greece or WC Greece" and "Nigeria or Ghana".
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.fn_port_strip_notation(p text)
 returns text language sql immutable
 set search_path to ''
as $$
  -- order matters: brackets, then a leading "either", then the safe-port /
  -- quantity notation, then a trailing range word, then collapse the spaces.
  -- The \M after the sp/sb alternation is load-bearing: without it "1SpainMed"
  -- loses its "Sp".
  select trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(p, ''), '\([^)]*\)', ' ', 'g'),
          '^\s*either\s+', '', 'i'),
        '^\s*\d+\s*[-–]?\s*\d*\s*(?:(?:sps?|sbs?|safe\s*ports?|safe\s*berths?)\M)?\s*(?:out\s+of\s+)?', '', 'i'),
      '\s+(?:rge|range|area|coast)\s*$', '', 'i'),
    '\s+', ' ', 'g'));
$$;

-- Areas the live listings name that the first seed missed.
insert into public.port_areas (area_key, area_name, kind, zone, ref_locode, candidate_locodes, alias_keys, note) values
  ('nigeria', 'Nigeria', 'country', 'WCAF', 'NGLOS', array['NGLOS','NGONN','NGAPP','NGPHC'], '{}', null),
  ('ghana',   'Ghana',   'country', 'WCAF', null,    '{}', '{}', 'no Ghanaian port in the registry yet — pick a port to route')
on conflict (area_key) do nothing;

-- "EC Greece" / "WC Greece" are the two coasts of the same country range.
update public.port_areas
   set alias_keys = (
     select array_agg(distinct k) from unnest(alias_keys || array['ec greece','wc greece','east coast greece','west coast greece']) k)
 where area_key = 'greece';

update public.port_areas a set ref_locode = null
 where a.ref_locode is not null
   and not exists (select 1 from public.ports p where p.locode = a.ref_locode);
update public.port_areas a
   set candidate_locodes = coalesce((
         select array_agg(c order by c) from unnest(a.candidate_locodes) c
          where exists (select 1 from public.ports p where p.locode = c)), '{}'::text[]);

-- Re-classify only the sides the first pass could not place.
alter table public.cargo_listings disable trigger trg_matches_on_cargo;
update public.cargo_listings
   set load_port_scope = null, disch_port_scope = null
 where load_port_scope = 'none' or disch_port_scope = 'none';
alter table public.cargo_listings enable trigger trg_matches_on_cargo;
