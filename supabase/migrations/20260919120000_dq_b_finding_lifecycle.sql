-- ════════════════════════════════════════════════════════════════════════
-- Data Quality · workstream B — the finding lifecycle (19 Sep 2026)
-- (audit blocker 3; findings 7, 8, 9)
--
-- Before: uniqueness and the run's ON CONFLICT saw only OPEN issues, so an
-- ignored or false-positive decision was silently followed by a fresh open
-- issue on the next run (2,193 ignored live). Disabling a rule left its
-- issues open. A deleted record kept its issues. AI findings could take over
-- a rule's issue. The gate answered "ok" for an unregistered table.
--
-- Now:
--   one row per finding identity  (source, rule, table, row, field), whatever
--       the status; dq_issue_events records every status change with actor,
--       reason and the observed value at the time.
--   re-observation   an ignored / false-positive finding stays so while the
--       observed value is unchanged and the suppression has not expired;
--       otherwise it reopens with a reason. Fixed, rule_disabled and
--       record_gone reopen when observed again. Escalated stays escalated.
--   dq_set_issue_status   the one way to change a status: suppressions
--       require a reason and remember the observed value.
--   dq_set_rule_enabled   disable / delete / restore with a version row;
--       disabling parks the rule's open issues as rule_disabled. Enabling
--       reopens NOTHING: a parked finding reopens only when a later run
--       observes the same identity failing again (20 Sep 2026 amendment).
--   dq_save_rule     parks issues of a check the rule no longer has as
--       check_removed — a distinct cause, so disabling and enabling the
--       parent rule never touches them; only a restored check that fails
--       again reopens them.
--   fn_dq_finish_run a completed full run marks issues whose record no
--       longer exists as record_gone.
--   fn_dq_validate   an unregistered table is a configuration error.
--   AI               its findings carry source = 'ai' in the identity and
--                    never update a rule's issue.
-- Live 18 Sep: 0 duplicated identities (open 1,009 · fixed 256 · ignored
-- 2,193), so the collapse below is a no-op today; any duplicate it does fold
-- is copied to dq_issues_dedup_backup first, and the DOWN puts it back.
-- Idempotent. DOWN: supabase/rollback/20260919_dq_b_down.sql
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · the event trail ──────────────────────────────────────────────────────
set local lock_timeout = '5s';
set local statement_timeout = '10min';

create table if not exists public.dq_issue_events (
  id          bigserial primary key,
  issue_id    uuid not null references public.dq_issues(id) on delete cascade,
  at          timestamptz not null default now(),
  from_status text,
  to_status   text not null,
  reason      text,
  observed    text,
  run_id      uuid,
  actor       uuid,
  actor_name  text
);
create index if not exists dq_issue_events_issue_idx on public.dq_issue_events (issue_id, at desc);
alter table public.dq_issue_events enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'dq_issue_events' and policyname = 'dq_issue_events_admin_read') then
    create policy dq_issue_events_admin_read on public.dq_issue_events for select using (public.fn_is_admin());
  end if;
end $$;

-- ── 2 · statuses and suppression memory ─────────────────────────────────────
alter table public.dq_issues
  add column if not exists suppressed_observed text,
  add column if not exists suppress_until      timestamptz,
  add column if not exists status_changed_at   timestamptz not null default now();
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.dq_issues'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%' loop
    execute format('alter table public.dq_issues drop constraint %I', c.conname);
  end loop;
  alter table public.dq_issues add constraint dq_issues_status_check
    check (status in ('open', 'fixed', 'ignored', 'false_positive', 'escalated', 'rule_disabled', 'check_removed', 'record_gone'));
end $$;
comment on column public.dq_issues.suppressed_observed is 'The observed value when the issue was ignored / marked false positive; a re-observation with a different value reopens it.';
comment on column public.dq_issues.suppress_until      is 'Optional expiry of the suppression; after it the next observation reopens the issue.';

