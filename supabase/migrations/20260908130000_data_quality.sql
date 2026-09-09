-- ════════════════════════════════════════════════════════════════════════
-- Data Quality Control module (08 Sep 2026)
--
-- One rule engine, three surfaces:
--   · batch audits  — fn_dq_process_batch walks a table by key range, evaluates
--                     every applicable rule as a SQL predicate and upserts
--                     dq_issues (resumable, cancellable, never locks readers)
--   · write-time    — fn_dq_validate(table, row, channel) evaluates the same
--                     predicates on an unsaved row; block rules are logged to
--                     dq_gate_log; dq_apply_fix refuses a fix the gate blocks
--   · form-time     — the same function, called by server actions for inline
--                     messages (wired per surface)
--
-- Rules are data (dq_rules.checks jsonb, one check per table):
--   { table, field, violation_sql, observed_sql?, expected_sql?, expected_text?,
--     fix_sql?, fix_confidence?, message?, query_sql? (kind = sql), note? }
-- `violation_sql` is a boolean SQL expression over alias r (the row). `query_sql`
-- (kind sql) is a full SELECT returning the table's rows; the engine wraps it.
--
-- Fixes go through the existing audited edit RPC (edit_live_record) when the
-- table is in the Data Sync registry, else through an equivalent audited update
-- into record_edit_audit; dq_undo_fix reverses either. AI never writes: it
-- proposes (dq_ai_suggestions, dq_issues.source = 'ai'), admins accept.
-- ════════════════════════════════════════════════════════════════════════

-- ── 0 · dictionary columns the 8 Sep review asked for (nullable, backfilled) ──
alter table public.commodities
  add column if not exists official_code text,
  add column if not exists regime public.cargo_regime_enum,
  add column if not exists hazard_class text check (hazard_class in ('A','B','C')),
  add column if not exists is_mhb boolean not null default false,
  add column if not exists is_marine_pollutant boolean not null default false;

update public.commodities c set
  regime = coalesce(c.regime, case when c.cargo_type = 'Break Bulk' then 'CSS'::public.cargo_regime_enum
                                   when coalesce(c.is_grain, false) then 'GRAIN'::public.cargo_regime_enum
                                   else 'IMSBC'::public.cargo_regime_enum end),
  hazard_class = coalesce(c.hazard_class, case c.imsbc_category::text when 'Cat_A' then 'A' when 'Cat_B' then 'B' when 'Cat_C' then 'C' else null end),
  official_code = coalesce(c.official_code, (
    select m.code from public.market_names m
    where m.code is not null and btrim(m.code) <> '' and m.regime <> 'UNMAPPED'
      and (lower(m.market_name) = lower(c.canonical_name)
           or lower(m.market_name) in (select lower(a) from unnest(coalesce(c.display_aliases, '{}')) a))
    order by m.market_name limit 1))
where c.regime is null or c.hazard_class is null or c.official_code is null;

