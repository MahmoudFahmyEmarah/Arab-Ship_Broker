-- ════════════════════════════════════════════════════════════════════
-- Bunker prices subsystem  · append-only
--
-- Backs the bunker ticker with real data + lets registered suppliers seed their
-- own prices on a schedule via a credentialed channel (username/password we
-- provision), and lets admins manage everything.
--
--   • bunker_suppliers        — the registered bunker suppliers (sponsors)
--   • bunker_ingest_accounts  — per-supplier service credentials (we provision)
--   • bunker_prices           — the price rows; freshness derived from observed_at
--
-- Three access paths, all firewall-safe (no service-role key in app/browser):
--   1. Public ticker  → get_bunker_ticker()  (SECURITY DEFINER, anon)   — read
--   2. Supplier ingest→ bunker_ingest(user,secret,rows) (SEC. DEFINER, anon)
--      — verifies the credential with pgcrypto crypt() and inserts that
--        supplier's rows. Auth lives in the DB; the API never holds a secret.
--   3. Admin          → RLS gated on fn_is_admin() for full CRUD.
-- ════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── tables ──
CREATE TABLE IF NOT EXISTS public.bunker_suppliers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  port        text,
  website     text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bunker_ingest_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid NOT NULL REFERENCES public.bunker_suppliers(id) ON DELETE CASCADE,
  username     text UNIQUE NOT NULL,
  secret_hash  text NOT NULL,           -- pgcrypto bcrypt: crypt(secret, gen_salt('bf'))
  is_active    boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bunker_prices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid NOT NULL REFERENCES public.bunker_suppliers(id) ON DELETE CASCADE,
  port         text,
  fuel         text NOT NULL,           -- VLSFO / LSMGO / MGO / IFO 380 …
  value        numeric NOT NULL,
  currency     text NOT NULL DEFAULT 'USD',
  dir          text CHECK (dir IN ('up','down','flat')),
  observed_at  timestamptz NOT NULL DEFAULT now(),
  source       text NOT NULL DEFAULT 'ingest',  -- 'ingest' | 'admin'
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bunker_prices_supplier ON public.bunker_prices (supplier_id, observed_at DESC);

-- ── RLS ──
ALTER TABLE public.bunker_suppliers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bunker_ingest_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bunker_prices          ENABLE ROW LEVEL SECURITY;

-- Admins manage suppliers + prices (read path for the public is the RPC below).
DROP POLICY IF EXISTS "bunker suppliers admin" ON public.bunker_suppliers;
CREATE POLICY "bunker suppliers admin" ON public.bunker_suppliers
  FOR ALL TO authenticated USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());
DROP POLICY IF EXISTS "bunker prices admin" ON public.bunker_prices;
CREATE POLICY "bunker prices admin" ON public.bunker_prices
  FOR ALL TO authenticated USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());
-- Ingest accounts: admin-only, and secret_hash is NEVER selectable by clients
-- (admin reads username/last_seen via the masked RPC below, not the raw table).
DROP POLICY IF EXISTS "bunker accounts admin" ON public.bunker_ingest_accounts;
CREATE POLICY "bunker accounts admin" ON public.bunker_ingest_accounts
  FOR ALL TO authenticated USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());

-- ── 1. Public ticker feed (anon) — active suppliers + their latest price set ──
CREATE OR REPLACE FUNCTION public.get_bunker_ticker()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(row ORDER BY age_days), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'name', s.name, 'url', COALESCE(s.website, '#'), 'port', s.port,
      'ageDays', GREATEST(0, (EXTRACT(EPOCH FROM (now() - lp.observed_at)) / 86400)::int),
      'prices', lp.prices
    ) AS row,
    GREATEST(0, (EXTRACT(EPOCH FROM (now() - lp.observed_at)) / 86400)::int) AS age_days
    FROM public.bunker_suppliers s
    JOIN LATERAL (
      SELECT max(p.observed_at) AS observed_at,
             jsonb_agg(jsonb_build_object('fuel', p.fuel, 'value', p.value, 'dir', p.dir)
                       ORDER BY p.fuel) AS prices
      FROM public.bunker_prices p
      WHERE p.supplier_id = s.id
        AND p.observed_at = (SELECT max(p2.observed_at) FROM public.bunker_prices p2 WHERE p2.supplier_id = s.id)::date
    ) lp ON TRUE
    WHERE s.is_active
      AND lp.observed_at IS NOT NULL
      AND now() - lp.observed_at < INTERVAL '22 days'   -- hidden > 21d
  ) t;
$$;
GRANT EXECUTE ON FUNCTION public.get_bunker_ticker() TO anon, authenticated;

-- ── 2. Credentialed supplier ingest (anon endpoint; auth inside the function) ──
-- p_prices: [{ "fuel":"VLSFO","value":1183,"dir":"down","port":"Fujairah" }, …]
CREATE OR REPLACE FUNCTION public.bunker_ingest(p_username text, p_secret text, p_prices jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_acct  public.bunker_ingest_accounts%ROWTYPE;
  v_row   jsonb;
  v_n     int := 0;
BEGIN
  SELECT * INTO v_acct FROM public.bunker_ingest_accounts WHERE username = p_username AND is_active;
  IF NOT FOUND OR v_acct.secret_hash <> crypt(p_secret, v_acct.secret_hash) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;
  IF jsonb_typeof(p_prices) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'prices_must_be_array');
  END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_prices) LOOP
    INSERT INTO public.bunker_prices (supplier_id, port, fuel, value, dir, source)
    VALUES (
      v_acct.supplier_id,
      COALESCE(v_row->>'port', (SELECT port FROM public.bunker_suppliers WHERE id = v_acct.supplier_id)),
      v_row->>'fuel',
      (v_row->>'value')::numeric,
      NULLIF(v_row->>'dir',''),
      'ingest'
    );
    v_n := v_n + 1;
  END LOOP;
  UPDATE public.bunker_ingest_accounts SET last_seen_at = now() WHERE id = v_acct.id;
  RETURN jsonb_build_object('ok', true, 'inserted', v_n);
END;
$$;
GRANT EXECUTE ON FUNCTION public.bunker_ingest(text, text, jsonb) TO anon, authenticated;

-- ── 3. Admin helpers: provision a credential (returns nothing sensitive) ──
CREATE OR REPLACE FUNCTION public.admin_set_bunker_credential(p_supplier_id uuid, p_username text, p_secret text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.fn_is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_admin');
  END IF;
  INSERT INTO public.bunker_ingest_accounts (supplier_id, username, secret_hash)
  VALUES (p_supplier_id, p_username, crypt(p_secret, gen_salt('bf')))
  ON CONFLICT (username) DO UPDATE
    SET secret_hash = EXCLUDED.secret_hash, supplier_id = EXCLUDED.supplier_id, is_active = true;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_bunker_credential(uuid, text, text) TO authenticated;