-- ── 3 · one identity per finding ────────────────────────────────────────────
do $$
declare n int; v_ids uuid[]; v_cols text;
begin
  with ranked as (
    select id, source, rule_code, table_name, row_key, coalesce(field, '') f,
           row_number() over (partition by source, rule_code, table_name, row_key, coalesce(field, '')
                              order by (status = 'open') desc, last_seen desc, first_seen desc) rn
      from public.dq_issues
  ), losers as (select id, rule_code from ranked where rn > 1)
  insert into public.dq_issue_events (issue_id, from_status, to_status, reason)
  select r.id, i.status, 'merged', 'Duplicate finding folded into the surviving row (migration 20260919120000)'
    from ranked r join public.dq_issues i on i.id = r.id where r.rn = 1
     and exists (select 1 from losers l where l.rule_code = r.rule_code);
  -- the folded rows are kept, verbatim, so the DOWN can restore them
  create table if not exists public.dq_issues_dedup_backup (like public.dq_issues including defaults);
  with ranked as (
    select id, row_number() over (partition by source, rule_code, table_name, row_key, coalesce(field, '')
                                  order by (status = 'open') desc, last_seen desc, first_seen desc) rn
      from public.dq_issues
  )
  select array_agg(id) into v_ids from ranked where rn > 1;
  -- copy by name: later migrations add columns to dq_issues (a generated search column), so a positional copy would not re-run
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'dq_issues_dedup_backup'
     and c.column_name in (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'dq_issues' and is_generated = 'NEVER');
  if coalesce(array_length(v_ids, 1), 0) > 0 then
    execute format('insert into public.dq_issues_dedup_backup (%s) select %s from public.dq_issues i where i.id = any ($1)', v_cols, v_cols) using v_ids;
  end if;
  with ranked as (
    select id, row_number() over (partition by source, rule_code, table_name, row_key, coalesce(field, '')
                                  order by (status = 'open') desc, last_seen desc, first_seen desc) rn
      from public.dq_issues
  )
  delete from public.dq_issues where id in (select id from ranked where rn > 1);
  get diagnostics n = row_count;
  raise notice 'dq_issues: % duplicate rows folded (copied to dq_issues_dedup_backup)', n;
end $$;
drop index if exists public.dq_issues_open_uq;
create unique index if not exists dq_issues_identity_uq
  on public.dq_issues (source, rule_code, table_name, row_key, coalesce(field, ''));

-- ── 4 · every status change is an event ─────────────────────────────────────
create or replace function public.fn_dq_issue_status_stamp()
 returns trigger language plpgsql set search_path to ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then new.status_changed_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_dq_issue_status_stamp on public.dq_issues;
create trigger trg_dq_issue_status_stamp before update on public.dq_issues for each row execute function public.fn_dq_issue_status_stamp();

create or replace function public.fn_dq_issue_event()
 returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.dq_issue_events (issue_id, from_status, to_status, reason, observed, run_id, actor, actor_name)
    values (new.id, null, new.status, new.reason, new.observed, new.run_id, new.resolved_by, coalesce(new.resolved_by_name, 'run'));
  elsif new.status is distinct from old.status then
    insert into public.dq_issue_events (issue_id, from_status, to_status, reason, observed, run_id, actor, actor_name)
    values (new.id, old.status, new.status, new.reason, new.observed, new.run_id, new.resolved_by,
            coalesce(new.resolved_by_name, nullif(current_setting('dq.actor_name', true), ''), 'run'));
  end if;
  return null;
end $$;
drop trigger if exists trg_dq_issue_event on public.dq_issues;
create trigger trg_dq_issue_event after insert or update of status on public.dq_issues for each row execute function public.fn_dq_issue_event();

