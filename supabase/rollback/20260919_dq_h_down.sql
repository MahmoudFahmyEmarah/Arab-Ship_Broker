-- DOWN for 20260919170000_dq_h_scaling.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260919_dq_h_down.sql
--   supabase migration repair --status reverted 20260919170000
-- Self-contained: every function body below is verbatim from the migration that last defined it.
-- History-bearing tables are renamed to *_bak_20260919170000, never dropped.
-- Deploy the pre-H application first (it reads batch_limit / next_limit from the batch step).
set local lock_timeout = '5s';
set local statement_timeout = '10min';

drop function if exists public.fn_dq_batch_timeout(uuid, text);
-- fn_dq_process_batch as of workstream C (fixed batch size)
CREATE OR REPLACE FUNCTION "public"."fn_dq_process_batch"("p_run_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_run public.dq_runs%rowtype; v_tables text[]; v_idx int; v_last text; v_table text;
  v_keys text[]; v_from text; v_to text; v_n int; v_batch_id uuid; v_batch_n int; v_clock timestamptz := clock_timestamp();
  v_res jsonb; v_errs text[]; v_found jsonb;
begin
  select * into v_run from public.dq_runs where id = p_run_id for update;
  if not found then raise exception 'run % not found', p_run_id; end if;
  if v_run.status <> 'running' then return jsonb_build_object('done', true, 'status', v_run.status); end if;

  v_tables := v_run.tables; v_idx := coalesce((v_run.cursor->>'idx')::int, 0); v_last := v_run.cursor->>'last';
  loop
    if v_idx >= coalesce(array_length(v_tables, 1), 0) then
      perform public.fn_dq_finish_run(p_run_id, 'completed', null);
      return jsonb_build_object('done', true, 'status', (select status from public.dq_runs where id = p_run_id));
    end if;
    v_table := v_tables[v_idx + 1];
    select array_agg(k order by k) into v_keys
      from (select key k from public.dq_run_keys where run_id = p_run_id and table_name = v_table and (v_last is null or key > v_last) order by key limit v_run.batch_size) s;
    if v_keys is null or array_length(v_keys, 1) = 0 then v_idx := v_idx + 1; v_last := null; continue; end if;
    exit;
  end loop;

  v_from := v_keys[1]; v_to := v_keys[array_length(v_keys, 1)]; v_n := array_length(v_keys, 1);
  v_batch_n := v_run.batches_done + 1;
  insert into public.dq_run_batches (run_id, n, table_name, key_from, key_to, rows, status, started_at)
  values (p_run_id, v_batch_n, v_table, v_from, v_to, v_n, 'running', clock_timestamp()) returning id into v_batch_id;

  v_res := public.fn_dq_evaluate_range(p_run_id, v_table, v_from, v_to);
  v_errs := coalesce((select array_agg(x) from jsonb_array_elements_text(v_res->'errors') x), '{}'::text[]);
  v_found := v_res->'found';

  update public.dq_run_batches set status = case when array_length(v_errs, 1) > 0 then 'failed' else 'done' end, found = v_found,
    ms = (extract(epoch from (clock_timestamp() - v_clock)) * 1000)::int,
    error = nullif(array_to_string(v_errs, ' · '), ''), rule_errors = coalesce(v_res->'rule_errors', '[]'::jsonb), finished_at = clock_timestamp()
  where id = v_batch_id;

  update public.dq_runs set rows_done = rows_done + v_n, batches_done = batches_done + 1, last_batch_at = clock_timestamp(),
    cursor = jsonb_build_object('idx', v_idx, 'last', v_to),
    found = jsonb_build_object('error', (dq_runs.found->>'error')::int + (v_found->>'error')::int, 'warn', (dq_runs.found->>'warn')::int + (v_found->>'warn')::int, 'info', (dq_runs.found->>'info')::int + (v_found->>'info')::int),
    note = case when array_length(v_errs, 1) > 0 then left(coalesce(note || ' · ', '') || format('batch %s: %s', v_batch_n, array_to_string(v_errs, ' · ')), 2000) else note end
  where id = p_run_id;

  return jsonb_build_object('done', false, 'batch_id', v_batch_id, 'n', v_batch_n, 'table', v_table, 'key_from', v_from, 'key_to', v_to,
                            'rows', v_n, 'rules', (v_res->>'rules')::int, 'found', v_found, 'errors', v_res->'errors');
end $_$;
revoke all on function public.fn_dq_process_batch(uuid) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_process_batch(uuid) to service_role;

alter table public.dq_runs drop column if exists batch_limit, drop column if exists timeout_retries;
drop index if exists public.idx_trgm_dq_issues_search;
alter table public.dq_issues drop column if exists search_text;
-- the five per-column trigram indexes of workstream F come back
do $$
declare c text; ix text;
begin
  foreach c in array array['row_label', 'row_key', 'rule_code', 'field', 'observed'] loop
    ix := format('idx_trgm_dq_issues_%s', c);
    if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = ix) then
      execute format('create index %I on public.dq_issues using gin (%I extensions.gin_trgm_ops)', ix, c);
    end if;
  end loop;
end $$;
drop index if exists public.idx_ports_port_key, public.idx_ports_locode_compact, public.idx_ports_locode_upper_compact, public.idx_cl_dup_load_key;
