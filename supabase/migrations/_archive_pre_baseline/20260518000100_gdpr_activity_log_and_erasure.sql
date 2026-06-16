-- ── 1. user_activity_log ──────────────────────────────────────────────────────
-- Append-only. Rows are NEVER updated or deleted.
-- RLS: users can read their own log; service_role writes.

CREATE TABLE IF NOT EXISTS public.user_activity_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  -- We keep supabase_user_id separately for the case where the users row
  -- is anonymized but we still need to know which Auth user generated the event
  supabase_user_id UUID,
  event_type   TEXT NOT NULL,
  -- e.g. 'cargo_posted', 'vessel_registered', 'availability_posted',
  --      'login', 'profile_updated', 'data_exported', 'account_deleted_request'
  entity_type  TEXT,   -- 'cargo_listing' | 'vessel' | 'vessel_availability' | null
  entity_id    UUID,   -- FK to the related record (not enforced — audit log)
  metadata     JSONB,  -- any additional context (e.g. zone, commodity_name)
  ip_address   INET,   -- populated by the app layer, not the DB
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partitioning hint: this table will grow — consider range partition by year
-- once it reaches millions of rows.

CREATE INDEX IF NOT EXISTS idx_ual_user_id
  ON public.user_activity_log (user_id);
CREATE INDEX IF NOT EXISTS idx_ual_supabase_user_id
  ON public.user_activity_log (supabase_user_id);
CREATE INDEX IF NOT EXISTS idx_ual_event_type
  ON public.user_activity_log (event_type);
CREATE INDEX IF NOT EXISTS idx_ual_created_at
  ON public.user_activity_log (created_at DESC);

ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;

-- Users can only read their own log
DROP POLICY IF EXISTS "Users read own activity log" ON public.user_activity_log;
CREATE POLICY "Users read own activity log"
  ON public.user_activity_log FOR SELECT TO authenticated
  USING (
    supabase_user_id = auth.uid()
  );

-- Only service_role and admins can insert
DROP POLICY IF EXISTS "Admin full access activity log" ON public.user_activity_log;
CREATE POLICY "Admin full access activity log"
  ON public.user_activity_log FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.user_activity_log TO authenticated;
GRANT ALL ON public.user_activity_log TO service_role;

COMMENT ON TABLE public.user_activity_log IS
  'Append-only GDPR audit trail. Never update or delete rows.';


-- ── 2. get_my_data_export ────────────────────────────────────────────────────
-- Art. 15 — Right of Access + Data Portability
-- Returns all data held about the authenticated user as a single JSONB object.
-- The app layer can stream this to the user as a JSON download.

CREATE OR REPLACE FUNCTION public.get_my_data_export()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID;
  v_account_id UUID;
  v_result     JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO v_account_id
  FROM public.users
  WHERE supabase_user_id = v_user_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'User record not found';
  END IF;

  SELECT jsonb_build_object(
    'export_generated_at', NOW(),
    'data_controller',     'Arab ShipBroker',
    'gdpr_basis',          'Art. 15 — Right of Access',

    -- Core identity
    'account', (
      SELECT row_to_json(u)
      FROM (
        SELECT id, full_name, email, role, trust_tier,
               clean_posts, strike_count, is_active, created_at
        FROM public.users
        WHERE id = v_account_id
      ) u
    ),

    -- Profiles (cargo / vessel)
    'profiles', (
      SELECT json_agg(row_to_json(p))
      FROM (
        SELECT profile_type, display_name, company, phone,
               is_active, created_at
        FROM public.profiles
        WHERE account_id = v_account_id
      ) p
    ),

    -- Cargo listings owned
    'cargo_listings', (
      SELECT json_agg(row_to_json(cl))
      FROM (
        SELECT c.id, c.ref, c.commodity_name, c.cargo_type,
               c.qty_min_mt, c.qty_max_mt, c.load_port_name,
               c.disch_port_name, c.laycan_from, c.laycan_to,
               c.status, c.review_status, c.created_at
        FROM public.cargo_listings c
        JOIN public.listing_ownership lo
          ON lo.listing_id = c.id
         AND lo.listing_type = 'cargo'
         AND lo.owner_user_id = v_user_id
         AND lo.is_current = TRUE
      ) cl
    ),

    -- Vessel claims (vessels the user has registered)
    'vessel_claims', (
      SELECT json_agg(row_to_json(vc))
      FROM (
        SELECT v.vessel_name, v.imo_number, v.vessel_type,
               v.dwt_grain, vc.role, vc.created_at
        FROM public.vessel_claims vc
        JOIN public.vessels v ON v.id = vc.vessel_id
        WHERE vc.user_id = v_user_id
      ) vc
    ),

    -- Vessel availability postings
    'vessel_availability', (
      SELECT json_agg(row_to_json(va))
      FROM (
        SELECT a.id, a.open_port_name, a.open_zone, a.open_date,
               a.status, a.review_status, a.created_at,
               v.vessel_name
        FROM public.vessel_availability a
        JOIN public.listing_ownership lo
          ON lo.listing_id = a.id
         AND lo.listing_type = 'vessel_availability'
         AND lo.owner_user_id = v_user_id
         AND lo.is_current = TRUE
        JOIN public.vessels v ON v.id = a.vessel_id
      ) va
    ),

    -- Review queue history (submissions)
    'review_history', (
      SELECT json_agg(row_to_json(rq))
      FROM (
        SELECT listing_type, listing_id, status, review_reason,
               trust_tier_at_submit, created_at, reviewed_at
        FROM public.review_queue
        WHERE submitted_by = v_user_id
        ORDER BY created_at DESC
      ) rq
    ),

    -- Activity log
    'activity_log', (
      SELECT json_agg(row_to_json(al))
      FROM (
        SELECT event_type, entity_type, entity_id,
               metadata, created_at
        FROM public.user_activity_log
        WHERE supabase_user_id = v_user_id
        ORDER BY created_at DESC
        LIMIT 1000
      ) al
    )
  ) INTO v_result;

  -- Log the export event itself
  INSERT INTO public.user_activity_log
    (user_id, supabase_user_id, event_type, metadata)
  VALUES
    (v_account_id, v_user_id, 'data_exported',
     jsonb_build_object('source', 'self_service'));

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_data_export() TO authenticated;
COMMENT ON FUNCTION public.get_my_data_export() IS
  'GDPR Art. 15 — Returns all user data as a JSON export. Logs the export event.';


