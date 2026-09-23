-- DOWN for 20260919180000_dq_i_restricted_paths.sql (21 Sep 2026)
--
-- Both objects are new in that migration, so the reverse is a clean drop: the
-- schema returns byte-for-byte to its pre-I state, which the harness proves by
-- comparing schema fingerprints either side of the chain.
--
-- Rolling this back restores the signup path's freedom to insert an
-- organisation row with any column it likes, because the restriction lives in
-- the function signature. The application must be rolled back with it — see
-- docs/data-quality-production-readiness.md, "rollback order".

drop function if exists public.fn_dq_signup_create_org(text, text, text);
drop function if exists public.fn_dq_member_write_probe(text);
