-- ════════════════════════════════════════════════════════════════════
-- Align public.users.supabase_user_id with the REAL auth.users id · run once
--
-- The foundation backfill set supabase_user_id = users.id for rows where it was
-- NULL, assuming legacy rows had id = auth.uid(). For accounts where that isn't
-- true (e.g. info@), the strict is_admin() / get_admin_stats() check
-- (supabase_user_id = auth.uid()) fails, so the admin dashboard shows all zeros
-- even though requireAdmin lets you in. This re-points supabase_user_id to the
-- real Supabase Auth id, matched by email (unique on both sides). Idempotent.
-- ════════════════════════════════════════════════════════════════════
UPDATE public.users u
SET supabase_user_id = au.id
FROM auth.users au
WHERE lower(u.email) = lower(au.email)
  AND u.supabase_user_id IS DISTINCT FROM au.id;

-- Verify the admin is now correctly aligned (expect aligned = t):
SELECT u.email,
       (u.supabase_user_id = au.id) AS aligned,
       u.role, u.admin_tier
FROM public.users u
JOIN auth.users au ON lower(au.email) = lower(u.email)
WHERE lower(u.email) = 'info@arabshipbroker.com';

-- And confirm the dashboard source now returns real counts (run as the SQL
-- editor owner this returns the raw counts regardless of is_admin):
SELECT
  (SELECT count(*) FROM public.cargo_listings WHERE status IN ('IN','PARTIAL') AND review_status='APPROVED') AS cargo_live,
  (SELECT count(*) FROM public.vessel_availability WHERE status='OPEN' AND review_status='APPROVED')          AS vessels_open,
  (SELECT count(*) FROM public.users WHERE role <> 'admin')                                                  AS users_total;