-- ── 5 · one way to change a status ──────────────────────────────────────────
create or replace function public.dq_set_issue_status(
  p_ids uuid[], p_status text, p_reason text default null, p_actor uuid default null, p_actor_name text default null, p_suppress_days integer default null
) returns integer language plpgsql security definer set search_path to ''
as $$
declare n int; v_suppress boolean := p_status in ('ignored', 'false_positive');
begin
  if p_status not in ('open', 'fixed', 'ignored', 'false_positive', 'escalated') then
    raise exception 'status % cannot be set by hand', p_status using errcode = '22023';
  end if;
  if v_suppress and coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to ignore an issue or mark it a false positive' using errcode = '22023';
  end if;
  update public.dq_issues i
     set status = p_status,
         reason = case when p_status = 'open' then coalesce(nullif(btrim(p_reason), ''), 'Reopened by an administrator') else nullif(btrim(p_reason), '') end,
         resolved_at = case when p_status = 'open' then null else now() end,
         resolved_by = case when p_status = 'open' then null else p_actor end,
         resolved_by_name = case when p_status = 'open' then null else p_actor_name end,
         suppressed_observed = case when v_suppress then i.observed else null end,
         suppress_until = case when v_suppress and p_suppress_days is not null then now() + make_interval(days => p_suppress_days) else null end
   where i.id = any (p_ids[1:500]) and i.status is distinct from p_status;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── 6 · disable / delete / restore a rule, with its issues ──────────────────
