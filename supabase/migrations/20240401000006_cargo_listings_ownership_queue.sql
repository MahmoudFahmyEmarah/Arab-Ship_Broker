-- ── Enums ─────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.cargo_status_enum AS ENUM ('IN','PARTIAL','OUT','CLOSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.cargo_priority_enum AS ENUM ('HIGH','MED','LOW','CLOSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.review_status_enum AS ENUM ('PENDING','APPROVED','REJECTED','FLAGGED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.load_terms_enum AS ENUM ('FIO','FIOT','FIOST','FIOS','FIOS LSD','Liner Terms');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.ownership_role_enum AS ENUM ('primary','co_broker','admin_posted');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.transfer_reason_enum AS ENUM (
    'initial_post','claim_approved','dispute_resolved','admin_transfer','broker_left','error_correction'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── 1. TABLES & INDEXES ───────────────────────────────────────

-- cargo_listings
CREATE TABLE IF NOT EXISTS public.cargo_listings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                   TEXT UNIQUE,
  status                public.cargo_status_enum NOT NULL DEFAULT 'IN',
  priority              public.cargo_priority_enum,

  cargo_type            public.cargo_type_v2_enum NOT NULL,
  commodity_id          UUID REFERENCES public.commodities(id),
  commodity_name        TEXT NOT NULL,
  is_dg_cargo           BOOLEAN NOT NULL DEFAULT FALSE,
  is_grain_cargo        BOOLEAN NOT NULL DEFAULT FALSE,

  qty_min_mt            INTEGER NOT NULL,
  qty_max_mt            INTEGER NOT NULL,
  stowage_factor        NUMERIC(5,2),

  load_port_locode      TEXT REFERENCES public.ports(locode),
  load_port_name        TEXT,
  load_zone             public.zone_enum,
  load_country          TEXT,

  disch_port_locode     TEXT REFERENCES public.ports(locode),
  disch_port_name       TEXT,
  disch_zone            public.zone_enum,
  disch_country         TEXT,

  laycan_from           DATE,
  laycan_to             DATE,
  is_spot               BOOLEAN NOT NULL DEFAULT FALSE,

  load_rate             TEXT,
  disch_rate            TEXT,
  load_terms            public.load_terms_enum,
  laytime_structure     TEXT,
  nor_clause            TEXT,
  freight_idea_usd_mt   NUMERIC(8,2),
  commission_pct        NUMERIC(4,2),
  demurrage_rate        NUMERIC(10,2),
  despatch_rate         NUMERIC(10,2),

  requires_geared       BOOLEAN,
  max_vessel_age_yr     SMALLINT,
  max_loa_m             NUMERIC(6,2),
  max_draft_m           NUMERIC(5,2),

  broker                TEXT,
  notes                 TEXT,

  review_status         public.review_status_enum NOT NULL DEFAULT 'PENDING',
  goes_live_at          TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cl_status   ON public.cargo_listings (status, review_status);
CREATE INDEX IF NOT EXISTS idx_cl_load_zone  ON public.cargo_listings (load_zone);
CREATE INDEX IF NOT EXISTS idx_cl_disch_zone ON public.cargo_listings (disch_zone);
CREATE INDEX IF NOT EXISTS idx_cl_laycan   ON public.cargo_listings (laycan_from, laycan_to);
CREATE INDEX IF NOT EXISTS idx_cl_is_spot  ON public.cargo_listings (is_spot);

-- listing_ownership
CREATE TABLE IF NOT EXISTS public.listing_ownership (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_type     TEXT NOT NULL CHECK (listing_type IN ('cargo','vessel_availability')),
  listing_id       UUID NOT NULL,
  owner_user_id    UUID NOT NULL,
  role             public.ownership_role_enum NOT NULL DEFAULT 'primary',
  is_current       BOOLEAN NOT NULL DEFAULT TRUE,
  owned_from       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  owned_until      TIMESTAMPTZ,
  transfer_reason  public.transfer_reason_enum NOT NULL DEFAULT 'initial_post',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lo_listing ON public.listing_ownership (listing_id, listing_type);
CREATE INDEX IF NOT EXISTS idx_lo_owner   ON public.listing_ownership (owner_user_id, is_current);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lo_one_primary
  ON public.listing_ownership (listing_id, listing_type)
  WHERE is_current = TRUE AND role = 'primary';

-- cargo_safety_answers
CREATE TABLE IF NOT EXISTS public.cargo_safety_answers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cargo_listing_id UUID NOT NULL REFERENCES public.cargo_listings(id) ON DELETE CASCADE,
  question_id      UUID REFERENCES public.safety_questions(id),
  question_key     TEXT NOT NULL,
  answer_value     TEXT,
  answered_by      UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_csa_listing ON public.cargo_safety_answers (cargo_listing_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_csa_unique_answer
  ON public.cargo_safety_answers (cargo_listing_id, question_key);

-- review_queue
CREATE TABLE IF NOT EXISTS public.review_queue (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_type          TEXT NOT NULL CHECK (listing_type IN ('cargo','vessel_availability')),
  listing_id            UUID NOT NULL,
  submitted_by          UUID NOT NULL,
  trust_tier_at_submit  public.trust_tier_enum,
  is_random_sample      BOOLEAN NOT NULL DEFAULT FALSE,
  review_reason         TEXT,
  status                public.review_status_enum NOT NULL DEFAULT 'PENDING',
  action_taken          TEXT CHECK (action_taken IN ('approved','rejected','amended','flagged')),
  amendment_detail      TEXT,
  reviewed_by           UUID,
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rq_status ON public.review_queue (status, created_at);
CREATE INDEX IF NOT EXISTS idx_rq_listing ON public.review_queue (listing_id, listing_type);


-- ── 2. FUNCTIONS & TRIGGERS ───────────────────────────────────

-- cargo_listings updated_at
DROP TRIGGER IF EXISTS trg_cargo_listings_updated_at ON public.cargo_listings;
CREATE TRIGGER trg_cargo_listings_updated_at
  BEFORE UPDATE ON public.cargo_listings
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- cargo_listings port autofill
CREATE OR REPLACE FUNCTION public.fn_cl_port_autofill()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_load_port  public.ports%ROWTYPE;
  v_disch_port public.ports%ROWTYPE;
BEGIN
  IF NEW.load_port_locode IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD.load_port_locode IS DISTINCT FROM NEW.load_port_locode) THEN
    SELECT * INTO v_load_port FROM public.ports WHERE locode = NEW.load_port_locode;
    IF FOUND THEN
      NEW.load_port_name := v_load_port.trade_name;
      NEW.load_zone      := v_load_port.zone;
      NEW.load_country   := v_load_port.country;
    END IF;
  END IF;

  IF NEW.disch_port_locode IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD.disch_port_locode IS DISTINCT FROM NEW.disch_port_locode) THEN
    SELECT * INTO v_disch_port FROM public.ports WHERE locode = NEW.disch_port_locode;
    IF FOUND THEN
      NEW.disch_port_name := v_disch_port.trade_name;
      NEW.disch_zone      := v_disch_port.zone;
      NEW.disch_country   := v_disch_port.country;
    END IF;
  END IF;

  NEW.is_spot := (NEW.laycan_from IS NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cl_port_autofill ON public.cargo_listings;
CREATE TRIGGER trg_cl_port_autofill
  BEFORE INSERT OR UPDATE ON public.cargo_listings
  FOR EACH ROW EXECUTE FUNCTION public.fn_cl_port_autofill();

-- cargo_listings submission routing
CREATE OR REPLACE FUNCTION public.fn_submission_route_cargo()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_owner_id   UUID;
  v_tier       public.trust_tier_enum;
  v_random     BOOLEAN;
BEGIN
  SELECT lo.owner_user_id INTO v_owner_id
  FROM public.listing_ownership lo
  WHERE lo.listing_id = NEW.id AND lo.listing_type = 'cargo' AND lo.is_current = TRUE
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT trust_tier INTO v_tier FROM public.users WHERE supabase_user_id = v_owner_id;
  v_random := (RANDOM() < 0.1); 

  IF v_tier = 'VERIFIED' AND NOT v_random THEN
    UPDATE public.cargo_listings
      SET review_status = 'APPROVED', goes_live_at = NOW()
      WHERE id = NEW.id;
  ELSE
    INSERT INTO public.review_queue (listing_type, listing_id, submitted_by, trust_tier_at_submit, is_random_sample, review_reason)
    VALUES (
      'cargo', NEW.id, v_owner_id, v_tier, v_random,
      CASE
        WHEN v_tier = 'FLAGGED' THEN 'Flagged account'
        WHEN v_random THEN 'Random sample check'
        ELSE 'New user'
      END
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cl_submission_route ON public.cargo_listings;
CREATE TRIGGER trg_cl_submission_route
  AFTER INSERT ON public.cargo_listings
  FOR EACH ROW EXECUTE FUNCTION public.fn_submission_route_cargo();

-- listing_ownership close previous
CREATE OR REPLACE FUNCTION public.fn_lo_close_previous()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'primary' AND NEW.is_current = TRUE THEN
    UPDATE public.listing_ownership
      SET is_current = FALSE, owned_until = NOW()
      WHERE listing_id = NEW.listing_id
        AND listing_type = NEW.listing_type
        AND is_current = TRUE
        AND role = 'primary'
        AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lo_close_previous ON public.listing_ownership;
CREATE TRIGGER trg_lo_close_previous
  AFTER INSERT ON public.listing_ownership
  FOR EACH ROW EXECUTE FUNCTION public.fn_lo_close_previous();

-- cargo_safety_answers writeback
CREATE OR REPLACE FUNCTION public.fn_csa_matchmaking_writeback()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_col TEXT;
BEGIN
  SELECT matchmaking_column INTO v_col
  FROM public.safety_questions
  WHERE question_key = NEW.question_key AND is_matchmaking_field = TRUE;

  IF v_col IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format(
    'UPDATE public.cargo_listings SET %I = $1 WHERE id = $2',
    v_col
  ) USING
    CASE v_col
      WHEN 'requires_geared'  THEN (NEW.answer_value = 'true')::BOOLEAN
      WHEN 'max_vessel_age_yr' THEN NEW.answer_value::SMALLINT
      WHEN 'max_loa_m'        THEN NEW.answer_value::NUMERIC
      WHEN 'max_draft_m'      THEN NEW.answer_value::NUMERIC
      ELSE NEW.answer_value
    END,
    NEW.cargo_listing_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_csa_writeback ON public.cargo_safety_answers;
CREATE TRIGGER trg_csa_writeback
  AFTER INSERT OR UPDATE ON public.cargo_safety_answers
  FOR EACH ROW EXECUTE FUNCTION public.fn_csa_matchmaking_writeback();

-- review_queue triggers
DROP TRIGGER IF EXISTS trg_review_queue_updated_at ON public.review_queue;
CREATE TRIGGER trg_review_queue_updated_at
  BEFORE UPDATE ON public.review_queue
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE OR REPLACE FUNCTION public.fn_rq_on_review()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'PENDING' AND NEW.status != 'PENDING' THEN
    NEW.reviewed_at := NOW();
    IF NEW.listing_type = 'cargo' THEN
      IF NEW.status = 'APPROVED' THEN
        UPDATE public.cargo_listings
          SET review_status = 'APPROVED', goes_live_at = NOW()
          WHERE id = NEW.listing_id;
        UPDATE public.users
          SET clean_posts = clean_posts + 1
          WHERE supabase_user_id = NEW.submitted_by;
      ELSIF NEW.status IN ('REJECTED','FLAGGED') THEN
        UPDATE public.cargo_listings
          SET review_status = NEW.status
          WHERE id = NEW.listing_id;
        UPDATE public.users
          SET strike_count = strike_count + 1
          WHERE supabase_user_id = NEW.submitted_by;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rq_on_review ON public.review_queue;
CREATE TRIGGER trg_rq_on_review
  BEFORE UPDATE ON public.review_queue
  FOR EACH ROW EXECUTE FUNCTION public.fn_rq_on_review();


-- ── 3. RLS POLICIES & GRANTS ──────────────────────────────────

-- cargo_listings RLS
ALTER TABLE public.cargo_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Browse approved listings" ON public.cargo_listings;
CREATE POLICY "Browse approved listings"
  ON public.cargo_listings FOR SELECT TO anon, authenticated
  USING (review_status = 'APPROVED' AND status IN ('IN','PARTIAL'));

DROP POLICY IF EXISTS "Owners see own listings" ON public.cargo_listings;
CREATE POLICY "Owners see own listings"
  ON public.cargo_listings FOR SELECT TO authenticated
  USING (id IN (
    SELECT listing_id FROM public.listing_ownership
    WHERE owner_user_id = auth.uid() AND listing_type = 'cargo' AND is_current = TRUE
  ));

DROP POLICY IF EXISTS "Primary owner update" ON public.cargo_listings;
CREATE POLICY "Primary owner update"
  ON public.cargo_listings FOR UPDATE TO authenticated
  USING (id IN (
    SELECT listing_id FROM public.listing_ownership
    WHERE owner_user_id = auth.uid() AND listing_type = 'cargo' AND role = 'primary' AND is_current = TRUE
  ));

DROP POLICY IF EXISTS "Authenticated insert" ON public.cargo_listings;
CREATE POLICY "Authenticated insert"
  ON public.cargo_listings FOR INSERT TO anon, authenticated
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Admins full access cargo_listings" ON public.cargo_listings;
CREATE POLICY "Admins full access cargo_listings"
  ON public.cargo_listings FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE ON public.cargo_listings TO anon, authenticated;
GRANT ALL ON public.cargo_listings TO service_role;

-- listing_ownership RLS
ALTER TABLE public.listing_ownership ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own ownership" ON public.listing_ownership;
CREATE POLICY "Users see own ownership"
  ON public.listing_ownership FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "Users insert own ownership" ON public.listing_ownership;
CREATE POLICY "Users insert own ownership"
  ON public.listing_ownership FOR INSERT TO anon, authenticated
  WITH CHECK (owner_user_id = auth.uid() OR auth.uid() IS NULL);

DROP POLICY IF EXISTS "Admins full access ownership" ON public.listing_ownership;
CREATE POLICY "Admins full access ownership"
  ON public.listing_ownership FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, INSERT ON public.listing_ownership TO anon, authenticated;
GRANT ALL ON public.listing_ownership TO service_role;

-- cargo_safety_answers RLS
ALTER TABLE public.cargo_safety_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner sees own answers" ON public.cargo_safety_answers;
CREATE POLICY "Owner sees own answers"
  ON public.cargo_safety_answers FOR SELECT TO authenticated
  USING (cargo_listing_id IN (
    SELECT listing_id FROM public.listing_ownership
    WHERE owner_user_id = auth.uid() AND is_current = TRUE
  ));

DROP POLICY IF EXISTS "Owner inserts answers" ON public.cargo_safety_answers;
CREATE POLICY "Owner inserts answers"
  ON public.cargo_safety_answers FOR INSERT TO anon, authenticated
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Admins full access answers" ON public.cargo_safety_answers;
CREATE POLICY "Admins full access answers"
  ON public.cargo_safety_answers FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE ON public.cargo_safety_answers TO anon, authenticated;
GRANT ALL ON public.cargo_safety_answers TO service_role;

-- review_queue RLS
ALTER TABLE public.review_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own queue items" ON public.review_queue;
CREATE POLICY "Users see own queue items"
  ON public.review_queue FOR SELECT TO authenticated
  USING (submitted_by = auth.uid());

DROP POLICY IF EXISTS "Admins full access queue" ON public.review_queue;
CREATE POLICY "Admins full access queue"
  ON public.review_queue FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.review_queue TO authenticated;
GRANT ALL ON public.review_queue TO service_role;


-- ── 4. VIEWS ──────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_admin_queue AS
  SELECT
    rq.*,
    u.name          AS submitter_name,
    u.full_name     AS submitter_full_name,
    u.email         AS submitter_email
  FROM public.review_queue rq
  JOIN public.users u ON u.supabase_user_id = rq.submitted_by
  WHERE rq.status = 'PENDING'
  ORDER BY rq.created_at ASC;

GRANT SELECT ON public.v_admin_queue TO authenticated;