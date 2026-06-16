-- ════════════════════════════════════════════════════════════════════
-- Public Market Insights — Part 2: frozen weekly editions + generator
--                                              · append-only · firewall-safe
--
-- Each Monday a job calls fn_publish_market_insights_edition(), which runs the
-- Part-1 aggregate query (fn_build_market_insights) for the trailing week and
-- SAVES the result as an immutable edition. Once published, the numbers are
-- frozen (a dated, citable publication); only the hand-written narrative stays
-- editable. The public page reads these frozen editions through anon RPCs —
-- never the base tables, never the generator.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.market_insights_editions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id       text NOT NULL UNIQUE,          -- e.g. '2026-W23'
  range_from    date NOT NULL,
  range_to      date NOT NULL,
  payload       jsonb NOT NULL,                -- the floored/banded aggregate (Part 1)
  narrative     text,                          -- broker's market-read; admin-filled
  published_at  timestamptz,                   -- null = draft; set = frozen + public
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mie_published ON public.market_insights_editions (published_at DESC) WHERE published_at IS NOT NULL;

-- ── Immutability: once published, the numbers/range/week never change ──
-- (narrative + updated_at remain editable so the broker can refine the read).
CREATE OR REPLACE FUNCTION public.fn_market_insights_freeze()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    IF NEW.payload    IS DISTINCT FROM OLD.payload
       OR NEW.range_from IS DISTINCT FROM OLD.range_from
       OR NEW.range_to   IS DISTINCT FROM OLD.range_to
       OR NEW.week_id    IS DISTINCT FROM OLD.week_id
       OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'Published edition % is frozen — only the narrative may change', OLD.week_id;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_market_insights_freeze ON public.market_insights_editions;
CREATE TRIGGER trg_market_insights_freeze
  BEFORE UPDATE ON public.market_insights_editions
  FOR EACH ROW EXECUTE FUNCTION public.fn_market_insights_freeze();

-- ── RLS: anon/auth read PUBLISHED editions only; writes are admin/service ──
ALTER TABLE public.market_insights_editions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insights: read published" ON public.market_insights_editions;
CREATE POLICY "insights: read published" ON public.market_insights_editions
  FOR SELECT TO anon, authenticated
  USING (published_at IS NOT NULL);
DROP POLICY IF EXISTS "insights: admin all" ON public.market_insights_editions;
CREATE POLICY "insights: admin all" ON public.market_insights_editions
  FOR ALL TO authenticated
  USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());
GRANT SELECT ON public.market_insights_editions TO anon, authenticated;
GRANT ALL ON public.market_insights_editions TO service_role;

-- ── Generate + freeze an edition (run by the Monday job / admin via service role) ──
-- Idempotent per week_id: if the week already exists AND is published, the
-- numbers are NOT recomputed (frozen); a draft is refreshed until published.
CREATE OR REPLACE FUNCTION public.fn_publish_market_insights_edition(
  p_from date, p_to date, p_week_id text, p_publish boolean DEFAULT true
)
RETURNS public.market_insights_editions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing public.market_insights_editions;
  v_payload  jsonb;
  v_row      public.market_insights_editions;
BEGIN
  SELECT * INTO v_existing FROM public.market_insights_editions WHERE week_id = p_week_id;

  -- Frozen: published week is returned untouched.
  IF v_existing.id IS NOT NULL AND v_existing.published_at IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_payload := public.fn_build_market_insights(p_from, p_to);

  INSERT INTO public.market_insights_editions (week_id, range_from, range_to, payload, published_at)
  VALUES (p_week_id, p_from, p_to, v_payload, CASE WHEN p_publish THEN now() END)
  ON CONFLICT (week_id) DO UPDATE
    SET range_from = EXCLUDED.range_from,
        range_to   = EXCLUDED.range_to,
        payload    = EXCLUDED.payload,
        published_at = COALESCE(public.market_insights_editions.published_at,
                                CASE WHEN p_publish THEN now() END)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_publish_market_insights_edition(date, date, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_publish_market_insights_edition(date, date, text, boolean) TO service_role;

-- ── Admin: edit the narrative (numbers stay frozen) ──
CREATE OR REPLACE FUNCTION public.fn_set_market_insights_narrative(p_week_id text, p_text text)
RETURNS public.market_insights_editions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.market_insights_editions;
BEGIN
  UPDATE public.market_insights_editions
     SET narrative = p_text
   WHERE week_id = p_week_id
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Edition % not found', p_week_id; END IF;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_set_market_insights_narrative(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_set_market_insights_narrative(text, text) TO service_role;

-- ── Public read surface (anon) — frozen, published editions only ──
CREATE OR REPLACE FUNCTION public.get_latest_market_insights()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(e) - 'id'
  FROM public.market_insights_editions e
  WHERE e.published_at IS NOT NULL
  ORDER BY e.range_to DESC, e.published_at DESC
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_latest_market_insights() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_market_insights_edition(p_week_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(e) - 'id'
  FROM public.market_insights_editions e
  WHERE e.published_at IS NOT NULL AND e.week_id = p_week_id
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_market_insights_edition(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_market_insights_archive()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'week_id', week_id, 'range_from', range_from,
           'range_to', range_to, 'published_at', published_at
         ) ORDER BY range_to DESC), '[]'::jsonb)
  FROM public.market_insights_editions
  WHERE published_at IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.get_market_insights_archive() TO anon, authenticated;
