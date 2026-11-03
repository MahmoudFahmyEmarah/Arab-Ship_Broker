-- ════════════════════════════════════════════════════════════════════════
-- Data Sync LLM keys · drop the retired unconditional switch (Wave 11, owner 3 Nov 2026)
--
-- 20261029100000 retired public.set_active_llm_credential(uuid): its body refuses (42501) and no role may execute
-- it, and the app has activated keys only through set_active_llm_credential_if_unchanged (version-bound, after a
-- passing provider test) since the Wave 10 app went live on 3 Nov 2026. Nothing calls the retired switch any more,
-- so it is dropped: there is no unconditional activation path left in the database at all.
-- Plain SQL. DOWN: supabase/rollback/20261103100000_drop_retired_llm_switch_down.sql (recreates the refusing
-- function exactly as production holds it, with no grant).
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

drop function if exists public.set_active_llm_credential(uuid);