-- ── 1 · table registry (the module knows its tables) ─────────────────────
create table if not exists public.dq_tables (
  table_name   text primary key,
  label        text not null,
  key_column   text not null,          -- physical key used for cursoring + fixes
  label_sql    text not null,          -- SQL expression over alias r → human key (REF · IMO · LOCODE · name)
  pii_columns  text[] not null default '{}',
  admin_href   text,
  sort_order   integer not null default 0
);
insert into public.dq_tables (table_name, label, key_column, label_sql, pii_columns, admin_href, sort_order) values
  ('cargo_listings', 'Cargo listings', 'id', 'coalesce(r.ref, r.id::text)', '{source_contact,source_company,broker,notes}', '/admin/cargo', 1),
  ('vessel_availability', 'Vessel positions', 'id', 'coalesce(r.ref, ''P-'' || left(r.id::text, 6)) || coalesce('' · '' || (select v.vessel_name from public.vessels v where v.id = r.vessel_id), '''')', '{source_contact,source_company,broker,notes}', '/admin/vessel-availability', 2),
  ('vessels', 'Vessel register', 'id', 'coalesce(r.vessel_name, ''(unnamed)'') || coalesce('' · IMO '' || r.imo_number, '''')', '{pic_name,phone,email_general,email_chartering,commercial_manager_contact,commercial_manager_email,commercial_manager_phone,owner_address,manager_address,notes,risk_notes}', '/admin/vessels', 3),
  ('organizations', 'Companies', 'id', 'r.name', '{desk_contact_name,desk_email,desk_phone,address,link_note}', '/admin/org-members', 4),
  ('ports', 'Ports', 'locode', 'r.locode || '' · '' || coalesce(r.trade_name, '''')', '{}', '/admin/ports', 5),
  ('commodities', 'Commodities', 'id', 'r.canonical_name', '{}', '/admin/commodities', 6),
  ('market_names', 'Market names', 'market_name', 'r.market_name', '{}', '/admin/commodities', 7),
  ('sync_staged_row', 'Sync staged rows', 'id', 'coalesce(r.business_key, left(r.id::text, 8)) || '' · '' || r.sheet', '{raw,payload,source_email_id}', '/admin/data-sync', 8)
on conflict (table_name) do nothing;

-- ── 2 · rules ────────────────────────────────────────────────────────────
create table if not exists public.dq_rules (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  description  text not null default '',
  category     text not null check (category in ('completeness','validity','referential','uniqueness','consistency','classification','business rule','freshness','compliance')),
  severity     text not null check (severity in ('error','warn','info')),
  kind         text not null check (kind in ('declarative','sql','classification','ai')),
  definition   text not null default '',
  checks       jsonb not null default '[]'::jsonb,
  ai_prompt    text,
  tables       text[] not null default '{}',
  autofix      text not null default 'none' check (autofix in ('none','normalise','set from registry','reclassify','suggest only')),
  enabled      boolean not null default true,
  source       text not null default 'admin' check (source in ('built-in','workbook','admin','AI-suggested')),
  owner        text,
  version      integer not null default 1,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists dq_rules_tables_idx on public.dq_rules using gin (tables);

create or replace function public.fn_dq_rules_biu() returns trigger
language plpgsql set search_path to '' as $$
declare v_t text[];
begin
  if jsonb_typeof(new.checks) = 'array' and jsonb_array_length(new.checks) > 0 then
    select coalesce(array_agg(distinct x->>'table'), '{}') into v_t
    from jsonb_array_elements(new.checks) x where x->>'table' is not null;
    -- explicit tables (AI-only scope) are kept alongside the check tables
    new.tables := array(select distinct t from unnest(v_t || coalesce(new.tables, '{}')) t order by t);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists dq_rules_biu on public.dq_rules;
create trigger dq_rules_biu before insert or update on public.dq_rules for each row execute function public.fn_dq_rules_biu();

create table if not exists public.dq_rule_versions (
  id              bigint generated always as identity primary key,
  rule_id         uuid not null references public.dq_rules(id) on delete cascade,
  version         integer not null,
  snapshot        jsonb not null,
  note            text,
  changed_by      uuid,
  changed_by_name text,
  changed_at      timestamptz not null default now()
);
create index if not exists dq_rule_versions_rule_idx on public.dq_rule_versions (rule_id, version desc);

create table if not exists public.dq_rule_channels (
  rule_id    uuid not null references public.dq_rules(id) on delete cascade,
  channel    text not null check (channel in ('forms','admin','sync','review','pipeline','api')),
  mode       text not null check (mode in ('block','warn','audit')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (rule_id, channel)
);

create or replace function public.fn_dq_default_mode(p_severity text) returns text
language sql immutable as $$
  select case p_severity when 'error' then 'block' when 'warn' then 'warn' else 'audit' end;
$$;

create or replace function public.fn_dq_effective_mode(p_rule_id uuid, p_channel text) returns text
language sql stable set search_path to '' as $$
  select coalesce(
    (select c.mode from public.dq_rule_channels c where c.rule_id = p_rule_id and c.channel = p_channel),
    (select public.fn_dq_default_mode(r.severity) from public.dq_rules r where r.id = p_rule_id),
    'audit');
$$;

-- ── 3 · runs, batches, issues, gate log, suggestions, settings ──────────
create sequence if not exists public.dq_run_seq;

create table if not exists public.dq_runs (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique default ('run-' || lpad(nextval('public.dq_run_seq')::text, 3, '0')),
  status          text not null default 'queued' check (status in ('queued','running','paused','completed','failed','cancelled')),
  scope           jsonb not null default '{"kind":"db"}'::jsonb,   -- {kind: db|tables|filter, tables[], filter, batch_id, counts{}}
  mode            text not null default 'rules' check (mode in ('rules','ai','both')),
  batch_size      integer not null default 1000 check (batch_size between 100 and 5000),
  rule_ids        uuid[],                                        -- null = every applicable rule
  tables          text[] not null default '{}',
  total_rows      integer not null default 0,
  rows_done       integer not null default 0,
  total_batches   integer not null default 0,
  batches_done    integer not null default 0,
  found           jsonb not null default '{"error":0,"warn":0,"info":0}'::jsonb,
  ai_issues       integer not null default 0,
  tokens          bigint not null default 0,
  cost            numeric(10,4) not null default 0,
  cursor          jsonb not null default '{"idx":0,"last":null}'::jsonb,
  started_by      uuid,
  started_by_name text,
  trigger         text not null default 'admin',                 -- admin · scheduler · resume
  scheduled_for   timestamptz,
  notify          boolean not null default false,
  note            text,
  error           text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  last_batch_at   timestamptz,
  duration_ms     bigint
);
create index if not exists dq_runs_created_idx on public.dq_runs (created_at desc);
create index if not exists dq_runs_status_idx on public.dq_runs (status);

create table if not exists public.dq_run_batches (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.dq_runs(id) on delete cascade,
  n           integer not null,
  table_name  text not null,
  key_from    text,
  key_to      text,
  rows        integer not null default 0,
  status      text not null default 'queued' check (status in ('queued','running','done','failed','skipped')),
  found       jsonb not null default '{"error":0,"warn":0,"info":0}'::jsonb,
  ai_tokens   integer not null default 0,
  ai_issues   integer not null default 0,
  ms          integer,
  error       text,
  started_at  timestamptz,
  finished_at timestamptz
);
create index if not exists dq_run_batches_run_idx on public.dq_run_batches (run_id, n);

create table if not exists public.dq_issues (
  id               uuid primary key default gen_random_uuid(),
  rule_id          uuid references public.dq_rules(id) on delete set null,
  rule_code        text not null,
  run_id           uuid references public.dq_runs(id) on delete set null,
  table_name       text not null,
  row_key          text not null,
  row_label        text,
  field            text,
  observed         text,
  expected         text,
  severity         text not null check (severity in ('error','warn','info')),
  category         text,
  source           text not null default 'rule' check (source in ('rule','ai')),
  confidence       numeric(4,3),
  evidence         text,
  why              text,
  snapshot         jsonb,
  fix              jsonb,                     -- {field, value, before, after, rationale, confidence, kind}
  status           text not null default 'open' check (status in ('open','fixed','ignored','false_positive','escalated')),
  reason           text,
  assignee         text,
  fixed_audit_id   uuid,
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid,
  resolved_by_name text
);
create unique index if not exists dq_issues_open_uq on public.dq_issues (rule_code, table_name, row_key, coalesce(field, '')) where status = 'open';
create index if not exists dq_issues_status_idx on public.dq_issues (status, severity, table_name);
create index if not exists dq_issues_run_idx on public.dq_issues (run_id);
create index if not exists dq_issues_row_idx on public.dq_issues (table_name, row_key);
create index if not exists dq_issues_seen_idx on public.dq_issues (last_seen desc);

create table if not exists public.dq_gate_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  channel      text not null,
  rule_code    text not null,
  table_name   text,
  row_key      text,
  actor        text,
  actor_id     uuid,
  mode         text not null,
  message      text,
  payload_hash text
);
create index if not exists dq_gate_log_at_idx on public.dq_gate_log (at desc);

create table if not exists public.dq_ai_suggestions (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('rule','fix')),
  status           text not null default 'pending' check (status in ('pending','accepted','dismissed')),
  title            text not null,
  nl               text not null default '',
  sql              text,
  category         text,
  severity         text check (severity in ('error','warn','info')),
  tables           text[] not null default '{}',
  hits             integer not null default 0,
  evidence         jsonb not null default '[]'::jsonb,
  model            text,
  confidence       numeric(4,3),
  rule_code        text,
  issue_ids        uuid[] not null default '{}',
  run_id           uuid references public.dq_runs(id) on delete set null,
  accepted_rule_id uuid,
  reason           text,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid,
  resolved_by_name text
);
create index if not exists dq_ai_suggestions_status_idx on public.dq_ai_suggestions (status, kind, created_at desc);

create table if not exists public.dq_settings (
  id                   integer primary key default 1 check (id = 1),
  batch_size           integer not null default 1000,
  ai_sample            integer not null default 40,
  ai_daily_tokens      bigint not null default 150000,
  ai_price_per_mtok    numeric(8,3) not null default 3.0,
  auto_apply_threshold numeric(4,3) not null default 0.85,
  weights              jsonb not null default '{"error":3,"warn":1,"info":0.2}'::jsonb,
  nightly_enabled      boolean not null default false,
  nightly_time         text not null default '02:00',
  nightly_mode         text not null default 'both' check (nightly_mode in ('rules','ai','both')),
  notify               jsonb not null default '{"recipients":[],"on_complete":true,"on_errors":true,"digest":false,"budget80":true}'::jsonb,
  registry_release     text,
  registry_imported_at timestamptz,
  version              integer not null default 1,
  updated_by           uuid,
  updated_at           timestamptz not null default now()
);
insert into public.dq_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.dq_ai_usage (
  day    date primary key,
  tokens bigint not null default 0,
  cost   numeric(10,4) not null default 0,
  calls  integer not null default 0
);

create table if not exists public.dq_health_snapshots (
  table_name text not null,
  at         timestamptz not null default now(),
  rows       integer not null,
  open_error integer not null,
  open_warn  integer not null,
  open_info  integer not null,
  score      numeric(5,1) not null,
  primary key (table_name, at)
);

-- ── 4 · UN/LOCODE registry + port exceptions ─────────────────────────────
create table if not exists public.unlocode_registry (
  code               text primary key,
  country            text not null,
  location           text not null,
  name               text,
  name_wo_diacritics text,
  subdivision        text,
  function           text,
  status             text,
  date               text,
  iata               text,
  coordinates        text,
  lat                numeric(9,5),
  lng                numeric(9,5),
  remarks            text,
  release            text not null,
  updated_at         timestamptz not null default now()
);
create index if not exists unlocode_registry_name_idx on public.unlocode_registry (lower(name_wo_diacritics));

create table if not exists public.dq_port_exceptions (
  locode            text primary key,
  reason            text not null,
  requested_by      uuid,
  requested_by_name text,
  requested_at      timestamptz not null default now(),
  status            text not null default 'pending' check (status in ('pending','approved','rejected')),
  approved_by       uuid,
  approved_by_name  text,
  approved_at       timestamptz
);

-- ── 5 · RLS: admins read, service role writes ────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['dq_tables','dq_rules','dq_rule_versions','dq_rule_channels','dq_runs','dq_run_batches','dq_issues','dq_gate_log','dq_ai_suggestions','dq_settings','dq_ai_usage','dq_health_snapshots','unlocode_registry','dq_port_exceptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.fn_is_admin())', t || '_admin_read', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on sequence public.dq_run_seq to service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 6 · helpers
-- ════════════════════════════════════════════════════════════════════════

-- IMO: 7 digits, last is Σ(d1..d6 × 7..2) mod 10 (mirrors lib/sync/imo.ts)
create or replace function public.fn_dq_imo_valid(p text) returns boolean
language sql immutable as $$
  select p ~ '^\d{7}$'
     and ((substr(p,1,1)::int*7 + substr(p,2,1)::int*6 + substr(p,3,1)::int*5 + substr(p,4,1)::int*4
         + substr(p,5,1)::int*3 + substr(p,6,1)::int*2) % 10) = substr(p,7,1)::int;
$$;

-- guard for admin-authored SQL fragments: single expression, read-only
create or replace function public.fn_dq_assert_safe_sql(p text, p_what text) returns void
language plpgsql immutable as $$
begin
  if p is null then return; end if;
  if position(';' in p) > 0 then raise exception '% must be a single expression (no ";")', p_what using errcode = '22023'; end if;
  if p ~* '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|vacuum|analyze|reindex|cluster|lock|set|reset|call|do|refresh|pg_sleep|pg_read|pg_ls|lo_|dblink)\M' then
    raise exception '% may only read (found a forbidden keyword)', p_what using errcode = '22023';
  end if;
end $$;

-- the WHERE fragment (over alias r) that narrows a table to the run's scope
create or replace function public.fn_dq_scope_where(p_table text, p_scope jsonb) returns text
language plpgsql stable set search_path to '' as $$
declare v_kind text := coalesce(p_scope->>'kind', 'db'); v_filter text := p_scope->>'filter'; v_key text;
begin
  if v_kind <> 'filter' then return 'true'; end if;
  if v_filter = 'live' then
    if p_table = 'cargo_listings' then return $q$ r.status in ('IN','PARTIAL') and r.review_status = 'APPROVED' $q$; end if;
    if p_table = 'vessel_availability' then return $q$ r.status = 'OPEN' and r.review_status = 'APPROVED' $q$; end if;
    return 'true';
  elsif v_filter = 'open' then
    if p_table = 'vessel_availability' then return $q$ r.status = 'OPEN' $q$; end if;
    return 'true';
  elsif v_filter = 'sync' then
    v_key := public.fn_sync_key_column(p_table);
    if v_key is null or p_scope->>'batch_id' is null then return 'false'; end if;
    return format('exists (select 1 from public.sync_staged_row s where s.batch_id = %L::uuid and s.target_table = %L and s.committed and s.business_key = r.%I::text)',
                  p_scope->>'batch_id', p_table, v_key);
  end if;
  return 'true';
end $$;

-- the violation expression for one check; a kind-sql query is run ONCE and its
-- keys pinned as a constant set (never re-evaluated per outer row)
create or replace function public.fn_dq_check_violation(p_check jsonb, p_key text) returns text
language plpgsql stable set search_path to '' as $$
declare v_keys text[];
begin
  if coalesce(p_check->>'query_sql', '') <> '' then
    execute format('select coalesce(array_agg(q.%I::text), ''{}''::text[]) from (%s) q', p_key, p_check->>'query_sql') into v_keys;
    return format('r.%I::text = any (%L::text[])', p_key, v_keys);
  elsif coalesce(p_check->>'violation_sql', '') <> '' then
    return p_check->>'violation_sql';
  end if;
  return null;
end $$;

-- does the column exist on the table? (observed defaults to r.<field>::text)
create or replace function public.fn_dq_has_column(p_table text, p_col text) returns boolean
language sql stable set search_path to '' as $$
  select exists (select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname = p_table and a.attname = p_col and a.attnum > 0 and not a.attisdropped);
$$;

-- resolve the tables a scope covers + row counts; used by the wizard estimate and prepare
create or replace function public.fn_dq_estimate_scope(p_scope jsonb, p_batch integer default 1000) returns jsonb
language plpgsql stable set search_path to '' as $$
declare v_kind text := coalesce(p_scope->>'kind', 'db'); v_tables text[]; t text; n bigint; v_rows bigint := 0; v_batches int := 0;
        v_out jsonb := '[]'::jsonb; v_scope jsonb := p_scope; v_batch uuid; v_label text; v_key text;
begin
  if v_kind = 'tables' then
    select coalesce(array_agg(d.table_name order by d.sort_order), '{}') into v_tables
    from public.dq_tables d where d.table_name in (select jsonb_array_elements_text(coalesce(p_scope->'tables', '[]'::jsonb)));
  elsif v_kind = 'filter' then
    if p_scope->>'filter' = 'live' then v_tables := array['cargo_listings','vessel_availability'];
    elsif p_scope->>'filter' = 'open' then v_tables := array['vessel_availability'];
    elsif p_scope->>'filter' = 'sync' then
      select b.id, b.label into v_batch, v_label from public.sync_batch b where b.status = 'committed' order by b.committed_at desc nulls last limit 1;
      v_scope := v_scope || jsonb_build_object('batch_id', v_batch, 'batch_label', v_label);
      select coalesce(array_agg(distinct s.target_table), '{}') into v_tables
      from public.sync_staged_row s where s.batch_id = v_batch and s.committed and s.target_table in (select table_name from public.dq_tables);
    else v_tables := '{}';
    end if;
  else
    select coalesce(array_agg(d.table_name order by d.sort_order), '{}') into v_tables from public.dq_tables d;
  end if;

  foreach t in array v_tables loop
    select key_column into v_key from public.dq_tables where table_name = t;
    execute format('select count(*) from public.%I r where (%s)', t, public.fn_dq_scope_where(t, v_scope)) into n;
    v_rows := v_rows + n; v_batches := v_batches + greatest(1, ceil(n::numeric / greatest(p_batch, 1)))::int;
    v_out := v_out || jsonb_build_object('table', t, 'rows', n);
  end loop;
  return jsonb_build_object('tables', v_out, 'table_names', to_jsonb(v_tables), 'total_rows', v_rows, 'batches', v_batches, 'scope', v_scope);
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 7 · run lifecycle
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.fn_dq_prepare_run(p_run_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_run public.dq_runs%rowtype; v_est jsonb; v_tables text[];
begin
  select * into v_run from public.dq_runs where id = p_run_id for update;
  if not found then raise exception 'run % not found', p_run_id; end if;
  if v_run.status not in ('queued', 'paused') then return jsonb_build_object('status', v_run.status); end if;
  if v_run.started_at is null then
    v_est := public.fn_dq_estimate_scope(v_run.scope, v_run.batch_size);
    select coalesce(array_agg(x), '{}') into v_tables from jsonb_array_elements_text(v_est->'table_names') x;
    if coalesce(array_length(v_tables, 1), 0) = 0 then
      update public.dq_runs set status = 'failed', error = 'The scope resolves to no tables.', finished_at = now() where id = p_run_id;
      return jsonb_build_object('status', 'failed');
    end if;
    update public.dq_runs set status = 'running', started_at = now(), tables = v_tables,
      total_rows = (v_est->>'total_rows')::int, total_batches = (v_est->>'batches')::int,
      scope = (v_est->'scope') || jsonb_build_object('counts', v_est->'tables'), cursor = '{"idx":0,"last":null}'::jsonb
    where id = p_run_id;
  else
    update public.dq_runs set status = 'running' where id = p_run_id;
  end if;
  return jsonb_build_object('status', 'running');
end $$;

-- health score per table: 100 − Σ(open × weight) ÷ rows × 100
create or replace function public.fn_dq_health() returns jsonb
language plpgsql stable set search_path to '' as $$
declare d record; n bigint; e int; w int; i int; s numeric; wt jsonb; v_out jsonb := '[]'::jsonb; cov int;
begin
  select weights into wt from public.dq_settings where id = 1;
  for d in select * from public.dq_tables order by sort_order loop
    execute format('select count(*) from public.%I', d.table_name) into n;
    select count(*) filter (where severity = 'error'), count(*) filter (where severity = 'warn'), count(*) filter (where severity = 'info')
      into e, w, i from public.dq_issues where table_name = d.table_name and status = 'open';
    select count(*) into cov from public.dq_rules r where r.enabled and r.deleted_at is null and r.tables @> array[d.table_name];
    s := case when n = 0 then 100 else greatest(0, least(100, 100 - (e * coalesce((wt->>'error')::numeric, 3) + w * coalesce((wt->>'warn')::numeric, 1) + i * coalesce((wt->>'info')::numeric, 0.2)) / n * 100)) end;
    v_out := v_out || jsonb_build_object('table', d.table_name, 'label', d.label, 'rows', n, 'open_error', e, 'open_warn', w, 'open_info', i, 'open', e + w + i, 'score', round(s, 1), 'coverage', cov, 'href', d.admin_href);
  end loop;
  return v_out;
end $$;

create or replace function public.fn_dq_snapshot_health() returns void
language plpgsql security definer set search_path to '' as $$
declare x jsonb; v_at timestamptz := now();
begin
  for x in select jsonb_array_elements(public.fn_dq_health()) loop
    insert into public.dq_health_snapshots (table_name, at, rows, open_error, open_warn, open_info, score)
    values (x->>'table', v_at, (x->>'rows')::int, (x->>'open_error')::int, (x->>'open_warn')::int, (x->>'open_info')::int, (x->>'score')::numeric)
    on conflict do nothing;
  end loop;
end $$;

create or replace function public.fn_dq_finish_run(p_run_id uuid, p_status text, p_error text default null) returns void
language plpgsql security definer set search_path to '' as $$
begin
  update public.dq_runs set status = p_status, finished_at = clock_timestamp(), error = coalesce(p_error, error),
    duration_ms = extract(epoch from (clock_timestamp() - coalesce(started_at, created_at))) * 1000
  where id = p_run_id;
  if p_status = 'completed' then perform public.fn_dq_snapshot_health(); end if;
end $$;

-- one batch: pick the next key range of the current table, run every
-- applicable rule as one INSERT … SELECT, auto-resolve rows that no longer fail
create or replace function public.fn_dq_process_batch(p_run_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_run public.dq_runs%rowtype; v_tables text[]; v_idx int; v_last text; v_table text; v_key text; v_scope text;
  v_keys text[]; v_from text; v_to text; v_n int; v_batch_id uuid; v_batch_n int; v_t0 timestamptz := now(); v_clock timestamptz := clock_timestamp();
  r record; c jsonb; v_viol text; v_obs text; v_exp text; v_fix text; v_sql text; v_cnt int; v_errs text[] := '{}';
  v_pii text[]; v_label text; v_found jsonb := '{"error":0,"warn":0,"info":0}'::jsonb; v_field text; v_rules int := 0;
begin
  select * into v_run from public.dq_runs where id = p_run_id for update;
  if not found then raise exception 'run % not found', p_run_id; end if;
  if v_run.status <> 'running' then return jsonb_build_object('done', true, 'status', v_run.status); end if;

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
  values (p_run_id, v_batch_n, v_table, v_from, v_to, v_n, 'running', now()) returning id into v_batch_id;

  for r in
    select ru.* from public.dq_rules ru
    where ru.enabled and ru.deleted_at is null and ru.kind in ('declarative','sql','classification')
      and (v_run.rule_ids is null or ru.id = any (v_run.rule_ids)) and ru.tables @> array[v_table]
    order by ru.code
  loop
    for c in select x from jsonb_array_elements(r.checks) x where x->>'table' = v_table loop
      v_viol := public.fn_dq_check_violation(c, v_key);
      if v_viol is null then continue; end if;
      v_rules := v_rules + 1;
      v_field := c->>'field';
      v_obs := coalesce(c->>'observed_sql', case when v_field is not null and public.fn_dq_has_column(v_table, v_field) then format('r.%I::text', v_field) else 'null::text' end);
      v_exp := case when coalesce(c->>'expected_sql', '') <> '' then '(' || (c->>'expected_sql') || ')::text' else format('%L::text', c->>'expected_text') end;
      v_fix := case when coalesce(c->>'fix_sql', '') <> '' then
        format('case when (%1$s) is not null and (%1$s)::text is distinct from (%2$s) then jsonb_build_object(''field'', %3$L, ''value'', (%1$s)::text, ''before'', (%2$s), ''after'', (%1$s)::text, ''kind'', %4$L, ''confidence'', %5$s, ''rationale'', %6$L) else null::jsonb end',
               c->>'fix_sql', v_obs, coalesce(c->>'fix_field', v_field), r.autofix, coalesce((c->>'fix_confidence')::numeric, 1), coalesce(c->>'fix_rationale', 'Derived by the rule''s fix expression.'))
        else 'null::jsonb' end;
      begin
        v_sql := format($q$
          with ins as (
            insert into public.dq_issues as di (rule_id, rule_code, run_id, table_name, row_key, row_label, field, observed, expected, severity, category, source, why, snapshot, fix)
            select %L::uuid, %L, %L::uuid, %L, r.%I::text, (%s)::text, %L, (%s)::text, %s, %L, %L, 'rule', %L, (to_jsonb(r) - %L::text[]), %s
            from public.%I r
            where (%s) and r.%I::text >= $1 and r.%I::text <= $2 and (%s)
            on conflict (rule_code, table_name, row_key, coalesce(field, '')) where status = 'open'
            do update set last_seen = now(), run_id = excluded.run_id, observed = excluded.observed, expected = excluded.expected,
                          snapshot = excluded.snapshot, fix = coalesce(excluded.fix, di.fix), row_label = excluded.row_label,
                          severity = excluded.severity, rule_id = excluded.rule_id
            returning 1)
          select count(*) from ins $q$,
          r.id, r.code, p_run_id, v_table, v_key, v_label, v_field, v_obs, v_exp, r.severity, r.category,
          coalesce(c->>'message', r.description), coalesce(v_pii, '{}'::text[]), v_fix,
          v_table, v_scope, v_key, v_key, v_viol);
        execute v_sql using v_from, v_to into v_cnt;
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
    error = nullif(array_to_string(v_errs, ' · '), ''), finished_at = now()
  where id = v_batch_id;

  update public.dq_runs set rows_done = rows_done + v_n, batches_done = batches_done + 1, last_batch_at = now(),
    cursor = jsonb_build_object('idx', v_idx, 'last', v_to),
    found = jsonb_build_object('error', (dq_runs.found->>'error')::int + (v_found->>'error')::int, 'warn', (dq_runs.found->>'warn')::int + (v_found->>'warn')::int, 'info', (dq_runs.found->>'info')::int + (v_found->>'info')::int),
    note = case when array_length(v_errs, 1) > 0 then left(coalesce(note || ' · ', '') || format('batch %s: %s', v_batch_n, array_to_string(v_errs, ' · ')), 2000) else note end
  where id = p_run_id;

  return jsonb_build_object('done', false, 'batch_id', v_batch_id, 'n', v_batch_n, 'table', v_table, 'key_from', v_from, 'key_to', v_to,
                            'rows', v_n, 'rules', v_rules, 'found', v_found, 'errors', to_jsonb(v_errs));
end $$;

-- masked sample of a batch range for AI review (PII columns never leave the DB)
create or replace function public.fn_dq_sample_rows(p_table text, p_from text, p_to text, p_n integer, p_scope jsonb default '{"kind":"db"}'::jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_key text; v_pii text[]; v_label text; v_out jsonb;
begin
  select key_column, pii_columns, label_sql into v_key, v_pii, v_label from public.dq_tables where table_name = p_table;
  if v_key is null then raise exception 'unknown table %', p_table; end if;
  execute format('select coalesce(jsonb_agg(x), ''[]''::jsonb) from (select (to_jsonb(r) - %L::text[]) || jsonb_build_object(''__key'', r.%I::text, ''__label'', (%s)::text) x from public.%I r where (%s) and r.%I::text >= $1 and r.%I::text <= $2 order by random() limit %s) s',
                 coalesce(v_pii, '{}'::text[]), v_key, v_label, p_table, public.fn_dq_scope_where(p_table, p_scope), v_key, v_key, greatest(1, least(p_n, 200)))
    into v_out using p_from, p_to;
  return v_out;
end $$;

-- one masked row (issue drawer live snapshot)
create or replace function public.fn_dq_row_snapshot(p_table text, p_key text) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_key text; v_pii text[]; v_out jsonb;
begin
  select key_column, pii_columns into v_key, v_pii from public.dq_tables where table_name = p_table;
  if v_key is null then return null; end if;
  execute format('select to_jsonb(r) - %L::text[] from public.%I r where r.%I::text = $1', coalesce(v_pii, '{}'::text[]), p_table, v_key) into v_out using p_key;
  return v_out;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 8 · rule authoring: save (versioned), preview, cost
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.dq_save_rule(p_rule jsonb, p_actor uuid default null, p_actor_name text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_id uuid := nullif(p_rule->>'id', '')::uuid; v_row public.dq_rules%rowtype; c jsonb; v_t text; v_checks jsonb := coalesce(p_rule->'checks', '[]'::jsonb);
        v_tables text[]; v_code text;
begin
  -- validate every check compiles and only reads
  for c in select x from jsonb_array_elements(v_checks) x loop
    v_t := c->>'table';
    if not exists (select 1 from public.dq_tables where table_name = v_t) then raise exception 'Unknown table "%"', v_t using errcode = '22023'; end if;
    perform public.fn_dq_assert_safe_sql(c->>'violation_sql', 'The violation expression');
    perform public.fn_dq_assert_safe_sql(c->>'query_sql', 'The SQL query');
    perform public.fn_dq_assert_safe_sql(c->>'fix_sql', 'The fix expression');
    perform public.fn_dq_assert_safe_sql(c->>'expected_sql', 'The expected expression');
    perform public.fn_dq_assert_safe_sql(c->>'observed_sql', 'The observed expression');
    begin
      if coalesce(c->>'query_sql', '') <> '' then
        execute format('explain select q.%I::text from (%s) q', (select key_column from public.dq_tables where table_name = v_t), c->>'query_sql');
      elsif coalesce(c->>'violation_sql', '') <> '' then
        execute format('explain select 1 from public.%I r where (%s)', v_t, c->>'violation_sql');
      end if;
      if coalesce(c->>'fix_sql', '') <> '' then execute format('explain select (%s)::text from public.%I r', c->>'fix_sql', v_t); end if;
      if coalesce(c->>'expected_sql', '') <> '' then execute format('explain select (%s)::text from public.%I r', c->>'expected_sql', v_t); end if;
      if coalesce(c->>'observed_sql', '') <> '' then execute format('explain select (%s)::text from public.%I r', c->>'observed_sql', v_t); end if;
    exception when others then
      raise exception 'Check on % does not compile: %', v_t, sqlerrm using errcode = '22023';
    end;
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
  end if;
  insert into public.dq_rule_versions (rule_id, version, snapshot, note, changed_by, changed_by_name)
  values (v_row.id, v_row.version, to_jsonb(v_row) - 'created_at' - 'updated_at', p_note, p_actor, p_actor_name);
  return to_jsonb(v_row);
end $$;

-- rows matching a rule right now (Live preview / Test on N rows); nothing is written
create or replace function public.fn_dq_rule_preview(p_rule_id uuid, p_table text default null, p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare r public.dq_rules%rowtype; c jsonb; v_key text; v_label text; v_viol text; v_obs text; v_exp text; v_rows jsonb; v_out jsonb := '[]'::jsonb; v_t0 timestamptz := clock_timestamp(); v_total int := 0; v_checked bigint := 0; n bigint; v_t text;
begin
  select * into r from public.dq_rules where id = p_rule_id;
  if not found then raise exception 'rule not found'; end if;
  for c in select x from jsonb_array_elements(r.checks) x where p_table is null or x->>'table' = p_table loop
    v_t := c->>'table';
    select key_column, label_sql into v_key, v_label from public.dq_tables where table_name = v_t;
    v_viol := public.fn_dq_check_violation(c, v_key);
    if v_viol is null then continue; end if;
    v_obs := coalesce(c->>'observed_sql', case when c->>'field' is not null and public.fn_dq_has_column(v_t, c->>'field') then format('r.%I::text', c->>'field') else 'null::text' end);
    v_exp := case when coalesce(c->>'expected_sql', '') <> '' then '(' || (c->>'expected_sql') || ')::text' else format('%L::text', c->>'expected_text') end;
    execute format('select count(*) from public.%I r', v_t) into n; v_checked := v_checked + n;
    execute format('select coalesce(jsonb_agg(x), ''[]''::jsonb), count(*) from (select jsonb_build_object(''table'', %L, ''key'', r.%I::text, ''label'', (%s)::text, ''field'', %L, ''observed'', (%s)::text, ''expected'', %s) x from public.%I r where (%s) limit %s) s',
                   v_t, v_key, v_label, c->>'field', v_obs, v_exp, v_t, v_viol, greatest(1, least(p_limit, 500))) into v_rows, n;
    v_total := v_total + n; v_out := v_out || v_rows;
  end loop;
  return jsonb_build_object('rows', v_out, 'matches', v_total, 'checked', v_checked, 'ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000));
end $$;

-- EXPLAIN cost hint for a rule's checks
create or replace function public.fn_dq_rule_cost(p_rule_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare r public.dq_rules%rowtype; c jsonb; v_key text; v_viol text; v_plan jsonb; v_out jsonb := '[]'::jsonb; v_t text;
begin
  select * into r from public.dq_rules where id = p_rule_id;
  for c in select x from jsonb_array_elements(r.checks) x loop
    v_t := c->>'table';
    select key_column into v_key from public.dq_tables where table_name = v_t;
    if coalesce(c->>'query_sql', '') <> '' then v_viol := format('r.%I::text in (select q.%I::text from (%s) q)', v_key, v_key, c->>'query_sql');
    else v_viol := c->>'violation_sql'; end if;
    if coalesce(v_viol, '') = '' then continue; end if;
    begin
      execute format('explain (format json) select 1 from public.%I r where (%s)', v_t, v_viol) into v_plan;
      v_out := v_out || jsonb_build_object('table', v_t, 'total_cost', v_plan->0->'Plan'->>'Total Cost', 'node', v_plan->0->'Plan'->>'Node Type', 'rows', v_plan->0->'Plan'->>'Plan Rows');
    exception when others then
      v_out := v_out || jsonb_build_object('table', v_t, 'error', sqlerrm);
    end;
  end loop;
  return v_out;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 9 · the gate: validate an unsaved row against the same rules
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.fn_dq_validate(p_table text, p_row jsonb, p_channel text default 'admin', p_actor text default null, p_actor_id uuid default null, p_log boolean default true) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare r record; c jsonb; v_bad boolean; v_mode text; v_issues jsonb := '[]'::jsonb; v_blocked boolean := false; v_key text; v_row_key text;
begin
  if not exists (select 1 from public.dq_tables where table_name = p_table) then return jsonb_build_object('ok', true, 'blocked', false, 'issues', '[]'::jsonb); end if;
  select key_column into v_key from public.dq_tables where table_name = p_table;
  v_row_key := p_row->>v_key;
  for r in
    select ru.* from public.dq_rules ru where ru.enabled and ru.deleted_at is null and ru.kind in ('declarative','classification') and ru.tables @> array[p_table] order by ru.severity, ru.code
  loop
    v_mode := public.fn_dq_effective_mode(r.id, p_channel);
    if v_mode = 'audit' then continue; end if;
    for c in select x from jsonb_array_elements(r.checks) x where x->>'table' = p_table and coalesce(x->>'violation_sql', '') <> '' loop
      begin
        execute format('select coalesce((%s), false) from (select (jsonb_populate_record(null::public.%I, $1)).*) r', c->>'violation_sql', p_table) using p_row into v_bad;
      exception when others then v_bad := false; end;
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
  return jsonb_build_object('ok', not v_blocked, 'blocked', v_blocked, 'issues', v_issues);
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 10 · fixes: audited, gated, reversible
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.dq_apply_fix(p_issue_id uuid, p_actor uuid default null, p_actor_name text default null, p_value text default null, p_field text default null) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare i public.dq_issues%rowtype; v_key text; v_field text; v_val text; v_before jsonb; v_after jsonb; v_patch jsonb; v_audit uuid; v_res jsonb; v_gate jsonb; v_sync_key text; v_sync_val text;
begin
  select * into i from public.dq_issues where id = p_issue_id for update;
  if not found then raise exception 'issue not found' using errcode = 'P0002'; end if;
  if i.status <> 'open' then raise exception 'issue is %, only open issues can be fixed', i.status using errcode = '22023'; end if;
  v_field := coalesce(p_field, i.fix->>'field', i.field);
  v_val := coalesce(p_value, i.fix->>'value');
  if v_field is null or v_val is null then raise exception 'nothing to apply — no suggested value' using errcode = '22023'; end if;
  if not public.fn_dq_has_column(i.table_name, v_field) then raise exception 'column % does not exist on %', v_field, i.table_name using errcode = '22023'; end if;
  select key_column into v_key from public.dq_tables where table_name = i.table_name;

  execute format('select to_jsonb(r) from public.%I r where r.%I::text = $1', i.table_name, v_key) using i.row_key into v_before;
  if v_before is null then raise exception 'row % no longer exists in %', i.row_key, i.table_name using errcode = 'P0002'; end if;
  v_patch := jsonb_build_object(v_field, case when lower(v_val) in ('null', '—', '') then null else v_val end);
  -- already fixed outside the module (sync normaliser, admin edit): close the issue, write nothing
  if coalesce(v_before->>v_field, '') = coalesce(v_patch->>v_field, '') then
    update public.dq_issues set status = 'fixed', reason = 'Already fixed outside the module', resolved_at = now(), resolved_by = p_actor, resolved_by_name = p_actor_name where id = p_issue_id;
    return jsonb_build_object('audit_id', null, 'field', v_field, 'value', v_val, 'noop', true);
  end if;

  v_sync_key := public.fn_sync_key_column(i.table_name);
  v_sync_val := case when v_sync_key is not null then v_before->>v_sync_key end;
  if public.fn_sync_table_allowed(i.table_name) and v_sync_val is not null and v_field <> v_sync_key then
    v_res := public.edit_live_record(i.table_name, v_sync_val, v_patch, p_actor);
    v_audit := (v_res->>'audit_id')::uuid;
  else
    execute format('update public.%I t set %I = s.%I from jsonb_populate_record(null::public.%I, $1) s where t.%I::text = $2', i.table_name, v_field, v_field, i.table_name, v_key) using v_patch, i.row_key;
    execute format('select to_jsonb(r) from public.%I r where r.%I::text = $1', i.table_name, v_key) using i.row_key into v_after;
    insert into public.record_edit_audit (table_name, business_key, op, before, after, edited_by)
    values (i.table_name, i.row_key, 'update', v_before, v_after, p_actor) returning id into v_audit;
  end if;
  execute format('select to_jsonb(r) from public.%I r where r.%I::text = $1', i.table_name, v_key) using i.row_key into v_after;

  -- the gate: a fix may never introduce a block-level violation
  v_gate := public.fn_dq_validate(i.table_name, v_after, 'admin', p_actor_name, p_actor, true);
  if (v_gate->>'blocked')::boolean then
    raise exception 'Fix refused by the gate: %', (select string_agg(x->>'rule_code' || ' — ' || (x->>'message'), '; ') from jsonb_array_elements(v_gate->'issues') x where x->>'mode' = 'block') using errcode = '23514';
  end if;

  update public.dq_issues set status = 'fixed', reason = coalesce(reason, 'Fix applied'), fixed_audit_id = v_audit, resolved_at = now(), resolved_by = p_actor, resolved_by_name = p_actor_name,
    fix = coalesce(fix, '{}'::jsonb) || jsonb_build_object('field', v_field, 'value', v_val, 'applied_at', now())
  where id = p_issue_id;
  return jsonb_build_object('audit_id', v_audit, 'field', v_field, 'value', v_val, 'gate', v_gate);
end $$;

create or replace function public.dq_undo_fix(p_issue_id uuid, p_actor uuid default null) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare i public.dq_issues%rowtype; a public.record_edit_audit%rowtype; v_key text; v_set text;
begin
  select * into i from public.dq_issues where id = p_issue_id for update;
  if not found or i.fixed_audit_id is null then raise exception 'nothing to undo' using errcode = 'P0002'; end if;
  select * into a from public.record_edit_audit where id = i.fixed_audit_id;
  if not found then raise exception 'audit row missing' using errcode = 'P0002'; end if;
  if a.undone then raise exception 'already undone' using errcode = '22023'; end if;
  if public.fn_sync_table_allowed(a.table_name) and public.fn_sync_key_column(a.table_name) is not null and a.business_key = (a.before->>public.fn_sync_key_column(a.table_name)) then
    perform public.undo_record_edits(a.id, null, p_actor);
  else
    select key_column into v_key from public.dq_tables where table_name = a.table_name;
    select string_agg(format('%I = s.%I', column_name, column_name), ', ') into v_set
    from information_schema.columns where table_schema = 'public' and table_name = a.table_name and is_generated = 'NEVER';
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) s where t.%I::text = $2', a.table_name, v_set, a.table_name, v_key) using a.before, a.business_key;
    update public.record_edit_audit set undone = true, undone_at = now(), undone_by = p_actor where id = a.id;
  end if;
  update public.dq_issues set status = 'open', reason = 'Fix undone', resolved_at = null, resolved_by = null, resolved_by_name = null where id = p_issue_id;
  return jsonb_build_object('ok', true);
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 11 · ports registry drift
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.fn_dq_port_drift() returns jsonb
language sql stable set search_path to '' as $$
  with reg as (select count(*) n from public.unlocode_registry),
  used as (
    select locode from (
      select load_port_locode locode from public.cargo_listings where status in ('IN','PARTIAL') union
      select disch_port_locode from public.cargo_listings where status in ('IN','PARTIAL') union
      select open_port_locode from public.vessel_availability where status = 'OPEN') u where locode is not null),
  drift_rows as (
    -- ports missing from the registry
    select p.locode, p.trade_name port, p.trade_name ours, null::text registry, 'not in the registry' issue, p.unlocode_status status, 'Request code or fix LOCODE' action, 1 sev
    from public.ports p, reg where reg.n > 0 and not exists (select 1 from public.unlocode_registry u where u.code = p.locode)
    union all
    -- name differs (trade name kept as alias)
    select p.locode, p.trade_name, p.trade_name, u.name, 'name differs — trade name kept as alias', u.status, 'OK · alias', 3
    from public.ports p join public.unlocode_registry u on u.code = p.locode
    where lower(coalesce(u.name_wo_diacritics, u.name)) <> lower(p.trade_name) and lower(coalesce(u.name, '')) <> lower(p.trade_name)
    union all
    -- coordinates drift
    select p.locode, p.trade_name, round(p.latitude, 2) || ' N ' || round(p.longitude, 2) || ' E', round(u.lat, 2) || ' N ' || round(u.lng, 2) || ' E',
           'coordinates ' || round(6371 * acos(least(1, cos(radians(p.latitude)) * cos(radians(u.lat)) * cos(radians(u.lng) - radians(p.longitude)) + sin(radians(p.latitude)) * sin(radians(u.lat))))) || ' km off',
           u.status, case when 6371 * acos(least(1, cos(radians(p.latitude)) * cos(radians(u.lat)) * cos(radians(u.lng) - radians(p.longitude)) + sin(radians(p.latitude)) * sin(radians(u.lat)))) > 25 then 'Set from registry' else 'OK' end,
           case when 6371 * acos(least(1, cos(radians(p.latitude)) * cos(radians(u.lat)) * cos(radians(u.lng) - radians(p.longitude)) + sin(radians(p.latitude)) * sin(radians(u.lat)))) > 25 then 2 else 4 end
    from public.ports p join public.unlocode_registry u on u.code = p.locode
    where p.latitude is not null and u.lat is not null and 6371 * acos(least(1, cos(radians(p.latitude)) * cos(radians(u.lat)) * cos(radians(u.lng) - radians(p.longitude)) + sin(radians(p.latitude)) * sin(radians(u.lat)))) > 5
    union all
    -- function / status changed vs our enrichment
    select p.locode, p.trade_name, coalesce(p.unlocode_function, '—') || ' · ' || coalesce(p.unlocode_status, '—'), coalesce(u.function, '—') || ' · ' || coalesce(u.status, '—'),
           'registry function or status changed', u.status, 'Updated', 3
    from public.ports p join public.unlocode_registry u on u.code = p.locode
    where coalesce(p.unlocode_function, '') <> coalesce(u.function, '') or coalesce(p.unlocode_status, '') <> coalesce(u.status, '')
    union all
    -- trading port without seaport function and no approved exception
    select p.locode, p.trade_name, 'function ' || coalesce(p.unlocode_function, '—'), coalesce('function ' || u.function, '—'),
           'no seaport digit (function 1)', coalesce(u.status, p.unlocode_status),
           case when e.status = 'pending' then 'Exception pending' else 'Needs exception' end, 1
    from public.ports p left join public.unlocode_registry u on u.code = p.locode left join public.dq_port_exceptions e on e.locode = p.locode
    where p.locode in (select locode from used) and coalesce(u.function, p.unlocode_function, '') not like '1%' and coalesce(e.status, '') <> 'approved'
    union all
    -- used in live listings, not in ports (but in registry)
    select u.code, u.name, '—', u.name, 'used in live listings, not in ports', u.status, 'Add from registry', 1
    from used x join public.unlocode_registry u on u.code = x.locode
    where not exists (select 1 from public.ports p where p.locode = x.locode))
  select coalesce(jsonb_agg(to_jsonb(d) - 'sev' order by d.sev, d.locode), '[]'::jsonb) from drift_rows d;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 12 · seed: the real rule set (idempotent — codes already present are kept)
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.fn_dq_seed_rule(p_code text, p_name text, p_category text, p_severity text, p_kind text, p_autofix text, p_source text, p_description text, p_definition text, p_checks jsonb, p_tables text[] default '{}') returns integer
language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  if exists (select 1 from public.dq_rules where code = p_code) then return 0; end if;
  insert into public.dq_rules (code, name, category, severity, kind, autofix, source, description, definition, checks, tables, owner)
  values (p_code, p_name, p_category, p_severity, p_kind, p_autofix, p_source, p_description, p_definition, p_checks, p_tables, 'Seeded 8 Sep 2026')
  returning id into v_id;
  insert into public.dq_rule_versions (rule_id, version, snapshot, note, changed_by_name)
  select id, 1, to_jsonb(r) - 'created_at' - 'updated_at', 'Seeded from ' || p_source, 'Migration 20260908130000' from public.dq_rules r where id = v_id;
  return 1;
end $$;

create or replace function public.fn_dq_seed_rules() returns integer
language plpgsql security definer set search_path to '' as $seed$
declare n int := 0;
begin
  -- ── completeness ──
  n := n + public.fn_dq_seed_rule('DQ-K01', 'Business key present', 'completeness', 'error', 'declarative', 'none', 'built-in',
    'Every row carries its business key: REF for cargo, name for vessels, LOCODE for ports, canonical name for commodities, market name for the dictionary, business key for staged rows.',
    'not null: ref | vessel_name | locode | canonical_name | market_name | business_key',
    jsonb_build_array(
      jsonb_build_object('table','cargo_listings','field','ref','violation_sql',$$r.ref is null or btrim(r.ref) = ''$$,'expected_text','a REF (CM-/P-/OUT-nnn)'),
      jsonb_build_object('table','vessels','field','vessel_name','violation_sql',$$r.vessel_name is null or btrim(r.vessel_name) = ''$$,'expected_text','a vessel name'),
      jsonb_build_object('table','ports','field','locode','violation_sql',$$r.locode is null or btrim(r.locode) = ''$$,'expected_text','a UN/LOCODE'),
      jsonb_build_object('table','commodities','field','canonical_name','violation_sql',$$r.canonical_name is null or btrim(r.canonical_name) = ''$$,'expected_text','a canonical name'),
      jsonb_build_object('table','market_names','field','market_name','violation_sql',$$r.market_name is null or btrim(r.market_name) = ''$$,'expected_text','a market name'),
      jsonb_build_object('table','sync_staged_row','field','business_key','violation_sql',$$r.business_key is null or btrim(r.business_key) = ''$$,'expected_text','the sheet''s business key')));

  n := n + public.fn_dq_seed_rule('DQ-K02', 'Required columns present', 'completeness', 'error', 'declarative', 'none', 'built-in',
    'A row must carry every required column for its table: cargo type, commodity and quantity range for cargo; type and DWT for vessels; vessel and open date for positions; name, country and zone for ports; cargo type for commodities.',
    'not null: <required columns per table>',
    jsonb_build_array(
      jsonb_build_object('table','cargo_listings','field','required columns','violation_sql',$$r.cargo_type is null or r.commodity_name is null or r.qty_min_mt is null or r.qty_max_mt is null$$,
        'observed_sql',$$'missing: ' || concat_ws(', ', case when r.cargo_type is null then 'cargo_type' end, case when r.commodity_name is null then 'commodity_name' end, case when r.qty_min_mt is null then 'qty_min_mt' end, case when r.qty_max_mt is null then 'qty_max_mt' end)$$,'expected_text','cargo_type · commodity_name · qty_min_mt · qty_max_mt'),
      jsonb_build_object('table','vessels','field','required columns','violation_sql',$$r.vessel_type is null or r.dwt_grain is null$$,
        'observed_sql',$$'missing: ' || concat_ws(', ', case when r.vessel_type is null then 'vessel_type' end, case when r.dwt_grain is null then 'dwt_grain' end)$$,'expected_text','vessel_type · dwt_grain'),
      jsonb_build_object('table','vessel_availability','field','required columns','violation_sql',$$r.vessel_id is null or r.open_date is null$$,
        'observed_sql',$$'missing: ' || concat_ws(', ', case when r.vessel_id is null then 'vessel_id' end, case when r.open_date is null then 'open_date' end)$$,'expected_text','vessel_id · open_date'),
      jsonb_build_object('table','ports','field','required columns','violation_sql',$$r.trade_name is null or r.country is null or r.zone is null$$,
        'observed_sql',$$'missing: ' || concat_ws(', ', case when r.trade_name is null then 'trade_name' end, case when r.country is null then 'country' end, case when r.zone is null then 'zone' end)$$,'expected_text','trade_name · country · zone'),
      jsonb_build_object('table','commodities','field','cargo_type','violation_sql',$$r.cargo_type is null$$,'expected_text','Dry Bulk or Break Bulk')));

  -- ── vessels ──
  n := n + public.fn_dq_seed_rule('DQ-V01', 'Strip MV / M/V / MT prefix', 'validity', 'info', 'declarative', 'normalise', 'built-in',
    'Vessel names are stored bare. "MV", "M/V", "MT" and "M/T" are stripped on entry; the fix removes the prefix.',
    $$regex: ^(MV|M/V|MT|M/T)\s+ → ''$$,
    jsonb_build_array(jsonb_build_object('table','vessels','field','vessel_name','violation_sql',$$r.vessel_name ~* '^(m/?v|m/?t|mv\.)\s+'$$,
      'fix_sql',$$regexp_replace(r.vessel_name, '^(m/?v|m/?t|mv\.)\s+', '', 'i')$$,'expected_text','name without the motor-vessel prefix','fix_rationale','DQ-V01 normaliser (lib/sync/sheets.ts stripVesselNamePrefix).')));

  n := n + public.fn_dq_seed_rule('DQ-V02', 'TBN is a placeholder, not a vessel', 'validity', 'error', 'declarative', 'none', 'built-in',
    '"TBN", "TBA" or "to be nominated" must never create a vessel record or carry an open position.',
    $$regex: vessel_name !~* '^(tbn|tba|to be nominated|to be advised)$'$$,
    jsonb_build_array(
      jsonb_build_object('table','vessels','field','vessel_name','violation_sql',$$r.vessel_name ~* '^\s*(tbn|tba|to be (nominated|advised)|m/?v\s+tbn)\s*$'$$,'expected_text','a named vessel (placeholders are rejected)'),
      jsonb_build_object('table','vessel_availability','field','vessel_id','violation_sql',$$exists (select 1 from public.vessels v where v.id = r.vessel_id and v.vessel_name ~* '^\s*(tbn|tba|to be (nominated|advised))\s*$')$$,
        'observed_sql',$$(select v.vessel_name from public.vessels v where v.id = r.vessel_id)$$,'expected_text','a named vessel')));

  n := n + public.fn_dq_seed_rule('DQ-V03', 'Flag must be a known register', 'referential', 'error', 'declarative', 'set from registry', 'built-in',
    'Flag is a register in flag_states; common spellings (e.g. "Marshal Islands") are normalised to the register name by fn_normalize_flag.',
    'foreign key: vessels.flag → flag_states.name (192 registers) · fix = fn_normalize_flag(flag)',
    jsonb_build_array(jsonb_build_object('table','vessels','field','flag','violation_sql',$$r.flag is not null and btrim(r.flag) <> '' and not exists (select 1 from public.flag_states f where f.is_active and f.name = r.flag)$$,
      'fix_sql',$$public.fn_normalize_flag(r.flag)$$,'expected_sql',$$coalesce(public.fn_normalize_flag(r.flag), 'a register in flag_states')$$,'fix_rationale','Known spelling in flag_states.aliases.')));

  n := n + public.fn_dq_seed_rule('DQ-V04', 'IMO 7 digits with check digit — mandatory before a position goes live', 'compliance', 'warn', 'declarative', 'suggest only', 'built-in',
    'IMO is exactly 7 digits and the last digit is the weighted check digit. Warn at registration; block when the vessel is posted open (channel forms).',
    $$regex ^\d{7}$ and fn_dq_imo_valid(imo) · block on channel forms$$,
    jsonb_build_array(
      jsonb_build_object('table','vessels','field','imo_number','violation_sql',$$r.imo_number is null or not public.fn_dq_imo_valid(r.imo_number)$$,'expected_text','7-digit IMO with a valid check digit','message','IMO must be 7 digits with a valid check digit. It is required before a position goes live.'),
      jsonb_build_object('table','vessel_availability','field','vessel_id','violation_sql',$$exists (select 1 from public.vessels v where v.id = r.vessel_id and (v.imo_number is null or not public.fn_dq_imo_valid(v.imo_number)))$$,
        'observed_sql',$$coalesce((select v.imo_number from public.vessels v where v.id = r.vessel_id), '—')$$,'expected_text','a vessel with a valid IMO','message','The vessel on this position has no valid IMO.')));

  n := n + public.fn_dq_seed_rule('DQ-V05', 'Vessel with unknown flag (post-commit)', 'referential', 'error', 'sql', 'set from registry', 'built-in',
    'Flag text that the normaliser cannot map to any register at all (the dashboard''s v_vessel_flag_issues counter). DQ-V03 covers spellings that can be normalised.',
    $$select * from vessels where flag is not null and fn_normalize_flag(flag) is null$$,
    jsonb_build_array(jsonb_build_object('table','vessels','field','flag','query_sql',$$select v.* from public.vessels v where v.flag is not null and btrim(v.flag) <> '' and public.fn_normalize_flag(v.flag) is null$$,'expected_text','a register in flag_states (Manual Review)')));

  n := n + public.fn_dq_seed_rule('DQ-V06', 'Vessel without IMO', 'compliance', 'warn', 'sql', 'suggest only', 'built-in',
    'Vessels in the register without an IMO. Circular vessels wait in vessel_review_queue until an IMO is confirmed; registered vessels without one are listed here.',
    $$select * from vessels where imo_number is null$$,
    jsonb_build_array(jsonb_build_object('table','vessels','field','imo_number','query_sql',$$select v.* from public.vessels v where v.imo_number is null$$,'expected_text','7-digit IMO (confirm in Manual Review)')));

  n := n + public.fn_dq_seed_rule('DQ-V07', 'Sanctioned or high-risk vessel', 'compliance', 'error', 'sql', 'none', 'built-in',
    'A sanctioned or high-risk vessel never appears open on the market.',
    $$select * from vessels where is_sanctioned or risk_level = 'HIGH'$$,
    jsonb_build_array(
      jsonb_build_object('table','vessels','field','is_sanctioned','query_sql',$$select v.* from public.vessels v where coalesce(v.is_sanctioned, false) or v.risk_level = 'HIGH'$$,
        'observed_sql',$$case when r.is_sanctioned then 'sanctioned' else 'risk ' || r.risk_level::text end$$,'expected_text','not offered on the market'),
      jsonb_build_object('table','vessel_availability','field','vessel_id','query_sql',$$select a.* from public.vessel_availability a join public.vessels v on v.id = a.vessel_id where a.status = 'OPEN' and (coalesce(v.is_sanctioned, false) or v.risk_level = 'HIGH')$$,
        'observed_sql',$$(select case when v.is_sanctioned then 'sanctioned' else 'risk ' || v.risk_level::text end from public.vessels v where v.id = r.vessel_id)$$,'expected_text','position withdrawn')));

  -- ── uniqueness ──
  n := n + public.fn_dq_seed_rule('DQ-U01', 'IMO is unique in the register', 'uniqueness', 'error', 'declarative', 'none', 'built-in',
    'Two vessel rows with the same IMO are one ship: merge them in Vessel intel.',
    'unique: vessels.imo_number',
    jsonb_build_array(jsonb_build_object('table','vessels','field','imo_number','violation_sql',$$r.imo_number is not null and exists (select 1 from public.vessels v2 where v2.imo_number = r.imo_number and v2.id <> r.id)$$,'expected_text','one register row per IMO')));
  n := n + public.fn_dq_seed_rule('DQ-U02', 'REF is unique across cargo listings', 'uniqueness', 'error', 'declarative', 'none', 'built-in',
    'A cargo REF identifies one listing. Duplicates usually come from a re-import that did not match the existing row.',
    'unique: cargo_listings.ref',
    jsonb_build_array(jsonb_build_object('table','cargo_listings','field','ref','violation_sql',$$r.ref is not null and exists (select 1 from public.cargo_listings c2 where c2.ref = r.ref and c2.id <> r.id)$$,'expected_text','one listing per REF')));

  -- ── validity (enums / formats / ranges) ──
  n := n + public.fn_dq_seed_rule('DQ-E01', 'Enumerated columns in their enums', 'validity', 'error', 'declarative', 'normalise', 'built-in',
    'Vessel type, cargo type, status, priority, load terms, zone and port type must be members of their enum. Live tables are enum-typed (the database enforces it); the check runs on staged rows before commit.',
    'enum: vessel_type, cargo_type, status, priority, load_terms, zone (21), port_type — on sync_staged_row.payload',
    jsonb_build_array(jsonb_build_object('table','sync_staged_row','field','payload','violation_sql',
      $$(r.target_table = 'cargo_listings' and (
           (r.payload->>'cargo_type') not in ('Dry Bulk','Break Bulk')
        or (r.payload->>'status') not in ('IN','PARTIAL','OUT','MONITOR','CLOSED')
        or (r.payload->>'priority') not in ('CRITICAL','HIGH','MED','LOW','MONITOR','CLOSED')
        or (r.payload->>'load_terms') not in ('FIO','FIOT','FIOST','FIOS','FIOS LSD','Liner Terms','FO','FILO','LIFO','FLT')
        or (r.payload->>'load_zone') not in (select unnest(enum_range(null::public.zone_enum))::text)
        or (r.payload->>'disch_zone') not in (select unnest(enum_range(null::public.zone_enum))::text)))
      or (r.target_table = 'vessels' and (r.payload->>'vessel_type') not in ('Bulk Carrier','General Cargo','Other','Cargo Ship'))
      or (r.target_table = 'ports' and ((r.payload->>'port_type') not in ('Sea Port','River Port','Sea/River') or (r.payload->>'zone') not in (select unnest(enum_range(null::public.zone_enum))::text)))$$,
      'observed_sql',$$concat_ws(' · ', 'cargo_type=' || (r.payload->>'cargo_type'), 'status=' || (r.payload->>'status'), 'zone=' || coalesce(r.payload->>'load_zone', r.payload->>'zone'), 'vessel_type=' || (r.payload->>'vessel_type'), 'port_type=' || (r.payload->>'port_type'))$$,
      'expected_text','a member of the enum')));

  n := n + public.fn_dq_seed_rule('DQ-C01', 'REF matches CM- / P- / OUT-nnn', 'validity', 'warn', 'declarative', 'none', 'built-in',
    'Cargo references follow the house pattern. Provisional EM-/WA- refs minted from circulars are allowed until replaced.',
    $$regex: ^(CM|P|OUT)-\d{3,}$ (EM-/WA- provisional allowed)$$,
    jsonb_build_array(jsonb_build_object('table','cargo_listings','field','ref','violation_sql',$$r.ref is not null and r.ref !~ '^(CM|P|OUT)-\d{3,}$' and r.ref !~ '^(EM|WA)-[0-9A-F]{6,}$'$$,'expected_text','CM-nnn · P-nnn · OUT-nnn')));

  n := n + public.fn_dq_seed_rule('DQ-C02', 'Commission 0–10 %', 'validity', 'error', 'declarative', 'none', 'built-in',
    'Address commission is a percentage between 0 and 10 on cargo and on positions.',
    'range: commission_pct between 0 and 10',
    jsonb_build_array(
      jsonb_build_object('table','cargo_listings','field','commission_pct','violation_sql',$$(r.commission_pct is not null and (r.commission_pct < 0 or r.commission_pct > 10)) or (r.commission_ttl_pct is not null and (r.commission_ttl_pct < 0 or r.commission_ttl_pct > 10))$$,'expected_text','0 – 10 %','message','Commission must be between 0 and 10 %.'),
      jsonb_build_object('table','vessel_availability','field','commission_pct','violation_sql',$$r.commission_pct is not null and (r.commission_pct < 0 or r.commission_pct > 10)$$,'expected_text','0 – 10 %','message','Commission must be between 0 and 10 %.')));

  n := n + public.fn_dq_seed_rule('DQ-C03', 'Numeric columns numeric', 'validity', 'error', 'declarative', 'normalise', 'built-in',
    'Quantity, DWT, draft, cubic and rates parse as numbers; thousands separators removed. Live columns are typed; staged payloads are checked before commit.',
    'cast: numeric columns on sync_staged_row.payload',
    jsonb_build_array(jsonb_build_object('table','sync_staged_row','field','payload','violation_sql',
      $$r.target_table in ('cargo_listings','vessels') and exists (select 1 from jsonb_each_text(r.payload) kv where kv.key in ('qty_min_mt','qty_max_mt','stowage_factor','freight_idea_usd_mt','commission_pct','demurrage_rate','despatch_rate','dwt_grain','dwt_bale','max_draft_m','grain_cbm','build_year') and kv.value is not null and btrim(kv.value) <> '' and kv.value !~ '^-?\d+(\.\d+)?$')$$,
      'observed_sql',$$(select string_agg(kv.key || '=' || kv.value, ', ') from jsonb_each_text(r.payload) kv where kv.key in ('qty_min_mt','qty_max_mt','stowage_factor','freight_idea_usd_mt','commission_pct','demurrage_rate','despatch_rate','dwt_grain','dwt_bale','max_draft_m','grain_cbm','build_year') and kv.value is not null and kv.value !~ '^-?\d+(\.\d+)?$')$$,
      'expected_text','plain numbers')));

  n := n + public.fn_dq_seed_rule('DQ-C07', 'Quantity range ordered', 'consistency', 'error', 'declarative', 'normalise', 'built-in',
    'The minimum quantity cannot exceed the maximum; both must be positive.',
    'cross-field: 0 < qty_min_mt ≤ qty_max_mt',
    jsonb_build_array(jsonb_build_object('table','cargo_listings','field','qty_min_mt','violation_sql',$$(r.qty_min_mt is not null and r.qty_max_mt is not null and r.qty_min_mt > r.qty_max_mt) or coalesce(r.qty_min_mt, 1) <= 0 or coalesce(r.qty_max_mt, 1) <= 0$$,
      'observed_sql',$$r.qty_min_mt::text || ' – ' || r.qty_max_mt::text$$,'expected_text','min ≤ max, both > 0','fix_sql',$$case when r.qty_min_mt > r.qty_max_mt then r.qty_max_mt::text end$$,'fix_confidence',0.7,'fix_rationale','Swap suspected: min set to the max value; confirm the circular.')));

  n := n + public.fn_dq_seed_rule('DQ-C08', 'Laycan window ordered', 'consistency', 'error', 'declarative', 'none', 'built-in',
    'Laycan from-date cannot be after the to-date. SPOT/PPT cargo carries no laycan.',
    'cross-field: laycan_from ≤ laycan_to',
    jsonb_build_array(jsonb_build_object('table','cargo_listings','field','laycan_from','violation_sql',$$r.laycan_from is not null and r.laycan_to is not null and r.laycan_from > r.laycan_to$$,
      'observed_sql',$$r.laycan_from::text || ' → ' || r.laycan_to::text$$,'expected_text','from ≤ to')));

  -- ── ports / LOCODE ──
  n := n + public.fn_dq_seed_rule('DQ-P01', 'LOCODE is 5 characters', 'validity', 'warn', 'declarative', 'none', 'built-in',
    'A UN/LOCODE is two country letters plus three location characters (A–Z, 2–9).',
    'regex: ^[A-Z]{2}[A-Z2-9]{3}$',
    jsonb_build_array(
      jsonb_build_object('table','ports','field','locode','violation_sql',$$r.locode !~ '^[A-Z]{2}[A-Z2-9]{3}$'$$,'expected_text','CC LLL'),
      jsonb_build_object('table','cargo_listings','field','load_port_locode','violation_sql',$$(r.load_port_locode is not null and r.load_port_locode !~ '^[A-Z]{2}[A-Z2-9]{3}$') or (r.disch_port_locode is not null and r.disch_port_locode !~ '^[A-Z]{2}[A-Z2-9]{3}$')$$,
        'observed_sql',$$concat_ws(' / ', r.load_port_locode, r.disch_port_locode)$$,'expected_text','CC LLL'),
      jsonb_build_object('table','vessel_availability','field','open_port_locode','violation_sql',$$r.open_port_locode is not null and r.open_port_locode !~ '^[A-Z]{2}[A-Z2-9]{3}$'$$,'expected_text','CC LLL')));

  n := n + public.fn_dq_seed_rule('DQ-P02', 'Port name resolved to UN/LOCODE', 'referential', 'warn', 'declarative', 'set from registry', 'built-in',
    'Load, discharge and open ports written as text resolve to a LOCODE through fn_resolve_port_locode. The fix sets the code the resolver finds.',
    'registry lookup: port_name → ports.locode (fn_resolve_port_locode)',
    jsonb_build_array(
      jsonb_build_object('table','cargo_listings','field','load_port_locode','violation_sql',$$r.load_port_locode is null and r.load_port_name is not null and public.fn_resolve_port_locode(r.load_port_name) is not null$$,
        'observed_sql',$$'text: ' || r.load_port_name$$,'expected_sql',$$public.fn_resolve_port_locode(r.load_port_name)$$,'fix_sql',$$public.fn_resolve_port_locode(r.load_port_name)$$,'fix_rationale','Exact resolver match on the port name.'),
      jsonb_build_object('table','cargo_listings','field','disch_port_locode','violation_sql',$$r.disch_port_locode is null and r.disch_port_name is not null and public.fn_resolve_port_locode(r.disch_port_name) is not null$$,
        'observed_sql',$$'text: ' || r.disch_port_name$$,'expected_sql',$$public.fn_resolve_port_locode(r.disch_port_name)$$,'fix_sql',$$public.fn_resolve_port_locode(r.disch_port_name)$$,'fix_rationale','Exact resolver match on the port name.'),
      jsonb_build_object('table','vessel_availability','field','open_port_locode','violation_sql',$$r.open_port_locode is null and r.open_port_name is not null and public.fn_resolve_port_locode(r.open_port_name) is not null$$,
        'observed_sql',$$'text: ' || r.open_port_name$$,'expected_sql',$$public.fn_resolve_port_locode(r.open_port_name)$$,'fix_sql',$$public.fn_resolve_port_locode(r.open_port_name)$$,'fix_rationale','Exact resolver match on the port name.')));

  n := n + public.fn_dq_seed_rule('DQ-C05', 'Live cargo without a LOCODE', 'completeness', 'error', 'sql', 'set from registry', 'built-in',
    'A live listing whose load port has no LOCODE cannot be matched or shown on the map.',
    $$select * from cargo_listings where status in ('IN','PARTIAL') and review_status = 'APPROVED' and load_port_locode is null$$,
    jsonb_build_array(jsonb_build_object('table','cargo_listings','field','load_port_locode','query_sql',$$select c.* from public.cargo_listings c where c.status in ('IN','PARTIAL') and c.review_status = 'APPROVED' and c.load_port_locode is null$$,
      'observed_sql',$$coalesce('text: ' || r.load_port_name, '—')$$,'expected_sql',$$coalesce(public.fn_resolve_port_locode(r.load_port_name), 'a UN/LOCODE')$$,'fix_sql',$$public.fn_resolve_port_locode(r.load_port_name)$$,'fix_rationale','Registry name match through fn_resolve_port_locode.')));

  n := n + public.fn_dq_seed_rule('DQ-A01', 'Position without port or zone (cannot match)', 'consistency', 'error', 'sql', 'set from registry', 'built-in',
    'An open position needs an open port LOCODE or a zone, or the matcher skips it.',
    $$select * from vessel_availability where open_port_locode is null and open_zone is null$$,
    jsonb_build_array(jsonb_build_object('table','vessel_availability','field','open_port_locode','query_sql',$$select a.* from public.vessel_availability a where a.open_port_locode is null and a.open_zone is null$$,
      'observed_sql',$$coalesce('text: ' || r.open_port_name, '—')$$,'expected_sql',$$coalesce(public.fn_resolve_port_locode(r.open_port_name), 'an open port LOCODE or a zone')$$,'fix_sql',$$public.fn_resolve_port_locode(r.open_port_name)$$,'fix_rationale','Resolver match on the open port text; zone follows from ports.zone.')));

  n := n + public.fn_dq_seed_rule('DQ-A02', 'Open date too far in the past', 'freshness', 'warn', 'declarative', 'none', 'built-in',
    'An OPEN position whose open date passed more than 14 days ago is stale tonnage.',
    'open_date ≥ today − 14 for status OPEN',
    jsonb_build_array(jsonb_build_object('table','vessel_availability','field','open_date','violation_sql',$$r.status = 'OPEN' and r.open_date is not null and r.open_date < current_date - 14$$,'expected_text','within the last 14 days or re-confirmed')));

  -- ── commodities / classification ──
  n := n + public.fn_dq_seed_rule('DQ-C04', 'Commodity resolved through the market-name map', 'referential', 'warn', 'classification', 'reclassify', 'workbook',
    'Commodity text resolves via market_names → commodities; unknown names are queued to commodity_review_queue (UNMAPPED).',
    'registry lookup: commodity_name → market_names → commodities; else Manual Review queue',
    jsonb_build_array(jsonb_build_object('table','cargo_listings','field','commodity_id','violation_sql',$$r.commodity_id is null and r.commodity_name is not null$$,
      'observed_sql',$$'unresolved: ' || r.commodity_name$$,
      'expected_sql',$$coalesce((select c.canonical_name from public.market_names m join public.commodities c on lower(c.canonical_name) = lower(m.market_name) or lower(m.market_name) = any (select lower(a) from unnest(coalesce(c.display_aliases, '{}')) a) where lower(m.market_name) = lower(btrim(r.commodity_name)) limit 1), 'queue for Manual Review')$$)));

  n := n + public.fn_dq_seed_rule('DQ-C06', 'Commodity to map', 'classification', 'warn', 'sql', 'reclassify', 'built-in',
    'Market names still UNMAPPED and commodities without a regime — waiting for a regime and an official code in Manual Review.',
    $$select * from market_names where regime = 'UNMAPPED'$$,
    jsonb_build_array(
      jsonb_build_object('table','market_names','field','regime','query_sql',$$select m.* from public.market_names m where m.regime = 'UNMAPPED'$$,'expected_text','GRAIN · IMSBC · CSS'),
      jsonb_build_object('table','commodities','field','regime','query_sql',$$select c.* from public.commodities c where c.regime is null$$,'expected_text','GRAIN · IMSBC · CSS')));

  n := n + public.fn_dq_seed_rule('DQ-X01', 'Q1 — bagged, big-bag or palletised → CSS regime', 'classification', 'error', 'classification', 'reclassify', 'workbook',
    'Packaged cargo is break-bulk under the CSS Code — even bagged grain. Bulk continues to Q2.',
    $$packaging in (bagged, big-bag, palletised) ⇒ regime CSS ⇒ cargo_type Break Bulk$$,
    jsonb_build_array(
      jsonb_build_object('table','cargo_listings','field','cargo_type','violation_sql',$$coalesce(r.packaging_type, '') ~* '(bag|jumbo|pallet|sling|bale|drum|unit)' and r.cargo_type = 'Dry Bulk'$$,
        'observed_sql',$$r.cargo_type::text || ' · packaging ' || r.packaging_type$$,'expected_text','Break Bulk (CSS regime)','fix_sql',$$'Break Bulk'$$,'fix_rationale','Q1 of the classification map: packaged cargo is CSS.'),
      jsonb_build_object('table','market_names','field','regime','violation_sql',$$r.market_name ~* '(bagged|big[- ]?bags?|pallet|in bags)' and r.regime <> 'CSS'$$,'expected_text','CSS')));

  n := n + public.fn_dq_seed_rule('DQ-X02', 'Q2 — bulk grain → GRAIN regime; booklet + DoA required', 'classification', 'error', 'classification', 'reclassify', 'workbook',
    'Bulk items on the grain list take the GRAIN regime; the vessel needs a grain stability booklet and a Document of Authorization (hard block at match time if absent). Processed products are not grain.',
    $$bulk and commodity in grain_list ⇒ is_grain_cargo = true ⇒ regime GRAIN$$,
    jsonb_build_array(
      jsonb_build_object('table','cargo_listings','field','is_grain_cargo','violation_sql',$$r.cargo_type = 'Dry Bulk' and coalesce(r.packaging_type, '') !~* '(bag|pallet)' and not coalesce(r.is_grain_cargo, false) and r.commodity_name !~* '(meal|cake|pellets?|bran|flour|husk|hulls?|feed|screenings)' and exists (select 1 from public.grain_list g where g.is_active and lower(r.commodity_name) ~ ('\m' || lower(g.market_name) || '\M'))$$,
        'observed_sql',$$'is_grain_cargo false · ' || r.commodity_name$$,'expected_text','true (GRAIN regime)','fix_sql',$$'true'$$,'fix_confidence',0.9,'fix_rationale','Commodity is on the grain list and in bulk.'),
      jsonb_build_object('table','market_names','field','regime','violation_sql',$$r.regime <> 'GRAIN' and r.market_name !~* '(meal|cake|pellets?|bran|flour|husk|hulls?|feed|bagged|bags?)' and exists (select 1 from public.grain_list g where g.is_active and lower(r.market_name) ~ ('\m' || lower(g.market_name) || '\M'))$$,'expected_text','GRAIN')));

  n := n + public.fn_dq_seed_rule('DQ-X03', 'Q2 — bulk non-grain → IMSBC with Group A / B / C', 'classification', 'error', 'classification', 'reclassify', 'workbook',
    'Bulk cargo that is not grain is an IMSBC Bulk Cargo Shipping Name with a group: A may liquefy, B chemical hazard, C neither.',
    $$Dry Bulk and not grain ⇒ regime IMSBC and hazard_class in (A, B, C)$$,
    jsonb_build_array(
      jsonb_build_object('table','commodities','field','hazard_class','violation_sql',$$r.cargo_type = 'Dry Bulk' and not coalesce(r.is_grain, false) and coalesce(r.regime::text, 'IMSBC') = 'IMSBC' and r.hazard_class is null$$,
        'observed_sql',$$'imsbc_category ' || coalesce(r.imsbc_category::text, '—')$$,'expected_text','A · B · C',
        'fix_sql',$$(select case ic.imsbc_group when 'A' then 'A' when 'B' then 'B' when 'C' then 'C' end from public.imsbc_codes ic where ic.is_active and lower(ic.bcsn) = lower(r.canonical_name) limit 1)$$,'fix_confidence',0.9,'fix_rationale','Group of the matching Bulk Cargo Shipping Name in 3_IMSBC.'),
      jsonb_build_object('table','market_names','field','group_or_cat','violation_sql',$$r.regime = 'IMSBC' and (r.group_or_cat is null or r.group_or_cat !~ '^(A|B|C|A and B)$')$$,'expected_text','A · B · C · A and B')));

  n := n + public.fn_dq_seed_rule('DQ-X04', 'Multi-parcel splits into one line per parcel', 'classification', 'warn', 'classification', 'suggest only', 'workbook',
    'A multi-parcel listing becomes one classified cargo line per parcel, matched per parcel.',
    'market_name in multi-parcel set (7) ⇒ split into n cargo lines',
    jsonb_build_array(
      jsonb_build_object('table','cargo_listings','field','commodity_name','violation_sql',$$exists (select 1 from public.market_names m where m.regime = 'UNMAPPED' and coalesce(m.note, '') ~* 'multi' and lower(m.market_name) = lower(btrim(r.commodity_name)))$$,'expected_text','one cargo line per parcel'),
      jsonb_build_object('table','market_names','field','regime','violation_sql',$$r.regime = 'UNMAPPED' and coalesce(r.note, '') ~* 'multi'$$,'expected_text','split per parcel, each with its own regime and code')));

  n := n + public.fn_dq_seed_rule('DQ-X05', 'Vague names carry defaults', 'classification', 'warn', 'classification', 'reclassify', 'workbook',
    'Fertilisers → IMSBC C unless hazardous is specified · Minerals → mineral concentrates C, verify Group A · Agri Products → GRAIN unless processed. Brokers may narrow.',
    $$market_name in (Fertilisers, Minerals, Agri Products) ⇒ default regime + verify$$,
    jsonb_build_array(jsonb_build_object('table','cargo_listings','field','commodity_name','violation_sql',$$lower(btrim(r.commodity_name)) in ('fertilisers','fertilizers','fertiliser','fertilizer','minerals','mineral','agri products','agri-products','agricultural products','agriproducts')$$,
      'expected_sql',$$case when lower(r.commodity_name) like 'fert%' then 'IMSBC Group C unless hazardous specified' when lower(r.commodity_name) like 'min%' then 'IMSBC MINERAL CONCENTRATES C — verify Group A' else 'GRAIN unless processed (then SEED CAKE)' end$$)));

  n := n + public.fn_dq_seed_rule('DQ-X06', 'Classification rulings', 'classification', 'error', 'classification', 'reclassify', 'workbook',
    'Cement copper is a Group A copper concentrate, never cement · meals, cakes, pellets and bran are IMSBC SEED CAKE Group B ("wheat bran" is not grain) · bagged salt, urea, cement and sugar are CSS unit loads · bulk scrap is CSS-09 but borings and turnings are IMSBC · GBFS and slag are CSS-10.',
    'lookup: 1_MARKET_NAME_RESOLVED ruling notes',
    jsonb_build_array(
      jsonb_build_object('table','cargo_listings','field','is_grain_cargo','violation_sql',$$coalesce(r.is_grain_cargo, false) and r.commodity_name ~* '(meal|cake|pellets?|bran)\M'$$,
        'observed_sql',$$'GRAIN · ' || r.commodity_name$$,'expected_text','IMSBC SEED CAKE Group B (not grain)','fix_sql',$$'false'$$,'fix_rationale','Ruling: meals, cakes, pellets and bran are SEED CAKE (B), not grain.'),
      jsonb_build_object('table','commodities','field','canonical_name','violation_sql',
        $$(r.canonical_name ~* 'cement copper' and coalesce(r.hazard_class, '') <> 'A')
        or (r.canonical_name ~* '(meal|cake|pellets?|bran)\M' and r.canonical_name !~* 'iron' and (coalesce(r.is_grain, false) or coalesce(r.hazard_class, '') <> 'B'))
        or (r.canonical_name ~* '\mbagged\M' and r.cargo_type <> 'Break Bulk')
        or (r.canonical_name ~* '(gbfs|granulated.*slag|\mslag\M)' and r.canonical_name !~* 'bulk' and r.cargo_type <> 'Break Bulk')$$,
        'observed_sql',$$concat_ws(' · ', r.cargo_type::text, 'regime ' || r.regime::text, 'class ' || coalesce(r.hazard_class, '—'), case when r.is_grain then 'grain' end)$$,
        'expected_sql',$$case when r.canonical_name ~* 'cement copper' then 'COPPER CONCENTRATE · Group A' when r.canonical_name ~* '(meal|cake|pellets?|bran)' then 'IMSBC SEED CAKE · Group B' when r.canonical_name ~* 'bagged' then 'CSS unit load · Break Bulk' else 'CSS-10 · Break Bulk' end$$),
      jsonb_build_object('table','market_names','field','code','violation_sql',
        $$(r.market_name ~* '(meal|cake|pellets?|bran)\M' and r.market_name !~* 'iron' and r.regime = 'GRAIN')
        or (r.market_name ~* 'cement copper' and coalesce(r.code, '') !~* 'copper concentrate')
        or (r.market_name ~* '(bagged|in bags)' and r.regime <> 'CSS')
        or (r.market_name ~* '(gbfs|\mslag\M)' and r.regime <> 'CSS')
        or (r.market_name ~* '(borings|turnings|shavings)' and r.regime <> 'IMSBC')$$,
        'observed_sql',$$r.regime::text || ' · ' || coalesce(r.code, '—')$$,'expected_text','per the MASTER map rulings')));

  -- ── 8 Sep review (owner) ──
  n := n + public.fn_dq_seed_rule('DQ-D01', 'Market name row must carry its official code', 'completeness', 'error', 'declarative', 'suggest only', 'admin',
    'The market name is the display alias; the official code (IMSBC BCSN, Grain Code entry or CSS category) is the identity. A row without a code is incomplete.',
    'not null: market_names.code · commodities.official_code',
    jsonb_build_array(
      jsonb_build_object('table','market_names','field','code','violation_sql',$$r.code is null or btrim(r.code) = '' or r.regime = 'UNMAPPED'$$,'expected_text','IMSBC BCSN · Grain Code entry · CSS category','message','Market name saved without an official code.'),
      jsonb_build_object('table','commodities','field','official_code','violation_sql',$$r.is_active and (r.official_code is null or btrim(r.official_code) = '')$$,
        'expected_sql',$$coalesce((select m.code from public.market_names m where m.code is not null and m.regime <> 'UNMAPPED' and (lower(m.market_name) = lower(r.canonical_name) or lower(m.market_name) = any (select lower(a) from unnest(coalesce(r.display_aliases, '{}')) a)) limit 1), 'an official code')$$,
        'fix_sql',$$(select m.code from public.market_names m where m.code is not null and m.regime <> 'UNMAPPED' and (lower(m.market_name) = lower(r.canonical_name) or lower(m.market_name) = any (select lower(a) from unnest(coalesce(r.display_aliases, '{}')) a)) limit 1)$$,
        'fix_confidence',0.9,'fix_rationale','Code of the market-name row bound to this commodity.','message','A commodity needs its official code (IMSBC BCSN, Grain Code entry or CSS category).')));

  n := n + public.fn_dq_seed_rule('DQ-D02', 'Regime and cargo type must agree', 'consistency', 'error', 'declarative', 'normalise', 'admin',
    'CSS ⇒ Break Bulk. GRAIN or IMSBC ⇒ Dry Bulk. The dictionary dialog derives cargo type from the regime and shows a red conflict on an impossible pair.',
    $$cross-field: (regime = CSS and cargo_type = Break Bulk) or (regime in (GRAIN, IMSBC) and cargo_type = Dry Bulk)$$,
    jsonb_build_array(
      jsonb_build_object('table','commodities','field','cargo_type','violation_sql',$$(r.regime = 'CSS' and r.cargo_type <> 'Break Bulk') or (r.regime in ('GRAIN','IMSBC') and r.cargo_type <> 'Dry Bulk')$$,
        'observed_sql',$$r.regime::text || ' · ' || r.cargo_type::text$$,'expected_sql',$$case when r.regime = 'CSS' then 'Break Bulk' else 'Dry Bulk' end$$,'fix_sql',$$case when r.regime = 'CSS' then 'Break Bulk' else 'Dry Bulk' end$$,'fix_rationale','Cargo type derived from the regime.','message','CSS ⇒ Break Bulk; GRAIN or IMSBC ⇒ Dry Bulk. The pair is impossible.'),
      jsonb_build_object('table','cargo_listings','field','cargo_type','violation_sql',$$(r.cargo_type = 'Break Bulk' and coalesce(r.is_grain_cargo, false)) or (r.css_category is not null and r.cargo_type = 'Dry Bulk')$$,
        'observed_sql',$$r.cargo_type::text || case when r.is_grain_cargo then ' · grain' else '' end || coalesce(' · ' || r.css_category, '')$$,'expected_sql',$$case when r.css_category is not null then 'Break Bulk' else 'is_grain_cargo false (bagged grain is CSS)' end$$,
        'message','Regime and cargo type disagree: CSS cargo is Break Bulk; a Break Bulk parcel is never GRAIN.')));

  n := n + public.fn_dq_seed_rule('DQ-D03', 'Finished steel is always break-bulk', 'classification', 'error', 'classification', 'reclassify', 'admin',
    '"Steel" as Dry Bulk is refused: coils are CSS-06, heavy metal products CSS-07. Scrap, borings and ore are excluded.',
    $$commodity ~ steel products and not (scrap|ore|borings) ⇒ cargo_type Break Bulk (CSS)$$,
    jsonb_build_array(
      jsonb_build_object('table','commodities','field','cargo_type','violation_sql',$$r.canonical_name ~* '(steel|\mcoils?\M|rebars?|billets?|slabs?|plates?|pipes?|wire rods?|\mhrc\M|\mcrc\M|beams?|profiles?)' and r.canonical_name !~* '(scrap|borings|turnings|shavings|\more\M|pellets|\mdri\M|\mhbi\M|sinter)' and r.cargo_type = 'Dry Bulk'$$,
        'expected_text','Break Bulk (CSS-06 coils · CSS-07 heavy metal products)','fix_sql',$$'Break Bulk'$$,'fix_rationale','Finished steel is never Dry Bulk.','message','Finished steel is break-bulk (CSS-06 / CSS-07), never Dry Bulk.'),
      jsonb_build_object('table','cargo_listings','field','cargo_type','violation_sql',$$r.commodity_name ~* '(steel|\mcoils?\M|rebars?|billets?|slabs?|plates?|pipes?|wire rods?|\mhrc\M|\mcrc\M|beams?)' and r.commodity_name !~* '(scrap|borings|turnings|shavings|\more\M|pellets|\mdri\M|\mhbi\M|sinter)' and r.cargo_type = 'Dry Bulk'$$,
        'expected_text','Break Bulk','fix_sql',$$'Break Bulk'$$,'fix_rationale','Finished steel is never Dry Bulk.','message','Finished steel is break-bulk (CSS-06 / CSS-07), never Dry Bulk.')));

  n := n + public.fn_dq_seed_rule('DQ-D04', 'Iron-ore family is IMSBC, never GRAIN', 'classification', 'error', 'classification', 'reclassify', 'admin',
    'Iron ore, fines, pellets, concentrates, DRI and HBI are IMSBC dry bulk; the GRAIN regime is impossible for them.',
    $$commodity ~ iron ore family ⇒ regime IMSBC, is_grain false, cargo_type Dry Bulk$$,
    jsonb_build_array(
      jsonb_build_object('table','commodities','field','regime','violation_sql',$$r.canonical_name ~* '(iron ore|iron fines|iron pellets|iron concentrate|\mdri\M|\mhbi\M|sinter feed|magnetite|hematite)' and (coalesce(r.is_grain, false) or r.regime = 'GRAIN' or r.cargo_type <> 'Dry Bulk')$$,
        'observed_sql',$$concat_ws(' · ', r.regime::text, r.cargo_type::text, case when r.is_grain then 'grain' end)$$,'expected_text','IMSBC · Dry Bulk','fix_sql',$$'IMSBC'$$,'fix_rationale','Iron-ore family is raw material under the IMSBC Code.','message','The iron-ore family is IMSBC and can never be GRAIN.'),
      jsonb_build_object('table','cargo_listings','field','is_grain_cargo','violation_sql',$$r.commodity_name ~* '(iron ore|iron fines|iron pellets|iron concentrate|\mdri\M|\mhbi\M|sinter)' and coalesce(r.is_grain_cargo, false)$$,
        'expected_text','false (IMSBC)','fix_sql',$$'false'$$,'fix_rationale','Iron ore is never grain.','message','The iron-ore family is IMSBC and can never be GRAIN.')));

  n := n + public.fn_dq_seed_rule('DQ-D05', 'GRAIN only for bulk items on the grain list', 'classification', 'error', 'classification', 'reclassify', 'admin',
    'Processed products — meal, cake, pellets, bran, flour, husks, feed — are never GRAIN; they are IMSBC SEED CAKE Group B. GRAIN applies only to grain-list items shipped in bulk.',
    $$is_grain ⇒ commodity in grain_list and not processed$$,
    jsonb_build_array(
      jsonb_build_object('table','commodities','field','is_grain','violation_sql',$$coalesce(r.is_grain, false) and (r.canonical_name ~* '(meal|cake|pellets?|bran|flour|husks?|hulls?|feed|screenings|dust)\M' or not exists (select 1 from public.grain_list g where g.is_active and lower(r.canonical_name) ~ ('\m' || lower(g.market_name) || '\M')))$$,
        'observed_sql',$$'is_grain true · ' || r.canonical_name$$,'expected_text','false — IMSBC SEED CAKE Group B for processed products','fix_sql',$$case when r.canonical_name ~* '(meal|cake|pellets?|bran|flour|husks?|hulls?|feed|screenings|dust)\M' then 'false' end$$,'fix_rationale','Processed product: SEED CAKE (B), not grain.','message','Processed products (meal, cake, pellets, bran) are never GRAIN.'),
      jsonb_build_object('table','cargo_listings','field','is_grain_cargo','violation_sql',$$coalesce(r.is_grain_cargo, false) and r.commodity_name ~* '(meal|cake|pellets?|bran|flour|husks?|hulls?|feed|screenings)\M'$$,
        'observed_sql',$$'GRAIN · ' || r.commodity_name$$,'expected_text','IMSBC SEED CAKE · Group B','fix_sql',$$'false'$$,'fix_rationale','Processed product: SEED CAKE (B), not grain.','message','Processed products (meal, cake, pellets, bran) are never GRAIN.')));

  n := n + public.fn_dq_seed_rule('DQ-D06', 'IMSBC group is A, B or C', 'validity', 'error', 'declarative', 'suggest only', 'admin',
    'A = may liquefy · B = chemical hazard · C = neither. "Non-DG" is not an IMSBC group; every IMSBC commodity carries one of the three.',
    $$regime = IMSBC ⇒ hazard_class in (A, B, C)$$,
    jsonb_build_array(jsonb_build_object('table','commodities','field','hazard_class','violation_sql',$$r.regime = 'IMSBC' and r.hazard_class is null$$,
      'observed_sql',$$'legacy category ' || coalesce(r.imsbc_category::text, '—')$$,'expected_text','A (may liquefy) · B (chemical hazard) · C (neither)',
      'fix_sql',$$(select case ic.imsbc_group when 'A' then 'A' when 'B' then 'B' when 'C' then 'C' end from public.imsbc_codes ic where ic.is_active and (lower(ic.bcsn) = lower(r.canonical_name) or lower(ic.bcsn) = lower(coalesce(r.official_code, ''))) limit 1)$$,'fix_confidence',0.9,'fix_rationale','Group of the matching BCSN in 3_IMSBC.','message','"Non-DG" is not an IMSBC group — choose A, B or C.')));

  n := n + public.fn_dq_seed_rule('DQ-D07', 'Hazard model: class + MHB + marine pollutant', 'consistency', 'warn', 'declarative', 'normalise', 'admin',
    'Replaces the container-world "Dangerous goods" checkbox. Hazard class (IMSBC A/B/C), an MHB flag and a marine-pollutant flag; UN number and IMO class only for packaged CSS cargo.',
    $$is_dg ⇒ hazard_class or is_mhb or is_marine_pollutant · un_number only when regime = CSS or the BCSN lists one$$,
    jsonb_build_array(
      jsonb_build_object('table','commodities','field','is_dg','violation_sql',$$(coalesce(r.is_dg, false) and r.hazard_class is null and not r.is_mhb and not r.is_marine_pollutant) or (r.un_number is not null and r.regime <> 'CSS' and not exists (select 1 from public.imsbc_codes ic where ic.un_number = r.un_number))$$,
        'observed_sql',$$concat_ws(' · ', case when r.is_dg then 'is_dg' end, 'class ' || coalesce(r.hazard_class, '—'), 'UN ' || r.un_number)$$,'expected_text','hazard class A/B/C · MHB · marine pollutant (UN no. only for packaged CSS)'),
      jsonb_build_object('table','cargo_listings','field','is_dg_cargo','violation_sql',$$coalesce(r.is_dg_cargo, false) and r.commodity_id is not null and exists (select 1 from public.commodities c where c.id = r.commodity_id and c.hazard_class is null and not c.is_mhb and not c.is_marine_pollutant)$$,
        'expected_text','a hazard class on the commodity (A/B/C, MHB, marine pollutant)')));

  -- ── ports registry ──
  n := n + public.fn_dq_seed_rule('DQ-R01', 'Port exists in the UN/LOCODE registry', 'referential', 'error', 'declarative', 'set from registry', 'built-in',
    'Every ports row has a matching code in unlocode_registry for the active release. Until a release is imported, the one-off enrichment (unlocode_status) stands in.',
    'foreign key: ports.locode → unlocode_registry.code',
    jsonb_build_array(jsonb_build_object('table','ports','field','locode','violation_sql',$$(exists (select 1 from public.unlocode_registry) and not exists (select 1 from public.unlocode_registry u where u.code = r.locode)) or (not exists (select 1 from public.unlocode_registry) and r.unlocode_status is null)$$,
      'observed_sql',$$'status ' || coalesce(r.unlocode_status, 'absent')$$,'expected_text','a code in the UN/LOCODE registry')));

  n := n + public.fn_dq_seed_rule('DQ-R02', 'Trading port carries seaport function 1 or an approved exception', 'compliance', 'warn', 'declarative', 'none', 'admin',
    'A port used for load, discharge or open position has function digit 1 (seaport) or an exception with a reason approved by an admin.',
    $$unlocode_function like '1%' or exception approved$$,
    jsonb_build_array(jsonb_build_object('table','ports','field','unlocode_function','violation_sql',
      $$coalesce((select u.function from public.unlocode_registry u where u.code = r.locode), r.unlocode_function, '') not like '1%'
        and not exists (select 1 from public.dq_port_exceptions e where e.locode = r.locode and e.status = 'approved')
        and (exists (select 1 from public.cargo_listings c where c.status in ('IN','PARTIAL') and (c.load_port_locode = r.locode or c.disch_port_locode = r.locode))
             or exists (select 1 from public.vessel_availability a where a.status = 'OPEN' and a.open_port_locode = r.locode))$$,
      'expected_text','function 1 (seaport) or an approved exception')));

  n := n + public.fn_dq_seed_rule('DQ-R03', 'Coordinates within tolerance of the registry', 'validity', 'warn', 'sql', 'set from registry', 'built-in',
    'Our coordinates lie within 25 km of the registry position.',
    $$select p.* from ports p join unlocode_registry u using (code) where haversine(p, u) > 25 km$$,
    jsonb_build_array(jsonb_build_object('table','ports','field','latitude','query_sql',
      $$select p.* from public.ports p join public.unlocode_registry u on u.code = p.locode where p.latitude is not null and u.lat is not null and 6371 * acos(least(1, cos(radians(p.latitude)) * cos(radians(u.lat)) * cos(radians(u.lng) - radians(p.longitude)) + sin(radians(p.latitude)) * sin(radians(u.lat)))) > 25$$,
      'observed_sql',$$r.latitude::text || ', ' || r.longitude::text$$,'expected_sql',$$(select u.lat::text || ', ' || u.lng::text from public.unlocode_registry u where u.code = r.locode)$$,
      'fix_sql',$$(select u.lat::text from public.unlocode_registry u where u.code = r.locode)$$,'fix_rationale','Registry latitude (longitude follows in a second fix).')));

  n := n + public.fn_dq_seed_rule('DQ-R04', 'Registry status adopted', 'validity', 'info', 'declarative', 'none', 'built-in',
    'Adopted codes start with A (AA, AI, AC, AF, AS…). Requested (RQ/RL/RN) codes are provisional; QQ entries are unverified.',
    $$unlocode_status like 'A%'$$,
    jsonb_build_array(jsonb_build_object('table','ports','field','unlocode_status','violation_sql',$$coalesce((select u.status from public.unlocode_registry u where u.code = r.locode), r.unlocode_status) is not null and coalesce((select u.status from public.unlocode_registry u where u.code = r.locode), r.unlocode_status) not like 'A%'$$,
      'observed_sql',$$coalesce((select u.status from public.unlocode_registry u where u.code = r.locode), r.unlocode_status)$$,'expected_text','AA · AI · AC · AF · AS (adopted)')));

  n := n + public.fn_dq_seed_rule('DQ-R05', 'Ranges and countries stay text', 'validity', 'info', 'declarative', 'none', 'admin',
    'A circular that says "Med / Black Sea range" or names a country is kept as text at info level; no LOCODE is forced.',
    'info: load_port_name without locode and unresolvable',
    jsonb_build_array(jsonb_build_object('table','cargo_listings','field','load_port_name','violation_sql',$$r.load_port_locode is null and r.load_port_name is not null and public.fn_resolve_port_locode(r.load_port_name) is null$$,
      'expected_text','kept as text (range or country) — info only')));

  -- ── freshness ──
  n := n + public.fn_dq_seed_rule('DQ-F01', 'Market freshness window (7 days)', 'freshness', 'info', 'sql', 'none', 'admin',
    'A listing untouched for 7 days leaves the live market and enters the archive ladder by tier (market_visibility).',
    $$select * from cargo_listings where status in ('IN','PARTIAL') and coalesce(refreshed_at, updated_at) < now() - interval '7 days'$$,
    jsonb_build_array(
      jsonb_build_object('table','cargo_listings','field','refreshed_at','query_sql',$$select c.* from public.cargo_listings c where c.status in ('IN','PARTIAL') and coalesce(c.refreshed_at, c.updated_at) < now() - interval '7 days'$$,
        'observed_sql',$$to_char(coalesce(r.refreshed_at, r.updated_at), 'DD Mon') || ' (' || (current_date - coalesce(r.refreshed_at, r.updated_at)::date) || ' d)'$$,'expected_text','refreshed within 7 days'),
      jsonb_build_object('table','vessel_availability','field','refreshed_at','query_sql',$$select a.* from public.vessel_availability a where a.status = 'OPEN' and coalesce(a.refreshed_at, a.updated_at) < now() - interval '7 days'$$,
        'observed_sql',$$to_char(coalesce(r.refreshed_at, r.updated_at), 'DD Mon') || ' (' || (current_date - coalesce(r.refreshed_at, r.updated_at)::date) || ' d)'$$,'expected_text','refreshed within 7 days')));

  -- ── business rules promoted from the matcher (evaluated at match time) ──
  n := n + public.fn_dq_seed_rule('DQ-M01', 'DWT within ±10 % of quantity (±20 % part cargo)', 'business rule', 'warn', 'declarative', 'none', 'admin',
    'Matching gate: a match needs DWT within tolerance of the cargo quantity and above the minimum. Evaluated per cargo–vessel pair by the match RPCs and lib/portal/matching.ts, not per row.',
    'cross-table: abs(dwt − qty) / qty ≤ (part_cargo ? 0.20 : 0.10) and dwt ≥ qty_min', '[]'::jsonb, array['cargo_listings','vessel_availability']);
  n := n + public.fn_dq_seed_rule('DQ-M02', 'Dry Bulk requires bulk carrier or general cargo', 'business rule', 'error', 'declarative', 'none', 'admin',
    'A Dry Bulk parcel matches only Bulk Carrier or General Cargo tonnage. Evaluated at match time.',
    $$cross-table: cargo_type = 'Dry Bulk' ⇒ vessel_type in ('Bulk Carrier','General Cargo')$$, '[]'::jsonb, array['cargo_listings','vessels']);
  n := n + public.fn_dq_seed_rule('DQ-M03', 'Gear and certificates as the cargo demands', 'business rule', 'error', 'declarative', 'none', 'admin',
    'Geared when the cargo requires it; grain-certified (booklet + DoA) for GRAIN; Group B / MHB fitness for IMSBC hazards. Evaluated at match time.',
    'cross-table: requires_geared ⇒ is_geared; is_grain ⇒ grain_certified; hazard B/MHB ⇒ dg_certified', '[]'::jsonb, array['cargo_listings','vessels']);
  n := n + public.fn_dq_seed_rule('DQ-M04', 'Draft limit', 'business rule', 'warn', 'declarative', 'none', 'admin',
    'Vessel draft within the cargo''s max draft at load and discharge. Evaluated at match time.',
    'cross-table: vessel.max_draft_m ≤ cargo.max_draft_m', '[]'::jsonb, array['cargo_listings','vessels','ports']);
  n := n + public.fn_dq_seed_rule('DQ-M05', 'Open date within laycan −21 / +14 days', 'business rule', 'warn', 'declarative', 'none', 'admin',
    'Position open date falls in the laycan window with the agreed slack. Evaluated at match time.',
    'cross-table: open_date between laycan_from − 21 and laycan_to + 14', '[]'::jsonb, array['cargo_listings','vessel_availability']);
  n := n + public.fn_dq_seed_rule('DQ-M06', 'Volume fit: quantity × stowage factor ≤ grain cubic', 'business rule', 'warn', 'declarative', 'none', 'admin',
    'The parcel must fit the vessel by volume, not only by weight (computeRequiredCbm). Evaluated at match time.',
    'cross-table: qty_max × stowage_factor ≤ vessel.grain_cbm', '[]'::jsonb, array['cargo_listings','vessels']);

  -- ── AI-assisted checks (evaluated on sampled rows in AI mode) ──
  n := n + public.fn_dq_seed_rule('DQ-AI01', 'Commodity text agrees with packaging, regime and quantity', 'classification', 'warn', 'ai', 'suggest only', 'admin',
    'The model reads the commodity text, packaging, cargo type and quantity together and flags contradictions the deterministic rules cannot see (e.g. "in bags" in the name with cargo type Dry Bulk, cbm quoted as tonnes, a grain name with a fertiliser stowage factor).',
    'AI: natural-language consistency check per sampled row', '[]'::jsonb, array['cargo_listings']);
  update public.dq_rules set ai_prompt = 'Read commodity_name, packaging_type, cargo_type, is_grain_cargo, stowage_factor and the quantity. Flag rows where the text contradicts the structured fields (packaging words vs cargo type, processed products flagged as grain, a stowage factor implausible for the commodity, volumes quoted as tonnes).' where code = 'DQ-AI01' and ai_prompt is null;
  n := n + public.fn_dq_seed_rule('DQ-AI02', 'Vessel particulars are plausible for the type', 'validity', 'warn', 'ai', 'suggest only', 'admin',
    'The model checks that DWT, cubic, LOA, draft and build year are plausible together for the vessel type (e.g. a 5,000 dwt bulk carrier with 70,000 cbm grain).',
    'AI: plausibility of particulars', '[]'::jsonb, array['vessels']);
  update public.dq_rules set ai_prompt = 'Check dwt_grain, grain_cbm, bale_cbm, max_loa_m, max_draft_m, build_year and vessel_type for physical plausibility (cubic/dwt ratio roughly 1.1–1.5 for bulk carriers, draft vs dwt, LOA vs dwt). Flag implausible combinations with the field most likely wrong.' where code = 'DQ-AI02' and ai_prompt is null;

  -- channel modes the design calls out (everything else uses the severity default)
  insert into public.dq_rule_channels (rule_id, channel, mode)
  select r.id, 'forms', 'block' from public.dq_rules r where r.code = 'DQ-V04'
  on conflict do nothing;
  insert into public.dq_rule_channels (rule_id, channel, mode)
  select r.id, ch, 'warn' from public.dq_rules r cross join unnest(array['sync','pipeline']) ch where r.code in ('DQ-C05','DQ-A01','DQ-C04','DQ-D01','DQ-R01')
  on conflict do nothing;
  return n;
end $seed$;

select public.fn_dq_seed_rules();

-- ── grants: everything mutating is service-role only (server actions after requireAdmin) ──
do $$
declare f text;
begin
  foreach f in array array[
    'fn_dq_estimate_scope(jsonb, integer)', 'fn_dq_prepare_run(uuid)', 'fn_dq_process_batch(uuid)', 'fn_dq_finish_run(uuid, text, text)',
    'fn_dq_health()', 'fn_dq_snapshot_health()', 'fn_dq_sample_rows(text, text, text, integer, jsonb)', 'fn_dq_row_snapshot(text, text)',
    'dq_save_rule(jsonb, uuid, text, text)', 'fn_dq_rule_preview(uuid, text, integer)', 'fn_dq_rule_cost(uuid)',
    'fn_dq_validate(text, jsonb, text, text, uuid, boolean)', 'dq_apply_fix(uuid, uuid, text, text, text)', 'dq_undo_fix(uuid, uuid)',
    'fn_dq_port_drift()', 'fn_dq_seed_rules()', 'fn_dq_seed_rule(text, text, text, text, text, text, text, text, text, jsonb, text[])'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
grant execute on function public.fn_dq_imo_valid(text) to authenticated, anon, service_role;
grant execute on function public.fn_dq_effective_mode(uuid, text) to authenticated, service_role;
