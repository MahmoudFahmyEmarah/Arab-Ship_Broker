-- Two same-port code variants discovered during the route import: the ECDIS
-- master uses the official UN/LOCODEs where the curated ports table carries
-- the workbook variants. Map the curated codes onto the stored route codes so
-- app lookups (which use curated codes) hit the measured routes.
--   RUNOI (curated, Novorossiysk) → RUNVS (official, used by the route data)
--   UAREN (curated, Reni)         → UARNI (official, used by the route data)
insert into public.port_route_alias (alias, canonical) values
  ('RUNOI', 'RUNVS'),
  ('UAREN', 'UARNI')
on conflict (alias) do update set canonical = excluded.canonical;
