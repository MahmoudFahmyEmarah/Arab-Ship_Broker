-- ════════════════════════════════════════════════════════════════════════
-- dq_evaluator: grant the helpers' own dependencies
--
-- The nine allowlisted helpers call other small functions internally
-- (fn_normalize_flag → fn_flag_key, fn_dq_imo_valid → fn_imo_check_digit…).
-- After 20260910143000 removed PUBLIC execute, those inner calls failed with
-- "permission denied for function fn_flag_key". This computes the transitive
-- closure of what the allowlist references, restricted to plain (non
-- SECURITY DEFINER) functions in public, and grants exactly that. A new inner
-- helper added later is picked up by re-running this migration's block.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare
  seed    text[] := array['fn_dq_imo_valid', 'fn_normalize_flag', 'fn_resolve_port_locode', 'fn_resolve_port_side',
                          'fn_resolve_port_area', 'fn_port_key', 'fn_port_strip_notation', 'fn_port_options', 'fn_dq_has_column'];
  closure text[] := seed;
  grown   boolean := true;
  f       record;
  n       int := 0;
begin
  -- expand: any public, non-SECURITY-DEFINER function named in the body of
  -- something already in the closure joins the closure
  while grown loop
    grown := false;
    for f in
      select distinct q.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
           pg_proc q join pg_namespace nq on nq.oid = q.pronamespace
      where n.nspname = 'public' and p.proname = any (closure)
        and nq.nspname = 'public' and not q.prosecdef
        and q.proname <> p.proname and not (q.proname = any (closure))
        and p.prosrc ~ ('\m' || q.proname || '\s*\(')
    loop
      closure := closure || f.proname;
      grown := true;
    end loop;
  end loop;

  for f in
    select p.oid::regprocedure::text sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (closure)
  loop
    execute format('grant execute on function %s to dq_evaluator', f.sig);
    n := n + 1;
  end loop;
  raise notice 'dq_evaluator helper closure (% functions): %', n, array_to_string(closure, ', ');
end $$;
