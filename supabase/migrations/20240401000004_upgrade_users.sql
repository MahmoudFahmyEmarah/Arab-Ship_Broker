-- ── 1. Add missing columns ────────────────────────────────────

-- full_name: populate from existing name column, then we keep both
-- temporarily for zero-downtime. Drop name in migration 005 once
-- all code references full_name.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS full_name TEXT;

UPDATE public.users SET full_name = name WHERE full_name IS NULL;

ALTER TABLE public.users
  ALTER COLUMN full_name SET NOT NULL,
  ALTER COLUMN full_name SET DEFAULT '';

-- is_active: rename from active
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.users SET is_active = active WHERE TRUE;

-- company and phone (nullable — PII, encrypted at app layer)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS phone   TEXT;

-- clean_posts and strike_count for trust tier progression
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS clean_posts   SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS strike_count  SMALLINT NOT NULL DEFAULT 0;

-- ── 2. Trust tier enum + column ──────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.trust_tier_enum AS ENUM ('NEW', 'VERIFIED', 'FLAGGED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS trust_tier public.trust_tier_enum NOT NULL DEFAULT 'NEW';

-- Existing users who already have access_tier = 'member' are promoted to VERIFIED
UPDATE public.users
  SET trust_tier = 'VERIFIED'
  WHERE access_tier = 'member';

-- ── 3. Drop legacy access tier columns ───────────────────────
-- access_tier, access_granted_by, access_granted_at are replaced by trust_tier.
-- We must drop the dependent view first, drop the columns, then recreate the view.

DROP VIEW IF EXISTS public.cargos_access_view;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS access_tier,
  DROP COLUMN IF EXISTS access_granted_by,
  DROP COLUMN IF EXISTS access_granted_at;

-- ⚠️ ACTION REQUIRED: RECREATE YOUR VIEW HERE ⚠️
-- You must paste your original CREATE VIEW statement for cargos_access_view below,
-- replacing any references to 'access_tier' with 'trust_tier'.
-- Example format:
-- CREATE OR REPLACE VIEW public.cargos_access_view AS
--   SELECT c.*, u.trust_tier 
--   FROM public.cargos c
--   JOIN public.users u ON ...;


-- ── 4. Updated_at trigger ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ── 5. Trust tier auto-upgrade trigger ───────────────────────
-- When clean_posts reaches 5 → auto-upgrade NEW → VERIFIED.
-- When strike_count reaches 2 → auto-downgrade VERIFIED → FLAGGED.

CREATE OR REPLACE FUNCTION public.fn_users_auto_upgrade()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.clean_posts >= 5 AND NEW.trust_tier = 'NEW' THEN
    NEW.trust_tier := 'VERIFIED';
  END IF;
  IF NEW.strike_count >= 2 AND NEW.trust_tier = 'VERIFIED' THEN
    NEW.trust_tier := 'FLAGGED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_auto_upgrade ON public.users;
CREATE TRIGGER trg_users_auto_upgrade
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_users_auto_upgrade();

-- ── 6. Update is_admin() to use supabase_user_id (already correct) ──

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE supabase_user_id = auth.uid() AND role = 'admin'
  );
$$;

-- ── 7. Update RLS policies ────────────────────────────────────
-- Policies already use supabase_user_id = auth.uid() — correct, no change needed.
-- Add admin read-all policy that was previously commented out.

DROP POLICY IF EXISTS "Admins can view all users" ON public.users;
CREATE POLICY "Admins can view all users"
  ON public.users FOR SELECT TO authenticated
  USING (public.is_admin());