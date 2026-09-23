-- Data Quality · security acceptance (20 Sep 2026). BEGIN … ROLLBACK.
--   S1  as dq_evaluator: SELECT on sensitive relations is refused
--   S2  as dq_evaluator: EXECUTE on the module's SECURITY DEFINER helpers is refused
--   S3  as dq_evaluator: what the allowlist grants still works
--   S4  catalogue: no DQ function is executable by PUBLIC, anon or authenticated
--       beyond the documented exceptions; the evaluator may execute only its
--       named eval helpers and read-only predicates
--   S5  service_role holds the engine's grants

begin;

do $$
declare r record; v_name text; v_ok boolean; n int; v_bad text := '';
begin
  -- ── S1 / S2 / S3 · as the evaluator role ─────────────────────────────────
  set local role dq_evaluator;
  foreach v_name in array array['users', 'profiles', 'organization_members', 'llm_credential', 'email_ingest_config', 'dq_settings', 'dq_config_events'] loop
    v_ok := false;
    begin
      execute format('select 1 from public.%I limit 1', v_name);
    exception when insufficient_privilege then v_ok := true;
    end;
    if not v_ok then v_bad := v_bad || v_name || ' '; end if;
  end loop;
  if v_bad <> '' then reset role; raise exception 'S1: dq_evaluator can SELECT: %', v_bad; end if;

  v_bad := '';
  foreach v_name in array array['dq_apply_fix(uuid, uuid, text, text, text)', 'fn_dq_settle_run(uuid)', 'fn_dq_prepare_run(uuid)', 'fn_dq_process_batch(uuid)',
                                    'fn_dq_reserve_ai(integer, text, uuid, integer)', 'fn_dq_outbox_claim(integer, integer, integer)', 'dq_set_issue_status(uuid[], text, text, uuid, text, integer)',
                                    'dq_save_rule(jsonb, uuid, text, text)', 'fn_dq_evaluator_sync_grants()', 'fn_dq_retention(integer, integer, integer, integer)'] loop
    if has_function_privilege('dq_evaluator', ('public.' || v_name)::regprocedure, 'execute') then v_bad := v_bad || v_name || ' '; end if;
  end loop;
  if v_bad <> '' then reset role; raise exception 'S2: dq_evaluator may EXECUTE: %', v_bad; end if;

  -- the allowlist still reads (ports is registered; dq_run_keys is allowlisted for the fence)
  perform 1 from public.ports limit 1;
  perform 1 from public.dq_run_keys limit 1;
  reset role;

  -- ── S4 · catalogue: nothing DQ-related is open to the world ──────────────
  v_bad := '';
  for r in
    select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'fn\_dq\_%' or p.proname like 'dq\_%')
       and p.proname not in ('fn_dq_imo_valid', 'fn_dq_effective_mode')   -- documented member-visible helpers
  loop
    if has_function_privilege('anon', r.oid, 'execute') or has_function_privilege('authenticated', r.oid, 'execute')
       or (select coalesce(bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE'), false) from aclexplode((select proacl from pg_proc where oid = r.oid)) a) then
      v_bad := v_bad || r.sig || ' ';
    end if;
  end loop;
  if v_bad <> '' then raise exception 'S4: executable by PUBLIC / anon / authenticated: %', v_bad; end if;
  -- the evaluator: only its eval helpers and read-only predicates
  select string_agg(p.proname, ' ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'fn\_dq\_%' or p.proname like 'dq\_%')
     and has_function_privilege('dq_evaluator', p.oid, 'execute')
     and p.proname not like 'fn\_dq\_eval\_%' and p.proname not in ('fn_dq_check_violation', 'fn_dq_has_column', 'fn_dq_imo_valid', 'fn_dq_effective_mode');
  if v_bad is not null then raise exception 'S4: dq_evaluator may execute beyond its helpers: %', v_bad; end if;

  -- ── S5 · the engine role holds what the application calls ────────────────
  foreach v_name in array array['fn_dq_prepare_run(uuid)', 'fn_dq_process_batch(uuid)', 'fn_dq_finish_run(uuid, text, text)', 'fn_dq_retry_run(uuid)', 'fn_dq_batch_timeout(uuid, text)',
                                    'fn_dq_reserve_ai(integer, text, uuid, integer)', 'fn_dq_settle_ai(uuid, integer, numeric)', 'fn_dq_release_ai(uuid)', 'fn_dq_reclaim_ai()',
                                    'fn_dq_outbox_enqueue(text, text, jsonb)', 'fn_dq_outbox_claim(integer, integer, integer)', 'fn_dq_outbox_settle(bigint, uuid, boolean, text, text[], integer)',
                                    'fn_dq_retention(integer, integer, integer, integer)', 'dq_set_rule_enabled(uuid, boolean, boolean, uuid, text, text)'] loop
    if not has_function_privilege('service_role', ('public.' || v_name)::regprocedure, 'execute') then raise exception 'S5: service_role cannot execute %', v_name; end if;
  end loop;

  raise notice 'DQ SECURITY SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
