-- ════════════════════════════════════════════════════════════════════
-- Public Market Insights — Part 4: weekly-edition email capture
--                                              · append-only
--
-- A single-field opt-in on the public page ("get the weekly edition"). Writes
-- go through a SECURITY DEFINER RPC (no anon INSERT on the table, no service
-- key in the browser). The list is readable only to admins.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.market_insights_subscribers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  source      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.market_insights_subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insights subs: admin read" ON public.market_insights_subscribers;
CREATE POLICY "insights subs: admin read" ON public.market_insights_subscribers
  FOR ALL TO authenticated
  USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());
GRANT ALL ON public.market_insights_subscribers TO service_role;

CREATE OR REPLACE FUNCTION public.fn_market_insights_subscribe(p_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_email text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;
  INSERT INTO public.market_insights_subscribers (email, source)
  VALUES (v_email, 'market_insights')
  ON CONFLICT (email) DO NOTHING;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_market_insights_subscribe(text) TO anon, authenticated;
