-- ════════════════════════════════════════════════════════════════════════
-- dq_evaluator: close the PUBLIC-execute side door
--
-- Verifying 20260910140000 showed dq_evaluator could still execute ~75
-- functions it was never granted — because those functions carry an EXECUTE
-- grant to PUBLIC from older migrations, and PUBLIC includes every role. Among
-- them are SECURITY DEFINER writers (fn_payment_settle, fn_org_set_plan_seat,
-- resolve_port_review, fn_refresh_matches…): exactly the escalation the
-- evaluator role exists to prevent. A per-role REVOKE cannot remove a PUBLIC
-- grant, so each such function is moved from PUBLIC to explicit grants for
-- the three roles that actually use it. Effective access for anon,
-- authenticated and service_role is unchanged; only implicit roles lose it.
--
-- Note for the owner: the same probe counts 46 SECURITY DEFINER functions
-- executable by anon. That is a project-wide posture question, outside this
-- module, and deliberately NOT changed here.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare f record; n int := 0;
begin
  for f in
    select p.oid, p.oid::regprocedure::text sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_get_userbyid(p.proowner) <> 'dq_evaluator'
      and has_function_privilege('dq_evaluator', p.oid, 'EXECUTE')
      and p.proname not in (
        -- the read-only helpers rules and policies legitimately call
        'fn_dq_imo_valid', 'fn_normalize_flag', 'fn_resolve_port_locode', 'fn_resolve_port_side',
        'fn_resolve_port_area', 'fn_port_key', 'fn_port_strip_notation', 'fn_port_options', 'fn_dq_has_column',
        'fn_is_admin', 'is_admin', 'fn_app_user_id', 'fn_my_org_ids', 'fn_my_billing_customer_ids', 'fn_market_fresh_ok')
  loop
    -- keep what every real caller has today, drop only the implicit grant
    execute format('grant execute on function %s to anon, authenticated, service_role', f.sig);
    execute format('revoke execute on function %s from public', f.sig);
    n := n + 1;
  end loop;
  raise notice 'moved % functions from PUBLIC to explicit grants', n;
end $$;
