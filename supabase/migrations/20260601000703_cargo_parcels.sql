-- ════════════════════════════════════════════════════════════════════
-- Cargo classification — Part 4: multi-parcel schema  · append-only, additive
--
-- A listing is a container; each parcel self-classifies (own regime+code).
-- Existing single-parcel cargo_listings are UNCHANGED (a listing with no
-- cargo_parcels rows = one implicit parcel via its own fields). The guard
-- (Part 3) is enforced here by a BEFORE INSERT/UPDATE trigger, so a crafted
-- request can't bypass it. Firewall untouched — no counterparty contact.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cargo_parcels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      uuid NOT NULL REFERENCES public.cargo_listings(id) ON DELETE CASCADE,
  parcel_no       smallint NOT NULL DEFAULT 1,
  -- classification result (one classifier live per parcel)
  market_name     text NOT NULL,
  regime          public.cargo_regime_enum NOT NULL DEFAULT 'UNMAPPED',
  classifier_code text,
  imsbc_group     text,                                  -- 'A'|'B'|'C' when IMSBC
  css_category    text REFERENCES public.css_categories(code),
  is_bulk         boolean NOT NULL DEFAULT true,
  is_grain        boolean NOT NULL DEFAULT false,
  -- per-parcel commercial (listing-level terms inherited when NULL)
  qty_min_mt        numeric,
  qty_max_mt        numeric,
  stowage_factor    numeric,
  load_port_locode  text,
  disch_port_locode text,
  laycan_from       date,
  laycan_to         date,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, parcel_no)
);
CREATE INDEX IF NOT EXISTS idx_cargo_parcels_listing ON public.cargo_parcels (listing_id);
CREATE INDEX IF NOT EXISTS idx_cargo_parcels_code    ON public.cargo_parcels (regime, classifier_code);

-- ── Guard trigger — enforces Part 3 plausibility at the data layer ──
CREATE OR REPLACE FUNCTION public.trg_parcel_classification_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  v := public.validate_cargo_classification(
         NEW.market_name, NEW.regime,
         COALESCE(NEW.imsbc_group, NEW.css_category, NEW.classifier_code));
  IF NOT (v->>'ok')::boolean THEN
    RAISE EXCEPTION '%', v->>'reason' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS parcel_classification_guard ON public.cargo_parcels;
CREATE TRIGGER parcel_classification_guard
  BEFORE INSERT OR UPDATE ON public.cargo_parcels
  FOR EACH ROW EXECUTE FUNCTION public.trg_parcel_classification_guard();

-- ── RLS — inherit the parent listing's visibility / ownership ──
ALTER TABLE public.cargo_parcels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parcels: admin all"   ON public.cargo_parcels;
DROP POLICY IF EXISTS "parcels: read"        ON public.cargo_parcels;
DROP POLICY IF EXISTS "parcels: owner write" ON public.cargo_parcels;

CREATE POLICY "parcels: admin all" ON public.cargo_parcels
  FOR ALL TO authenticated USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());

CREATE POLICY "parcels: read" ON public.cargo_parcels
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.cargo_listings cl
      WHERE cl.id = listing_id
        AND (
          (cl.review_status = 'APPROVED' AND cl.status IN ('IN','PARTIAL'))
          OR EXISTS (
            SELECT 1 FROM public.listing_ownership lo
            WHERE lo.listing_id = cl.id AND lo.listing_type = 'cargo'
              AND lo.owner_user_id = auth.uid())
        )
    )
  );

CREATE POLICY "parcels: owner write" ON public.cargo_parcels
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.listing_ownership lo
            WHERE lo.listing_id = listing_id AND lo.listing_type = 'cargo'
              AND lo.owner_user_id = auth.uid() AND lo.role = 'primary' AND lo.is_current)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.listing_ownership lo
            WHERE lo.listing_id = listing_id AND lo.listing_type = 'cargo'
              AND lo.owner_user_id = auth.uid() AND lo.role = 'primary' AND lo.is_current)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cargo_parcels TO authenticated;
