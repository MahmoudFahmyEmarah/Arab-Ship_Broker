-- ════════════════════════════════════════════════════════════════════
-- Landing live counters — WIDENED to platform totals · append-only · firewall-safe
--
-- Redefines get_public_stats() so the public hero reflects the REAL platform
-- figures (matching the unified master dataset: 731 cargo, 88 vessels, 16 trade
-- zones) instead of the narrow ±7-day open window — which read as a dead "0"
-- whenever nothing happened to fall inside that window.
--
-- New definitions (still aggregate-only — three integers, no rows, no PII,
-- no service-role key; SECURITY DEFINER so the counts are correct under RLS):
--   cargo_count  = total cargo listings held (every record, "Cargo Records").
--   vessel_count = total vessels in the register ("Vessels Tracked").
--   zone_count   = distinct trade zones the platform covers (ports.zone,
--                  excluding the 'Unknown' sentinel).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_public_stats()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
SELECT jsonb_build_object(
  'cargo_count',  (SELECT count(*)::int FROM public.cargo_listings),
  'vessel_count', (SELECT count(*)::int FROM public.vessels),
  'zone_count',   (SELECT count(DISTINCT zone)::int
                   FROM public.ports
                   WHERE zone IS NOT NULL AND zone <> 'Unknown')
);
$$;
GRANT EXECUTE ON FUNCTION public.get_public_stats() TO anon, authenticated;
