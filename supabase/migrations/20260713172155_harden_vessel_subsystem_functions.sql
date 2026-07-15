-- Advisor hygiene for the Phase 1/2 vessel-subsystem additions. No behavior
-- change (auth.uid() is null for anon, so fn_is_vessel_owner only ever returned
-- false for anon anyway); this just satisfies the security linter.
--   • fn_is_vessel_owner: remove anon execute (kept via Supabase default privs),
--     keep authenticated (RLS / masking view call it) + service_role.
--   • pin search_path on the two trigger functions.
REVOKE EXECUTE ON FUNCTION public.fn_is_vessel_owner(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_is_vessel_owner(uuid) TO authenticated, service_role;

ALTER FUNCTION public.fn_generate_va_ref()  SET search_path = public;
ALTER FUNCTION public.fn_va_port_autofill() SET search_path = public;
