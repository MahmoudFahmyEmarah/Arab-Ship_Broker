-- ════════════════════════════════════════════════════════════════════
-- Sub-admin authorization model · append-only (design admin-roles.js)
--
-- Superior Admin ('super') + permission-scoped sub-admins ('sub').
-- Sub-admins keep user_role 'admin' so every existing RLS admin policy
-- works unchanged; the per-section view/edit authorization is enforced at
-- the app layer (nav filtering, page bounce, action edit-checks) exactly
-- per the design ("Enforced at the data/role layer (nav filtering, page
-- rendering, and a bounce)"). Owner-only sections (ETA, Admins) are never
-- exposed to subs regardless of perms.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS admin_tier text
    CHECK (admin_tier IS NULL OR admin_tier IN ('super','sub')),
  ADD COLUMN IF NOT EXISTS admin_perms jsonb;

-- Every existing admin predates the sub model — they are the owner(s).
UPDATE public.users SET admin_tier = 'super'
WHERE role = 'admin' AND admin_tier IS NULL;

-- Each admin can read their own tier/perms (the sidebar filters with it).
GRANT SELECT (admin_tier, admin_perms) ON public.users TO authenticated;
