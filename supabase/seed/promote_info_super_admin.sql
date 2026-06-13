-- ════════════════════════════════════════════════════════════════════
-- Promote info@arabshipbroker.com to SUPERIOR admin · run once · idempotent
--
-- "Superior admin" = role 'admin' (passes is_admin / all admin gates) AND
-- admin_tier 'super' (full access, no per-section perm scoping; sub-admins
-- are the scoped ones). The earlier script set role only; this also sets the
-- tier. Column-safe: optional columns are set only if they exist on this DB.
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE e text := 'info@arabshipbroker.com';
  has bool;
BEGIN
  UPDATE public.users SET role = 'admin' WHERE lower(email) = e;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='admin_tier') INTO has;
  IF has THEN UPDATE public.users SET admin_tier = 'super' WHERE lower(email) = e; END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='admin_perms') INTO has;
  IF has THEN UPDATE public.users SET admin_perms = NULL WHERE lower(email) = e; END IF;  -- super needs no scoping

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='trust_tier') INTO has;
  IF has THEN UPDATE public.users SET trust_tier = 'VERIFIED' WHERE lower(email) = e; END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='subscription_tier') INTO has;
  IF has THEN UPDATE public.users SET subscription_tier = 'T4' WHERE lower(email) = e; END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='is_active') INTO has;
  IF has THEN UPDATE public.users SET is_active = TRUE WHERE lower(email) = e; END IF;
END $$;

-- Make sure the login is usable.
UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW())
WHERE lower(email) = 'info@arabshipbroker.com';

-- Verify (expect: admin / super / VERIFIED):
SELECT email, role, admin_tier, trust_tier
FROM public.users WHERE lower(email) = 'info@arabshipbroker.com';