create or replace function public.dq_set_rule_enabled(
  p_rule_id uuid, p_enabled boolean, p_deleted boolean default null, p_actor uuid default null, p_actor_name text default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path to ''
as $$
declare r public.dq_rules%rowtype; v_parked int := 0; v_reopened int := 0;
begin
  update public.dq_rules
     set enabled = p_enabled,
         deleted_at = case when p_deleted is null then deleted_at when p_deleted then coalesce(deleted_at, now()) else null end,
         version = version + 1, updated_at = now()
   where id = p_rule_id
  returning * into r;
  if not found then raise exception 'rule not found' using errcode = 'P0002'; end if;
  insert into public.dq_rule_versions (rule_id, version, snapshot, note, changed_by, changed_by_name)
  values (r.id, r.version, to_jsonb(r) - 'created_at' - 'updated_at',
          coalesce(p_note, case when p_deleted then 'Deleted' when p_deleted is false then 'Restored' when p_enabled then 'Enabled' else 'Disabled' end),
          p_actor, p_actor_name);
  if not p_enabled then
    -- park what is open; a check_removed finding keeps its own cause
    update public.dq_issues set status = 'rule_disabled', reason = case when coalesce(p_deleted, false) then 'Rule deleted' else 'Rule disabled' end,
           resolved_at = now(), resolved_by = p_actor, resolved_by_name = p_actor_name
     where rule_id = p_rule_id and status in ('open', 'escalated');
    get diagnostics v_parked = row_count;
  end if;
  -- enabling reopens nothing: the next successful run reopens exactly the
  -- parked findings it observes failing again (fn_dq_evaluate_range's upsert)
  return jsonb_build_object('parked', v_parked, 'reopened', v_reopened, 'version', r.version);
end $$;

-- ── 7 · saving a rule closes issues for checks it no longer has ─────────────
create or replace function public.dq_save_rule(p_rule jsonb, p_actor uuid default null, p_actor_name text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_id uuid := nullif(p_rule->>'id', '')::uuid; v_row public.dq_rules%rowtype; c jsonb; v_t text; v_checks jsonb := coalesce(p_rule->'checks', '[]'::jsonb);
        v_tables text[]; v_code text; v_key text;
begin
  for c in select x from jsonb_array_elements(v_checks) x loop
    v_t := c->>'table';
    if not exists (select 1 from public.dq_tables where table_name = v_t) then raise exception 'Unknown table "%"', v_t using errcode = '22023'; end if;
    select key_column into v_key from public.dq_tables where table_name = v_t;
    perform public.fn_dq_assert_safe_sql(c->>'violation_sql', 'The violation expression');
    perform public.fn_dq_assert_safe_sql(c->>'query_sql', 'The SQL query');
    perform public.fn_dq_assert_safe_sql(c->>'fix_sql', 'The fix expression');
    perform public.fn_dq_assert_safe_sql(c->>'expected_sql', 'The expected expression');
    perform public.fn_dq_assert_safe_sql(c->>'observed_sql', 'The observed expression');
    if coalesce(c->>'query_sql', '') <> '' then
      perform public.fn_dq_assert_relations_allowed(format('select q.%I::text from (%s) q', v_key, c->>'query_sql'), 'The SQL query');
    elsif coalesce(c->>'violation_sql', '') <> '' then
      perform public.fn_dq_assert_relations_allowed(format('select 1 from public.%I r where (%s)', v_t, c->>'violation_sql'), 'The violation expression');
    end if;
    if coalesce(c->>'fix_sql', '') <> '' then perform public.fn_dq_assert_relations_allowed(format('select (%s)::text from public.%I r', c->>'fix_sql', v_t), 'The fix expression'); end if;
    if coalesce(c->>'expected_sql', '') <> '' then perform public.fn_dq_assert_relations_allowed(format('select (%s)::text from public.%I r', c->>'expected_sql', v_t), 'The expected expression'); end if;
    if coalesce(c->>'observed_sql', '') <> '' then perform public.fn_dq_assert_relations_allowed(format('select (%s)::text from public.%I r', c->>'observed_sql', v_t), 'The observed expression'); end if;
  end loop;
  select coalesce(array_agg(x), '{}') into v_tables from jsonb_array_elements_text(coalesce(p_rule->'tables', '[]'::jsonb)) x;

  if v_id is null then
    v_code := coalesce(nullif(p_rule->>'code', ''), 'DQ-N' || lpad((select count(*) + 1 from public.dq_rules where code like 'DQ-N%')::text, 2, '0'));
    insert into public.dq_rules (code, name, description, category, severity, kind, definition, checks, ai_prompt, tables, autofix, enabled, source, owner, created_by)
    values (v_code, coalesce(p_rule->>'name', 'New rule'), coalesce(p_rule->>'description', ''), coalesce(p_rule->>'category', 'validity'), coalesce(p_rule->>'severity', 'warn'),
            coalesce(p_rule->>'kind', 'declarative'), coalesce(p_rule->>'definition', ''), v_checks, p_rule->>'ai_prompt', v_tables, coalesce(p_rule->>'autofix', 'none'),
            coalesce((p_rule->>'enabled')::boolean, false), coalesce(p_rule->>'source', 'admin'), coalesce(p_rule->>'owner', p_actor_name), p_actor)
    returning * into v_row;
  else
    update public.dq_rules set
      name = coalesce(p_rule->>'name', name), description = coalesce(p_rule->>'description', description), category = coalesce(p_rule->>'category', category),
      severity = coalesce(p_rule->>'severity', severity), kind = coalesce(p_rule->>'kind', kind), definition = coalesce(p_rule->>'definition', definition),
      checks = case when p_rule ? 'checks' then v_checks else checks end, ai_prompt = case when p_rule ? 'ai_prompt' then p_rule->>'ai_prompt' else ai_prompt end,
      tables = case when p_rule ? 'tables' then v_tables else tables end, autofix = coalesce(p_rule->>'autofix', autofix),
      enabled = coalesce((p_rule->>'enabled')::boolean, enabled), owner = coalesce(p_rule->>'owner', owner), version = version + 1, deleted_at = null
    where id = v_id returning * into v_row;
    if not found then raise exception 'rule % not found', v_id; end if;
    -- a check the rule no longer has cannot keep issues open: its own cause,
    -- untouched by disabling / enabling the rule, reopened only by a restored
    -- check that fails again
    if p_rule ? 'checks' then
      update public.dq_issues i
         set status = 'check_removed', reason = 'Check removed from the rule', resolved_at = now(), resolved_by = p_actor, resolved_by_name = p_actor_name
       where i.rule_id = v_row.id and i.status in ('open', 'escalated')
         and not exists (select 1 from jsonb_array_elements(v_row.checks) chk
                          where chk->>'table' = i.table_name and coalesce(chk->>'field', '') = coalesce(i.field, ''));
    end if;
  end if;
  insert into public.dq_rule_versions (rule_id, version, snapshot, note, changed_by, changed_by_name)
  values (v_row.id, v_row.version, to_jsonb(v_row) - 'created_at' - 'updated_at', p_note, p_actor, p_actor_name);
  return to_jsonb(v_row);
end $$;

-- ── 8 · the run honours suppressions and reopens what fails again ───────────
create or replace function public.fn_dq_process_batch(p_run_id uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_run public.dq_runs%rowtype; v_tables text[]; v_idx int; v_last text; v_table text; v_key text; v_scope text;
  v_keys text[]; v_from text; v_to text; v_n int; v_batch_id uuid; v_batch_n int; v_t0 timestamptz := now(); v_clock timestamptz := clock_timestamp();
  r record; c record; v_viol text; v_obs text; v_exp text; v_fix text; v_sql text; v_cnt bigint; v_errs text[] := '{}';
  v_pii text[]; v_label text; v_found jsonb := '{"error":0,"warn":0,"info":0}'::jsonb; v_field text; v_rules int := 0; v_keyerr text[];
begin
  select * into v_run from public.dq_runs where id = p_run_id for update;
  if not found then raise exception 'run % not found', p_run_id; end if;
  if v_run.status <> 'running' then return jsonb_build_object('done', true, 'status', v_run.status); end if;
  v_keyerr := coalesce((select array_agg(x) from jsonb_array_elements_text(v_run.scope->'key_errors') x), '{}'::text[]);

  v_tables := v_run.tables; v_idx := coalesce((v_run.cursor->>'idx')::int, 0); v_last := v_run.cursor->>'last';
  loop
    if v_idx >= coalesce(array_length(v_tables, 1), 0) then
      perform public.fn_dq_finish_run(p_run_id, 'completed', null);
      return jsonb_build_object('done', true, 'status', 'completed');
    end if;
    v_table := v_tables[v_idx + 1];
    select key_column, label_sql, pii_columns into v_key, v_label, v_pii from public.dq_tables where table_name = v_table;
    v_scope := public.fn_dq_scope_where(v_table, v_run.scope);
    execute format('select array_agg(k) from (select r.%I::text k from public.%I r where (%s) and ($1 is null or r.%I::text > $1) order by r.%I::text limit %s) s',
                   v_key, v_table, v_scope, v_key, v_key, v_run.batch_size) into v_keys using v_last;
    if v_keys is null or array_length(v_keys, 1) = 0 then v_idx := v_idx + 1; v_last := null; continue; end if;
    exit;
  end loop;

  v_from := v_keys[1]; v_to := v_keys[array_length(v_keys, 1)]; v_n := array_length(v_keys, 1);
  v_batch_n := v_run.batches_done + 1;
  insert into public.dq_run_batches (run_id, n, table_name, key_from, key_to, rows, status, started_at)
  values (p_run_id, v_batch_n, v_table, v_from, v_to, v_n, 'running', clock_timestamp()) returning id into v_batch_id;

  for r in
    select ru.* from public.dq_rules ru
    where ru.enabled and ru.deleted_at is null and ru.queue and ru.kind in ('declarative', 'sql', 'classification')
      and (v_run.rule_ids is null or ru.id = any (v_run.rule_ids)) and ru.tables @> array[v_table]
      and not (ru.id::text = any (v_keyerr))
    order by ru.code
  loop
    for c in select x, (o - 1)::int as idx from jsonb_array_elements(r.checks) with ordinality as t(x, o) where x->>'table' = v_table loop
      v_viol := public.fn_dq_check_violation(c.x, v_key, p_run_id, r.id, c.idx);
      if v_viol is null then continue; end if;
      v_rules := v_rules + 1;
      v_field := c.x->>'field';
      v_obs := coalesce(c.x->>'observed_sql', case when v_field is not null and public.fn_dq_has_column(v_table, v_field) then format('r.%I::text', v_field) else 'null::text' end);
      v_exp := case when coalesce(c.x->>'expected_sql', '') <> '' then '(' || (c.x->>'expected_sql') || ')::text' else format('%L::text', c.x->>'expected_text') end;
      v_fix := case when coalesce(c.x->>'fix_sql', '') <> '' then
        format('case when (%1$s) is not null and (%1$s)::text is distinct from (%2$s) then jsonb_build_object(''field'', %3$L, ''value'', (%1$s)::text, ''before'', (%2$s), ''after'', (%1$s)::text, ''kind'', %4$L, ''confidence'', %5$s, ''rationale'', %6$L) else null::jsonb end',
               c.x->>'fix_sql', v_obs, coalesce(c.x->>'fix_field', v_field), r.autofix, coalesce((c.x->>'fix_confidence')::numeric, 1), coalesce(c.x->>'fix_rationale', 'Derived by the rule''s fix expression.'))
        else 'null::jsonb' end;
      begin
        -- One row per identity. A suppressed finding (ignored / false positive)
        -- stays suppressed while its observed value is unchanged and the
        -- suppression has not expired; every other non-open state reopens.
        -- Suppressed rows are not counted as found.
        v_sql := format($q$
          with ins as (
            insert into public.dq_issues as di (rule_id, rule_code, run_id, table_name, row_key, row_label, field, observed, expected, severity, category, source, why, snapshot, fix)
            select %L::uuid, %L, %L::uuid, %L, r.%I::text, (%s)::text, %L, (%s)::text, %s, %L, %L, 'rule', %L, (to_jsonb(r) - %L::text[]), %s
            from public.%I r
            where (%s) and r.%I::text >= $1 and r.%I::text <= $2 and (%s)
            on conflict (source, rule_code, table_name, row_key, coalesce(field, ''))
            do update set last_seen = now(), run_id = excluded.run_id, observed = excluded.observed, expected = excluded.expected,
                          snapshot = excluded.snapshot, fix = coalesce(excluded.fix, di.fix), row_label = excluded.row_label,
                          severity = excluded.severity, rule_id = excluded.rule_id,
                          status = case
                            when di.status in ('ignored', 'false_positive') and (di.suppress_until is null or di.suppress_until > now())
                                 and di.suppressed_observed is not distinct from excluded.observed then di.status
                            when di.status = 'escalated' then 'escalated'
                            else 'open' end,
                          reason = case
                            when di.status in ('ignored', 'false_positive') and (di.suppress_until is null or di.suppress_until > now())
                                 and di.suppressed_observed is not distinct from excluded.observed then di.reason
                            when di.status in ('ignored', 'false_positive') then 'Reopened — the value changed since it was ' || replace(di.status, '_', ' ')
                            when di.status = 'fixed' then 'Reopened — fails again after being fixed'
                            when di.status = 'rule_disabled' then 'Reopened — the rule is enabled again and the record still fails'
                            when di.status = 'check_removed' then 'Reopened — the check is back and the record still fails'
                            when di.status = 'record_gone' then 'Reopened — the record exists again'
                            else di.reason end,
                          resolved_at = case
                            when di.status in ('ignored', 'false_positive') and (di.suppress_until is null or di.suppress_until > now())
                                 and di.suppressed_observed is not distinct from excluded.observed then di.resolved_at
                            when di.status = 'escalated' then di.resolved_at
                            else null end,
                          resolved_by = case
                            when di.status in ('ignored', 'false_positive', 'escalated') and (di.status = 'escalated' or ((di.suppress_until is null or di.suppress_until > now())
                                 and di.suppressed_observed is not distinct from excluded.observed)) then di.resolved_by
                            else null end,
                          resolved_by_name = case
                            when di.status in ('ignored', 'false_positive', 'escalated') and (di.status = 'escalated' or ((di.suppress_until is null or di.suppress_until > now())
                                 and di.suppressed_observed is not distinct from excluded.observed)) then di.resolved_by_name
                            else null end
            returning case when di.status in ('ignored', 'false_positive') then 0 else 1 end as counted)
          select coalesce(sum(counted), 0) from ins $q$,
          r.id, r.code, p_run_id, v_table, v_key, v_label, v_field, v_obs, v_exp, r.severity, r.category,
          coalesce(c.x->>'message', r.description), coalesce(v_pii, '{}'::text[]), v_fix,
          v_table, v_scope, v_key, v_key, v_viol);
        v_cnt := public.fn_dq_eval_count(v_sql, v_from, v_to);
        v_found := jsonb_set(v_found, array[r.severity], to_jsonb(coalesce((v_found->>r.severity)::int, 0) + coalesce(v_cnt, 0)));
        -- rows in this range that used to fail and were not raised again are fixed outside the module
        update public.dq_issues i set status = 'fixed', reason = 'No longer fails on re-check', resolved_at = now()
        where i.rule_code = r.code and i.table_name = v_table and i.status = 'open' and i.source = 'rule'
          and coalesce(i.field, '') = coalesce(v_field, '') and i.row_key >= v_from and i.row_key <= v_to and i.last_seen < v_t0;
      exception when others then
        v_errs := v_errs || format('%s on %s: %s', r.code, v_table, sqlerrm);
      end;
    end loop;
  end loop;

  update public.dq_run_batches set status = case when array_length(v_errs, 1) > 0 then 'failed' else 'done' end, found = v_found,
    ms = (extract(epoch from (clock_timestamp() - v_clock)) * 1000)::int,
    error = nullif(array_to_string(v_errs, ' · '), ''), finished_at = clock_timestamp()
  where id = v_batch_id;

  update public.dq_runs set rows_done = rows_done + v_n, batches_done = batches_done + 1, last_batch_at = clock_timestamp(),
    cursor = jsonb_build_object('idx', v_idx, 'last', v_to),
    found = jsonb_build_object('error', (dq_runs.found->>'error')::int + (v_found->>'error')::int, 'warn', (dq_runs.found->>'warn')::int + (v_found->>'warn')::int, 'info', (dq_runs.found->>'info')::int + (v_found->>'info')::int),
    note = case when array_length(v_errs, 1) > 0 then left(coalesce(note || ' · ', '') || format('batch %s: %s', v_batch_n, array_to_string(v_errs, ' · ')), 2000) else note end
  where id = p_run_id;

  return jsonb_build_object('done', false, 'batch_id', v_batch_id, 'n', v_batch_n, 'table', v_table, 'key_from', v_from, 'key_to', v_to,
                            'rows', v_n, 'rules', v_rules, 'found', v_found, 'errors', to_jsonb(v_errs));
end $function$;

-- ── 9 · a completed full run closes issues whose record is gone ─────────────
create or replace function public.fn_dq_finish_run(p_run_id uuid, p_status text, p_error text default null)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare v_run public.dq_runs%rowtype; t text; v_key text; n int;
begin
  update public.dq_runs set status = p_status, finished_at = clock_timestamp(), error = coalesce(p_error, error),
    duration_ms = extract(epoch from (clock_timestamp() - coalesce(started_at, created_at))) * 1000
  where id = p_run_id returning * into v_run;
  if p_status in ('completed', 'failed', 'cancelled') then
    delete from public.dq_run_rule_keys where run_id = p_run_id;
  end if;
  if p_status = 'completed' and coalesce(v_run.scope->>'kind', 'db') in ('db', 'tables') then
    -- the run saw every row of these tables: an open issue whose row is missing is about a record that is gone
    foreach t in array coalesce(v_run.tables, '{}'::text[]) loop
      select key_column into v_key from public.dq_tables where table_name = t;
      if v_key is null then continue; end if;
      execute format($q$
        update public.dq_issues i set status = 'record_gone', reason = 'Record no longer exists', resolved_at = now()
         where i.table_name = %L and i.status in ('open', 'escalated')
           and not exists (select 1 from public.%I r where r.%I::text = i.row_key) $q$, t, t, v_key);
      get diagnostics n = row_count;
      if n > 0 then
        update public.dq_runs set note = left(coalesce(note || ' · ', '') || format('%s: %s issue(s) closed — record gone', t, n), 2000) where id = p_run_id;
      end if;
    end loop;
  end if;
  if p_status = 'completed' then perform public.fn_dq_snapshot_health(); end if;
end $function$;

-- ── 10 · an unregistered table is a configuration error, not a pass ────────
create or replace function public.fn_dq_validate(p_table text, p_row jsonb, p_channel text default 'admin', p_actor text default null, p_actor_id uuid default null, p_log boolean default true)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare r record; c jsonb; v_bad boolean; v_mode text; v_issues jsonb := '[]'::jsonb; v_blocked boolean := false; v_key text; v_row_key text; v_errors int := 0;
begin
  if not exists (select 1 from public.dq_tables where table_name = p_table) then
    raise exception 'DQ_CONFIG: table % is not registered with the data-quality module — register it in dq_tables before gating writes to it', p_table using errcode = 'P0002';
  end if;
  select key_column into v_key from public.dq_tables where table_name = p_table;
  v_row_key := p_row->>v_key;
  for r in
    select ru.* from public.dq_rules ru where ru.enabled and ru.deleted_at is null and ru.kind in ('declarative', 'classification') and ru.tables @> array[p_table] order by ru.severity, ru.code
  loop
    v_mode := public.fn_dq_effective_mode(r.id, p_channel);
    if v_mode = 'audit' then continue; end if;
    for c in select x from jsonb_array_elements(r.checks) x where x->>'table' = p_table and coalesce(x->>'violation_sql', '') <> '' loop
      begin
        v_bad := public.fn_dq_eval_bool(
          format('select coalesce((%s), false) from (select (jsonb_populate_record(null::public.%I, $1)).*) r', c->>'violation_sql', p_table), p_row);
      exception when others then
        v_bad := false; v_errors := v_errors + 1;
        if p_log then
          insert into public.dq_gate_log (channel, rule_code, table_name, row_key, actor, actor_id, mode, message)
          values (p_channel, r.code, p_table, v_row_key, p_actor, p_actor_id, 'error', left('rule did not evaluate: ' || sqlerrm, 500));
        end if;
      end;
      if v_bad then
        v_issues := v_issues || jsonb_build_object('rule_code', r.code, 'name', r.name, 'severity', r.severity, 'field', c->>'field', 'mode', v_mode, 'message', coalesce(c->>'message', r.description));
        if v_mode = 'block' then
          v_blocked := true;
          if p_log then
            insert into public.dq_gate_log (channel, rule_code, table_name, row_key, actor, actor_id, mode, message, payload_hash)
            values (p_channel, r.code, p_table, v_row_key, p_actor, p_actor_id, v_mode, coalesce(c->>'message', r.description), encode(sha256(convert_to(p_row::text, 'UTF8')), 'hex'));
          end if;
        end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('ok', not v_blocked, 'blocked', v_blocked, 'issues', v_issues, 'errors', v_errors);
end $function$;

-- ── 11 · a suggestion that applied nothing says so ──────────────────────────
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.dq_ai_suggestions'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%' loop
    execute format('alter table public.dq_ai_suggestions drop constraint %I', c.conname);
  end loop;
  alter table public.dq_ai_suggestions add constraint dq_ai_suggestions_status_check
    check (status in ('pending', 'accepted', 'dismissed', 'applied_nothing'));
end $$;

-- ── 12 · grants ─────────────────────────────────────────────────────────────
revoke all on function public.dq_set_issue_status(uuid[], text, text, uuid, text, integer) from public, anon, authenticated, dq_evaluator;
revoke all on function public.dq_set_rule_enabled(uuid, boolean, boolean, uuid, text, text) from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_issue_event() from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_issue_status_stamp() from public, anon, authenticated, dq_evaluator;   -- a trigger function: nobody calls it
grant execute on function public.dq_set_issue_status(uuid[], text, text, uuid, text, integer) to service_role;
grant execute on function public.dq_set_rule_enabled(uuid, boolean, boolean, uuid, text, text) to service_role;
grant execute on function public.dq_save_rule(jsonb, uuid, text, text) to service_role;
grant select on public.dq_issue_events to service_role;
