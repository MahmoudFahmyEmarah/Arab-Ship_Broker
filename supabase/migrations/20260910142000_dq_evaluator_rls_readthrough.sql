-- ════════════════════════════════════════════════════════════════════════
-- dq_evaluator: read-through that actually reaches every row
--
-- Two things stood between the evaluator role and a full read of the market
-- tables, found while verifying 20260910140000:
--
-- 1 · fn_is_admin() is a plain SQL function whose body calls auth.jwt().
--     The planner INLINES it while planning any policy that names it, and
--     inlining parses the body as the calling role — dq_evaluator has no
--     USAGE on schema auth (postgres cannot grant it; the schema belongs to
--     supabase_auth_admin), so planning failed with "permission denied for
--     schema auth" before the evaluator's own permissive policy could apply.
--     SECURITY DEFINER stops the inlining and runs the body as the owner.
--     Its sibling is_admin() already was. Behaviour for every other caller is
--     unchanged: auth.jwt() reads the request claims regardless of role.
--
-- 2 · cargo_listings and vessel_availability carry a RESTRICTIVE policy
--     ("freshness horizon", to public) — restrictive policies AND with the
--     permissive ones, so the evaluator saw only the fresh 224 of 1,833
--     listings. A batch audit must see the whole table. The clause added
--     below applies only to that role: dq_evaluator is NOLOGIN and is only
--     ever the current user inside the fn_dq_eval_* functions.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

alter function public.fn_is_admin() security definer;
alter function public.fn_is_admin() set search_path = '';

alter policy "cl: freshness horizon" on public.cargo_listings
  using (current_user = 'dq_evaluator'
         or public.fn_market_fresh_ok(id, 'cargo'::listing_type_enum, refreshed_at, laycan_to));

alter policy "va: freshness horizon" on public.vessel_availability
  using (current_user = 'dq_evaluator'
         or public.fn_market_fresh_ok(id, 'vessel_availability'::listing_type_enum, refreshed_at, open_date));