-- ── 3. anonymize_user ────────────────────────────────────────────────────────
-- Art. 17 — Right to Erasure
-- Anonymizes PII in the users and profiles tables.
-- Transaction records (listings, reviews, ownership) are RETAINED
-- but their connection to the individual is broken.
-- The Supabase Auth user must be deleted separately (admin action or
-- via supabase.auth.admin.deleteUser in an API route after this runs).
--
-- Only callable by:
--   - The user themselves (supabase_user_id = auth.uid())
--   - Admins (is_admin() = true)

CREATE OR REPLACE FUNCTION public.anonymize_user(p_supabase_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_caller     UUID := auth.uid();
BEGIN
  -- Authorization: must be the user themselves or an admin
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_caller != p_supabase_user_id AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to anonymize this account';
  END IF;

  SELECT id INTO v_account_id
  FROM public.users
  WHERE supabase_user_id = p_supabase_user_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Log the deletion request BEFORE anonymization
  INSERT INTO public.user_activity_log
    (user_id, supabase_user_id, event_type, metadata)
  VALUES
    (v_account_id, p_supabase_user_id, 'account_anonymized',
     jsonb_build_object(
       'requested_by', CASE WHEN v_caller = p_supabase_user_id
                            THEN 'self' ELSE 'admin' END,
       'anonymized_at', NOW()
     ));

  -- Nullify PII on users table
  UPDATE public.users
  SET
    full_name    = '[Anonymized]',
    email        = concat('anonymized_', v_account_id, '@deleted.arabshipbroker.com'),
    is_active    = FALSE
  WHERE id = v_account_id;

  -- Nullify PII on profiles table
  UPDATE public.profiles
  SET
    display_name = NULL,
    company      = NULL,
    phone        = NULL,
    notes        = NULL,
    is_active    = FALSE
  WHERE account_id = v_account_id;

  -- Nullify PII on vessel_contacts (person in charge entries)
  UPDATE public.vessel_contacts
  SET
    name  = '[Anonymized]',
    email = NULL,
    phone = NULL
  WHERE vessel_id IN (
    SELECT vessel_id FROM public.vessel_claims WHERE user_id = p_supabase_user_id
  );

  -- NOTE: listing_ownership, review_queue, cargo_listings,
  --       vessel_availability, vessel_claims are RETAINED.
  --       They are statistical records needed for platform integrity.
  --       Their link to a named individual is broken by the anonymization above.

END;
$$;

-- Only authenticated users (for self-service) and service_role (for admin API)
GRANT EXECUTE ON FUNCTION public.anonymize_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_user(UUID) TO service_role;

COMMENT ON FUNCTION public.anonymize_user(UUID) IS
  'GDPR Art. 17 — Anonymizes PII for a user. Retains statistical/transaction records. '
  'The Supabase Auth record must be separately deleted after calling this.';