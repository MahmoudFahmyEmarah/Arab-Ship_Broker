-- ════════════════════════════════════════════════════════════════════════
-- dq_evaluator: let it read through the project's own RLS policies
--
-- 20260910140000 gave dq_evaluator SELECT plus a permissive read-through
-- policy on every RLS table. That is not enough on its own: Postgres still
-- plans the OTHER permissive policies on the table, and fourteen of them call
-- auth.uid() / auth.role() and six small predicate functions (fn_is_admin,
-- fn_my_org_ids, …). Without EXECUTE on those, planning fails with
-- "permission denied for schema auth" before the read-through policy can
-- short-circuit anything. These predicates are read-only by nature — they
-- answer "who is calling" — so granting them widens nothing.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

grant usage on schema auth to dq_evaluator;
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'auth' and p.proname in ('uid', 'role', 'jwt', 'email'))
       or (n.nspname = 'public' and p.proname in ('fn_is_admin', 'is_admin', 'fn_app_user_id', 'fn_my_org_ids', 'fn_my_billing_customer_ids', 'fn_market_fresh_ok'))
  loop
    execute format('grant execute on function %s to dq_evaluator', f.sig);
  end loop;
end $$;
