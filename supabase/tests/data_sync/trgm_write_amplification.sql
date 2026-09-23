-- Data Sync hardening — write amplification of the phase-5 trigram indexes
-- (P2, 20 Sep 2026). BEGIN … ROLLBACK: nothing persists.
--
-- Inserts 15,000 synthetic ports rows twice: with the table's three trigram
-- indexes present, then with them dropped (inside the transaction), and
-- reports the two timings and the index sizes. Triggers are switched off for
-- the copy (replica role) so only index maintenance is measured.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/trgm_write_amplification.sql

begin;
set local session_replication_role = replica;
do $$
declare t0 timestamptz; v_with int; v_without int; v_sizes text; n int := 15000;
begin
  if exists (select 1 from public.ports where locode like 'ZW%') then raise exception 'ports ZW* exist — pick another test prefix'; end if;
  select string_agg(indexname || '=' || pg_size_pretty(pg_relation_size(('public.' || indexname)::regclass)), ', ') into v_sizes
    from pg_indexes where schemaname = 'public' and tablename = 'ports' and indexname like 'idx_trgm_ports_%';

  t0 := clock_timestamp();
  insert into public.ports (locode, trade_name, country, zone)
  select 'ZW' || chr(65 + (g / 676) % 26) || chr(65 + (g / 26) % 26) || chr(65 + g % 26), 'Amplify ' || md5(g::text), 'Country ' || (g % 50), 'E.MED' from generate_series(1, n) g;
  v_with := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  delete from public.ports where locode like 'ZW%';

  drop index if exists public.idx_trgm_ports_locode, public.idx_trgm_ports_trade_name, public.idx_trgm_ports_country;
  t0 := clock_timestamp();
  insert into public.ports (locode, trade_name, country, zone)
  select 'ZW' || chr(65 + (g / 676) % 26) || chr(65 + (g / 26) % 26) || chr(65 + g % 26), 'Amplify ' || md5(g::text), 'Country ' || (g % 50), 'E.MED' from generate_series(1, n) g;
  v_without := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;

  raise notice 'trgm write amplification: % rows — with indexes % ms, without % ms (×%) · sizes before: %', n, v_with, v_without, round(v_with::numeric / greatest(v_without, 1), 2), v_sizes;
  raise exception using message = format('TRGM WRITE AMPLIFICATION (rolled back): {"rows": %s, "with_ms": %s, "without_ms": %s, "sizes": "%s"}', n, v_with, v_without, v_sizes), errcode = 'P0001';
end $$;
rollback;
