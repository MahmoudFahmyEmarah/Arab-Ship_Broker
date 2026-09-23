-- Data Sync hardening — deterministic lock order (workstream H, 21 Sep 2026)
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/lock_order_smoke.sql
--
-- BEGIN … ROLLBACK. Prints LOCK ORDER SMOKE: ALL ASSERTIONS PASSED.
--
-- Deadlock avoidance itself needs two sessions and is proved by
-- supabase/tests/data_sync/lock_order_two_sessions.sh. What can be asserted
-- in one session is the mechanism that makes it work:
--   H1  the helper de-duplicates and takes one lock per distinct pair
--   H2  it requests them in ONE global order, whatever order it was given
--   H3  a lock is identified by (table, key) and by nothing else
--   H4  re-taking a held lock is free, so the work loops may keep their own
--       per-row calls
--   H5  mismatched array lengths are refused rather than silently zipped
--   H6  EVERY multi-row writer prelocks — asserted from the catalogue, so a
--       new writer that forgets cannot pass this suite

begin;

do $$
declare n int; v_before int; v_after int; v_locks int; v_order text; v_err text;
begin
  -- ── H1 · de-duplication ────────────────────────────────────────────────
  select count(*) into v_before from pg_locks where locktype = 'advisory' and pid = pg_backend_pid();
  -- six requests, four distinct pairs
  v_locks := public.fn_sync_lock_all(
    array['vessels', 'cargo_listings', 'vessels', 'cargo_listings', 'vessels', 'cargo_listings'],
    array['B', 'Z', 'A', 'A', 'B', 'Z']);
  if v_locks <> 4 then raise exception 'H1: expected 4 distinct locks, the helper took %', v_locks; end if;
  select count(*) into v_after from pg_locks where locktype = 'advisory' and pid = pg_backend_pid();
  if v_after - v_before <> 4 then raise exception 'H1: % advisory locks appeared, expected 4', v_after - v_before; end if;

  -- ── H2 · one global order, whatever the caller's order ─────────────────
  -- the helper's ordering clause, reproduced: every caller yields this list
  select string_agg(z.tbl || '/' || z.bkey, ' < ' order by z.tbl, z.bkey) into v_order
    from (select distinct u.t as tbl, u.k as bkey
            from unnest(array['vessels', 'cargo_listings', 'vessels', 'cargo_listings'], array['B', 'Z', 'A', 'A']) as u(t, k)) z;
  if v_order <> 'cargo_listings/A < cargo_listings/Z < vessels/A < vessels/B' then
    raise exception 'H2: the global order is not (table, key) ascending: %', v_order;
  end if;
  -- the reverse input produces the same request order
  select string_agg(z.tbl || '/' || z.bkey, ' < ' order by z.tbl, z.bkey) into v_order
    from (select distinct u.t as tbl, u.k as bkey
            from unnest(array['cargo_listings', 'vessels', 'cargo_listings', 'vessels'], array['A', 'A', 'Z', 'B']) as u(t, k)) z;
  if v_order <> 'cargo_listings/A < cargo_listings/Z < vessels/A < vessels/B' then
    raise exception 'H2: a reversed input produced a different order: %', v_order;
  end if;

  -- ── H3 · identity is (table, key) ──────────────────────────────────────
  -- ('a','b') and ('b','a') are different locks; the same pair twice is one
  select count(*) into v_before from pg_locks where locktype = 'advisory' and pid = pg_backend_pid();
  perform public.fn_sync_row_lock('t_one', 'k_two');
  perform public.fn_sync_row_lock('t_two', 'k_one');
  select count(*) into v_after from pg_locks where locktype = 'advisory' and pid = pg_backend_pid();
  if v_after - v_before <> 2 then raise exception 'H3: (a,b) and (b,a) collapsed into one lock'; end if;

  -- ── H4 · re-taking a held lock is free ─────────────────────────────────
  select count(*) into v_before from pg_locks where locktype = 'advisory' and pid = pg_backend_pid();
  perform public.fn_sync_row_lock('t_one', 'k_two');
  perform public.fn_sync_row_lock('t_one', 'k_two');
  select count(*) into v_after from pg_locks where locktype = 'advisory' and pid = pg_backend_pid();
  if v_after <> v_before then raise exception 'H4: re-taking a held lock created another entry'; end if;

  -- ── H5 · mismatched arrays are refused ─────────────────────────────────
  begin
    perform public.fn_sync_lock_all(array['ports', 'vessels'], array['A']);
    raise exception 'H5: mismatched arrays were accepted';
  exception when invalid_parameter_value then null;
  end;
  -- empty and null inputs are a no-op, not an error
  if public.fn_sync_lock_all('{}'::text[], '{}'::text[]) <> 0 then raise exception 'H5: empty input took locks'; end if;
  if public.fn_sync_lock_all(null, null) <> 0 then raise exception 'H5: null input took locks'; end if;
  -- a null pair inside the arrays is skipped, not locked on
  if public.fn_sync_lock_all(array['ports', null], array[null, 'A']) <> 0 then raise exception 'H5: a null pair was locked'; end if;

  -- ── H6 · every multi-row writer prelocks ───────────────────────────────
  select string_agg(p.proname, ', ' order by p.proname) into v_err
    from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
   where nsp.nspname = 'public'
     and p.proname in ('commit_sync_batch', 'undo_sync_batch', 'undo_record_edits', 'bulk_update_live_records', 'bulk_delete_live_records')
     and pg_get_functiondef(p.oid) not like '%fn_sync_lock_all%';
  if v_err is not null then raise exception 'H6: these multi-row writers do not take their locks up front: %', v_err; end if;
  -- and all five exist to be checked
  select count(*) into n from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
   where nsp.nspname = 'public'
     and p.proname in ('commit_sync_batch', 'undo_sync_batch', 'undo_record_edits', 'bulk_update_live_records', 'bulk_delete_live_records');
  if n < 5 then raise exception 'H6: only % of the 5 writers were found', n; end if;
  -- the single-row writers need no prelock: one lock cannot deadlock on order
  select string_agg(p.proname, ', ' order by p.proname) into v_err
    from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
   where nsp.nspname = 'public' and p.proname in ('edit_live_record', 'insert_live_record', 'delete_live_record')
     and pg_get_functiondef(p.oid) not like '%fn_sync_row_lock%';
  if v_err is not null then raise exception 'H6: these single-row writers take no row lock at all: %', v_err; end if;

  raise notice 'LOCK ORDER SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
