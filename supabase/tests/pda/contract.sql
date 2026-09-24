-- Run after 20260923100000..103000. This is read-only catalog verification;
-- behavioral maker/checker tests belong in the isolated release rehearsal.
begin;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'port_terminals','tariff_publishers','tariff_sources','tariff_import_batches','tariff_staged_rules',
    'port_tariff_sets','port_tariff_versions','port_tariff_rules','port_tariff_bands',
    'pda_estimates','pda_estimate_lines'
  ] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_table and c.relrowsecurity
    ) then raise exception 'PDA TEST: % missing or RLS disabled', v_table; end if;
    if has_table_privilege('authenticated', format('public.%I', v_table), 'select')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'insert')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'update')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'delete') then
      raise exception 'PDA TEST: authenticated has direct privilege on %', v_table;
    end if;
  end loop;
end;
$$;

do $$
begin
  if not has_function_privilege('authenticated', 'public.get_pda_calculation_context(text,uuid,date)', 'execute') then
    raise exception 'PDA TEST: member calculation context grant missing';
  end if;
  if not has_function_privilege('authenticated', 'public.list_pda_coverage(date)', 'execute') then
    raise exception 'PDA TEST: member coverage grant missing';
  end if;
  if not has_function_privilege('authenticated', 'public.list_pda_terminals(text)', 'execute') then
    raise exception 'PDA TEST: member terminal grant missing';
  end if;
  if has_function_privilege('authenticated', 'public.pda_save_estimate(uuid,uuid,jsonb,jsonb,uuid)', 'execute') then
    raise exception 'PDA TEST: estimate write RPC exposed to members';
  end if;
  if has_function_privilege('authenticated', 'public.fn_can_read_pda_estimate(uuid)', 'execute') then
    raise exception 'PDA TEST: cross-module helper exposed directly';
  end if;
  if has_function_privilege('authenticated', 'public.fn_pda_estimate_header(uuid)', 'execute') then
    raise exception 'PDA TEST: minimal cross-module header exposed directly';
  end if;
  if has_function_privilege('authenticated', 'public.pda_upsert_port_terminal(uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.pda_verify_port_terminal(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.pda_return_tariff_version(uuid,uuid,text)', 'execute') then
    raise exception 'PDA TEST: administration RPC exposed to members';
  end if;
end;
$$;

do $$
declare v_constraints integer;
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'port_tariff_sets_active_scope_uq'
      and indexdef ilike '%unique%' and indexdef ilike '%nulls not distinct%'
      and indexdef ilike '%where is_active%'
  ) then raise exception 'PDA TEST: consolidated active tariff scope is not uniquely enforced'; end if;

  select count(*) into v_constraints
  from pg_constraint
  where conrelid = 'public.pda_estimate_lines'::regclass
    and conname in ('pda_estimate_lines_basis_ck','pda_estimate_lines_evidence_ck','pda_estimate_lines_manual_ck');
  if v_constraints <> 3 then
    raise exception 'PDA TEST: estimate line basis/evidence constraints missing';
  end if;
end;
$$;

do $$
declare v_count integer;
begin
  select count(*) into v_count from pg_trigger
  where not tgisinternal and tgname in (
    'trg_pda_rules_mutable','trg_pda_bands_mutable','trg_pda_version_immutable',
    'trg_pda_estimates_immutable','trg_pda_estimate_lines_immutable'
  );
  if v_count <> 5 then raise exception 'PDA TEST: expected 5 immutable/mutability triggers, got %', v_count; end if;
end;
$$;

select 'PDA DATABASE CONTRACT: ALL ASSERTIONS PASSED' as result;
rollback;
