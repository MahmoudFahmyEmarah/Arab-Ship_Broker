-- ════════════════════════════════════════════════════════════════════
-- Public platform totals — the "we have something" stats bar · firewall-safe
--
-- Aggregate-only reach figures for an anonymous public stats bar: the live
-- cargo book, vessels tracked, open positions, ports, trade zones and member
-- companies. SECURITY DEFINER so the counts are correct under RLS; returns
-- ONLY integers (no rows, no PII, no contact, no service-role key). Guarded so
-- it still answers on schemas missing the org/ports tables.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_public_platform_totals()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cargo int := 0; v_vessel int := 0; v_open int := 0;
  v_port int := 0; v_zone int := 0; v_company int := 0;
BEGIN
  IF to_regclass('public.cargo_listings') IS NOT NULL THEN
    SELECT count(*)::int INTO v_cargo FROM public.cargo_listings
      WHERE status IN ('IN','PARTIAL') AND review_status = 'APPROVED';
  END IF;
  IF to_regclass('public.vessels') IS NOT NULL THEN
    SELECT count(*)::int INTO v_vessel FROM public.vessels;
  END IF;
  IF to_regclass('public.vessel_availability') IS NOT NULL THEN
    SELECT count(*)::int INTO v_open FROM public.vessel_availability
      WHERE status = 'OPEN' AND review_status = 'APPROVED';
  END IF;
  IF to_regclass('public.ports') IS NOT NULL THEN
    SELECT count(*)::int INTO v_port FROM public.ports;
    SELECT count(DISTINCT zone)::int INTO v_zone FROM public.ports
      WHERE zone IS NOT NULL AND zone::text <> 'Unknown';
  END IF;
  IF to_regclass('public.organizations') IS NOT NULL THEN
    SELECT count(*)::int INTO v_company FROM public.organizations;
  END IF;

  RETURN jsonb_build_object(
    'cargo_live',     v_cargo,
    'vessels',        v_vessel,
    'open_positions', v_open,
    'ports',          v_port,
    'zones',          v_zone,
    'companies',      v_company
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_public_platform_totals() TO anon, authenticated;
