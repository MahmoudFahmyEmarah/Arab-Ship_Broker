-- ════════════════════════════════════════════════════════════════════
-- Promote info@arabshipbroker.com to full (superior) admin
--
-- 'admin' is the platform's highest authority: it satisfies is_admin() /
-- fn_is_admin() (all RLS admin policies, the contact-firewall admin views)
-- and the /admin/* route gate (requireAdmin). This also lifts every account
-- flag to maximum: VERIFIED trust tier (listings go live without review),
-- T4 Partner subscription tier (all gated features), active.
--
-- RUN: Supabase SQL editor (as owner/service role). Idempotent.
-- ════════════════════════════════════════════════════════════════════

UPDATE public.users
SET role              = 'admin',
    trust_tier        = 'VERIFIED',
    subscription_tier = 'T4',
    is_active         = TRUE
WHERE lower(email) = 'info@arabshipbroker.com';

-- Make sure the login is usable: confirm the email if it never was.
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, NOW())
WHERE lower(email) = 'info@arabshipbroker.com';

-- Verify (expect one row: admin / VERIFIED / T4 / t):
SELECT email, role, trust_tier, subscription_tier, is_active
FROM public.users
WHERE lower(email) = 'info@arabshipbroker.com';
