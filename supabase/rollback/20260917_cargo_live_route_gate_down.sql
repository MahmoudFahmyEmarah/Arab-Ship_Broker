-- ════════════════════════════════════════════════════════════════════════
-- DOWN for 20260917120000_cargo_live_route_gate.sql
--         and 20260917130000_cargo_live_routable_ck.sql   (17 Sep 2026)
--
-- Removes everything the two migrations added and restores the one row they
-- edited. Written BEFORE the migrations were pushed, from the live state.
-- Idempotent. Run as the database owner:
--
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260917_cargo_live_route_gate_down.sql
--   supabase migration repair --status reverted 20260917120000 20260917130000
--
-- Then, if you also want the bookkeeping repair of 17 Sep undone (it changed
-- no schema, only which timestamps the server lists as applied):
--   supabase migration repair --status applied  20260910163839 20260912091904 20260912092620 20260912095125
--   supabase migration repair --status reverted 20260910170000 20260912120000 20260912121000 20260912130000
--
-- Nothing here touches cargo data except the last, commented block.
-- ════════════════════════════════════════════════════════════════════════

-- 20260917130000 — the table constraint
alter table public.cargo_listings drop constraint if exists cargo_listings_live_routable_ck;

-- 20260917120000 — triggers
drop trigger if exists trg_cl_zy_live_route_gate on public.cargo_listings;
drop trigger if exists trg_cl_zz_dq_gate         on public.cargo_listings;
drop trigger if exists trg_va_zz_dq_gate         on public.vessel_availability;
drop trigger if exists trg_vessels_zz_dq_gate    on public.vessels;

-- 20260917120000 — functions (the helper last: the constraint above used it)
drop function if exists public.fn_cl_live_route_gate();
drop function if exists public.fn_dq_forms_gate();
drop function if exists public.fn_cl_effective_locode(text, text, text);

-- 20260917120000 — foreign keys on the reference columns
alter table public.cargo_listings drop constraint if exists cargo_listings_load_ref_locode_fkey;
alter table public.cargo_listings drop constraint if exists cargo_listings_disch_ref_locode_fkey;

-- 20260917120000 — the settings switch
alter table public.dq_settings drop column if exists gate_forms_enforce;

-- 20260917120000 — DQ-C05 wording, as captured from the live row on 17 Sep
update public.dq_rules
   set description = 'A cargo the members can see must resolve to a port on each side — its own LOCODE, or the reference port of the area it names. Otherwise the market card can show no distance, no Voy OPEX and no Ports DA.',
       updated_at = now()
 where code = 'DQ-C05';

-- ── Data: EM-5C764B40 was set IN → OUT on 17 Sep 2026 14:00 UTC (owner's
-- request, laycan closed 31 Aug). To put it back on the market, run this
-- AFTER the blocks above — while the gate is installed the update is refused,
-- because the row's discharge side ("Israel") has no reference port.
-- update public.cargo_listings set status = 'IN' where ref = 'EM-5C764B40' and status = 'OUT';
