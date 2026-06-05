-- ════════════════════════════════════════════════════════════════════
-- Public hero stats RPC  · append-only · firewall-safe
--
-- The landing page counts cargo/vessels via the ANON client, but the base
-- tables are not anon-readable (RLS), so SELECT count(*) returned 0 — the hero
-- showed "0 / 0". This SECURITY DEFINER function returns ONLY aggregate counts
-- (no rows, no PII), granted to anon — the firewall-correct way to expose a
-- public number without exposing data or using the service-role key.
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_public_stats()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'cargo_count',  (SELECT count(*) FROM public.cargo_listings),
    'vessel_count', (SELECT count(*) FROM public.vessels),
    'zone_count',   (SELECT count(*) FROM (
        SELECT load_zone  AS z FROM public.cargo_listings WHERE load_zone  IS NOT NULL
        UNION
        SELECT disch_zone AS z FROM public.cargo_listings WHERE disch_zone IS NOT NULL
      ) zs)
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_public_stats() TO anon, authenticated;
