-- Data Quality · workstream A smoke test (19 Sep 2026)
-- for 20260919100000_dq_a_evaluator_boundary.sql.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/data_quality/dq_a_boundary_smoke.sql
--   (or scripts/sql-dryrun.sh <migration> <this file> to test both in one rolled-back transaction)
--
-- BEGIN … ROLLBACK. Run as the database owner.

begin;

-- ── S1 · the evaluator reads the registered tables and lookups, nothing else ─
do $$
declare n bigint; v_denied boolean := false;
begin
  set local role dq_evaluator;
  select count(*) into n from public.cargo_listings;           -- registered
  select count(*) into n from public.port_areas;               -- lookup
  begin
    select count(*) into n from public.users;                  -- confidential
  exception when insufficient_privilege then v_denied := true;
  end;
  reset role;
  if not v_denied then raise exception 'S1: the evaluator can still read public.users'; end if;
  raise notice 'S1 ok: registered and lookup tables readable, users refused';
end $$;

-- ── S2 · every existing rule still compiles through the evaluator ───────────
do $$
declare r record; c jsonb; v_key text; n int := 0;
begin
  for r in select id, code, checks from public.dq_rules where deleted_at is null and enabled loop
    for c in select x from jsonb_array_elements(coalesce(r.checks, '[]'::jsonb)) x loop
      select key_column into v_key from public.dq_tables where table_name = c->>'table';
      if v_key is null then continue; end if;
      begin
        if coalesce(c->>'query_sql', '') <> '' then
          perform public.fn_dq_assert_relations_allowed(format('select q.%I::text from (%s) q', v_key, c->>'query_sql'), r.code);
        elsif coalesce(c->>'violation_sql', '') <> '' then
          perform public.fn_dq_assert_relations_allowed(format('select 1 from public.%I r where (%s)', c->>'table', c->>'violation_sql'), r.code);
        end if;
        n := n + 1;
      exception when others then
        raise exception 'S2: rule % on % no longer compiles under the allowlist: %', r.code, c->>'table', sqlerrm;
      end;
    end loop;
  end loop;
  raise notice 'S2 ok: % checks compile as the evaluator', n;
end $$;

-- ── S3 · a rule that reads a confidential table is refused at save ──────────
do $$
declare v_err text; v_ok boolean := false;
begin
  begin
    perform public.dq_save_rule(jsonb_build_object(
      'name', 'SMOKE leak', 'severity', 'warn', 'kind', 'declarative', 'tables', jsonb_build_array('cargo_listings'),
      'checks', jsonb_build_array(jsonb_build_object('table', 'cargo_listings', 'field', 'ref',
        'violation_sql', 'exists (select 1 from public.users u where u.id::text = r.broker)'))), null, 'smoke', 'smoke');
  exception when others then
    v_err := sqlerrm; v_ok := true;
  end;
  if not v_ok then raise exception 'S3: a rule reading public.users was saved'; end if;
  if v_err not like '%may not see%' and v_err not like '%not a registered table%' then raise exception 'S3: wrong refusal message: %', v_err; end if;
  raise notice 'S3 ok: refused — %', left(v_err, 90);
end $$;

-- ── S4 · a legitimate rule saves, and names the relations it reads ─────────
do $$
declare v jsonb; v_rels text[];
begin
  v := public.dq_save_rule(jsonb_build_object(
      'name', 'SMOKE fine', 'severity', 'info', 'kind', 'declarative', 'tables', jsonb_build_array('cargo_listings'),
      'checks', jsonb_build_array(jsonb_build_object('table', 'cargo_listings', 'field', 'load_port_locode',
        'violation_sql', 'r.load_port_locode is not null and not exists (select 1 from public.ports p where p.locode = r.load_port_locode)'))), null, 'smoke', 'smoke');
  if v->>'code' not like 'DQ-N%' then raise exception 'S4: expected a new DQ-N code, got %', v->>'code'; end if;
  v_rels := public.fn_dq_assert_relations_allowed('select 1 from public.cargo_listings r where exists (select 1 from public.ports p where p.locode = r.load_port_locode)', 'probe');
  if not ('cargo_listings' = any (v_rels) and 'ports' = any (v_rels)) then raise exception 'S4: plan relations wrong: %', v_rels; end if;
  raise notice 'S4 ok: saved % reading %', v->>'code', v_rels;
end $$;

-- ── S5 · sync is idempotent and a new allowlist entry takes effect ──────────
do $$
declare a jsonb; b jsonb; n bigint; v_ok boolean := false;
begin
  a := public.fn_dq_evaluator_sync_grants();
  b := public.fn_dq_evaluator_sync_grants();
  if (b->>'revoked')::int <> 0 then raise exception 'S5: second sync revoked again: %', b; end if;
  -- an allowlist entry grants at once...
  if has_table_privilege('dq_evaluator', 'public.users', 'SELECT') then
    raise exception 'S5: dq_evaluator could already read public.users before the allowlist entry';
  end if;
  insert into public.dq_evaluator_relations (relation_name, reason) values ('users', 'smoke only');
  if not has_table_privilege('dq_evaluator', 'public.users', 'SELECT') then
    raise exception 'S5: the allowlist entry did not grant SELECT';
  end if;
  -- ...and the grant is usable, not just recorded
  set local role dq_evaluator;
  select count(*) into n from public.users;
  reset role;

  -- ...and REMOVING it takes the grant away again. This half matters twice
  -- over: it tests the other direction, and it leaves the database as this
  -- suite found it. Relying on the file's own ROLLBACK is not enough — the
  -- linked harness runs every suite inside ONE transaction, and this entry
  -- used to survive into dq_security_smoke and make its S1 assertion pass
  -- for the wrong reason (found by the linked dry run, 21 Sep 2026).
  delete from public.dq_evaluator_relations where relation_name = 'users';
  if has_table_privilege('dq_evaluator', 'public.users', 'SELECT') then
    raise exception 'S5: removing the allowlist entry did not revoke SELECT — the evaluator can still read public.users';
  end if;
  if exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'users' and p.policyname = 'dq_evaluator_read') then
    raise exception 'S5: the read-through policy was left behind on public.users';
  end if;
  raise notice 'S5 ok: sync idempotent (%), an allowlist entry grants at once and removing it revokes', a;
end $$;

do $$ begin raise notice 'DQ A SMOKE: ALL ASSERTIONS PASSED'; end $$;

rollback;
