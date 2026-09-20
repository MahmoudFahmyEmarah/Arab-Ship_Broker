-- ════════════════════════════════════════════════════════════════════════
-- Data Quality · workstream F — performance (19 Sep 2026, amended 20 Sep;
-- audit finding 12; re-audit: AI reservation leaks, one-transaction retention)
--
--   trigram indexes      on the issue columns the Issues search reads with
--                        %term% (replaced by one search_text index in H);
--                        plus (rule_code, status) for the rule stats
--   fn_dq_open_by_severity   one grouped count for the Overview instead of a
--                        download of every open issue's severity
--   AI reservations      dq_ai_reservations: one row per batch AI step, with
--                        a reservation id, an idempotency key, a lease and a
--                        status. The budget is reserved BEFORE the provider is
--                        called (row lock on the day's usage), settled with
--                        the tokens actually used, released on failure, and
--                        RECLAIMED when the lease expires — a process that
--                        dies after reserving no longer blocks the day.
--                        dq_settings.ai_max_output_tokens caps the provider's
--                        output so a reservation is an upper bound.
--   fn_dq_retention      deletes ONE bounded slice per call and answers
--                        more = true while a backlog remains; the cron calls
--                        again, each call its own short transaction.
-- Idempotent. DOWN: supabase/rollback/20260919_dq_f_down.sql
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';
set local statement_timeout = '10min';

create extension if not exists pg_trgm with schema extensions;

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
create index if not exists dq_issues_rule_status_idx on public.dq_issues (rule_code, status);

create or replace function public.fn_dq_open_by_severity(p_table text default null)
 returns jsonb language sql stable security definer set search_path to ''
as $$
  select jsonb_build_object(
    'error', count(*) filter (where severity = 'error'),
    'warn',  count(*) filter (where severity = 'warn'),
    'info',  count(*) filter (where severity = 'info'))
  from public.dq_issues where status = 'open' and (p_table is null or table_name = p_table);
$$;

-- ── AI budget: reservations with a lease ────────────────────────────────────
alter table public.dq_ai_usage add column if not exists reserved bigint not null default 0;
alter table public.dq_run_batches add column if not exists ai_state text check (ai_state is null or ai_state in ('reserved', 'done', 'failed', 'skipped'));
alter table public.dq_settings add column if not exists ai_max_output_tokens integer not null default 4096;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dq_settings_ai_output_ck') then
    alter table public.dq_settings add constraint dq_settings_ai_output_ck check (ai_max_output_tokens between 256 and 32000);
  end if;
end $$;
comment on column public.dq_settings.ai_max_output_tokens is 'Provider output-token cap for one AI review call; part of what a reservation covers.';

create table if not exists public.dq_ai_reservations (
  id              uuid primary key default gen_random_uuid(),
  idem_key        text not null unique,
  batch_id        uuid,
  day             date not null default current_date,
  tokens          integer not null,
  status          text not null default 'reserved' check (status in ('reserved', 'settled', 'released', 'expired')),
  lease_until     timestamptz not null,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz,
  settled_tokens  integer,
  settled_cost    numeric(10,4),
  note            text
);
create index if not exists dq_ai_reservations_open_idx on public.dq_ai_reservations (lease_until) where status = 'reserved';
alter table public.dq_ai_reservations enable row level security;
grant select on public.dq_ai_reservations to service_role;
comment on table public.dq_ai_reservations is 'One row per batch AI step: reserved before the provider call, settled with real usage, released on failure, expired when the lease lapses.';

-- Reservations whose lease lapsed with no settlement: the process died. Give
-- the tokens back to the day so the budget is not blocked.
create or replace function public.fn_dq_reclaim_ai()
 returns integer language plpgsql security definer set search_path to ''
as $$
declare n int := 0; r record;
begin
  for r in select * from public.dq_ai_reservations where status = 'reserved' and lease_until < now() for update skip locked loop
    update public.dq_ai_usage set reserved = greatest(reserved - r.tokens, 0) where day = r.day;
    update public.dq_ai_reservations set status = 'expired', note = 'lease expired without settlement' where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- {ok, reservation_id, reserved, left}: reserves p_tokens for p_idem_key under
-- the day's row lock. The same key reserved again while its reservation is
-- open returns the same reservation (idempotent); once settled it refuses.
create or replace function public.fn_dq_reserve_ai(p_tokens integer, p_idem_key text, p_batch_id uuid default null, p_ttl_seconds integer default 600)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare v_cap bigint; v_used bigint; v_res bigint; v_id uuid; v_existing public.dq_ai_reservations%rowtype;
        v_ttl interval := make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 600), 3600)));
begin
  if p_idem_key is null or btrim(p_idem_key) = '' then raise exception 'fn_dq_reserve_ai: an idempotency key is required' using errcode = '22023'; end if;
  perform public.fn_dq_reclaim_ai();
  select ai_daily_tokens into v_cap from public.dq_settings where id = 1;
  insert into public.dq_ai_usage (day) values (current_date) on conflict (day) do nothing;
  select tokens, reserved into v_used, v_res from public.dq_ai_usage where day = current_date for update;
  select * into v_existing from public.dq_ai_reservations where idem_key = p_idem_key;
  if found then
    if v_existing.status = 'reserved' then
      update public.dq_ai_reservations set lease_until = now() + v_ttl where id = v_existing.id;
      return jsonb_build_object('ok', true, 'reservation_id', v_existing.id, 'reserved', v_existing.tokens, 'left', coalesce(v_cap, 0) - v_used - v_res, 'existing', true);
    end if;
    return jsonb_build_object('ok', false, 'reservation_id', v_existing.id, 'reserved', 0, 'left', greatest(coalesce(v_cap, 0) - v_used - v_res, 0), 'status', v_existing.status);
  end if;
  if v_used + v_res + p_tokens > coalesce(v_cap, 0) then
    return jsonb_build_object('ok', false, 'reservation_id', null, 'reserved', 0, 'left', greatest(coalesce(v_cap, 0) - v_used - v_res, 0));
  end if;
  insert into public.dq_ai_reservations (idem_key, batch_id, tokens, lease_until) values (p_idem_key, p_batch_id, p_tokens, now() + v_ttl) returning id into v_id;
  update public.dq_ai_usage set reserved = reserved + p_tokens where day = current_date;
  return jsonb_build_object('ok', true, 'reservation_id', v_id, 'reserved', p_tokens, 'left', coalesce(v_cap, 0) - v_used - v_res - p_tokens);
end $$;

-- Settle with what the provider actually used; the reservation is closed and
-- its tokens given back. Idempotent: a settled reservation is not settled twice.
create or replace function public.fn_dq_settle_ai(p_reservation uuid, p_tokens integer, p_cost numeric)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare r public.dq_ai_reservations%rowtype; v_out jsonb; v_cap bigint;
begin
  select * into r from public.dq_ai_reservations where id = p_reservation for update;
  if not found then raise exception 'reservation % not found', p_reservation using errcode = 'P0002'; end if;
  if r.status <> 'reserved' then return jsonb_build_object('ok', false, 'status', r.status); end if;
  insert into public.dq_ai_usage (day, tokens, cost, calls, reserved)
  values (r.day, p_tokens, p_cost, 1, 0)
  on conflict (day) do update
    set tokens   = public.dq_ai_usage.tokens + excluded.tokens,
        cost     = public.dq_ai_usage.cost + excluded.cost,
        calls    = public.dq_ai_usage.calls + 1,
        reserved = greatest(public.dq_ai_usage.reserved - r.tokens, 0)
  returning jsonb_build_object('day', day, 'tokens', tokens, 'cost', cost, 'calls', calls, 'reserved', reserved) into v_out;
  update public.dq_ai_reservations set status = 'settled', settled_at = now(), settled_tokens = p_tokens, settled_cost = p_cost where id = r.id;
  -- the 80 % notice, once per day, through the outbox when it exists (workstream G)
  select ai_daily_tokens into v_cap from public.dq_settings where id = 1;
  if coalesce(v_cap, 0) > 0 and (v_out->>'tokens')::bigint >= v_cap * 0.8 and to_regclass('public.dq_notification_outbox') is not null then
    perform public.fn_dq_outbox_enqueue('budget80', 'budget80/' || r.day::text, jsonb_build_object('day', r.day, 'tokens', (v_out->>'tokens')::bigint, 'cap', v_cap));
  end if;
  return v_out || jsonb_build_object('ok', true);
end $$;

-- A reservation nothing was metered against (provider failed): give it back.
create or replace function public.fn_dq_release_ai(p_reservation uuid)
 returns boolean language plpgsql security definer set search_path to ''
as $$
declare r public.dq_ai_reservations%rowtype;
begin
  select * into r from public.dq_ai_reservations where id = p_reservation for update;
  if not found or r.status <> 'reserved' then return false; end if;
  update public.dq_ai_usage set reserved = greatest(reserved - r.tokens, 0) where day = r.day;
  update public.dq_ai_reservations set status = 'released' where id = r.id;
  return true;
end $$;

-- ── retention: one bounded slice per call ──────────────────────────────────
-- Each call deletes at most p_slice rows per category and says whether more
-- remains; the cron loops, each call a separate short transaction, so no lock
-- outlives one slice.
create or replace function public.fn_dq_retention(p_issue_days integer default 90, p_gate_days integer default 30, p_snapshot_days integer default 180, p_slice integer default 5000)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare a int := 0; b int := 0; c int := 0; d int := 0; e int := 0; v_slice int := greatest(100, least(coalesce(p_slice, 5000), 20000)); v_more boolean := false;
begin
  delete from public.dq_issues where id in (
    select id from public.dq_issues where status <> 'open' and coalesce(resolved_at, last_seen) < now() - make_interval(days => p_issue_days) limit v_slice);
  get diagnostics a = row_count; v_more := v_more or a >= v_slice;
  delete from public.dq_gate_log where id in (
    select id from public.dq_gate_log where at < now() - make_interval(days => p_gate_days) limit v_slice);
  get diagnostics b = row_count; v_more := v_more or b >= v_slice;
  delete from public.dq_health_snapshots where (table_name, at) in (
    select table_name, at from public.dq_health_snapshots where at < now() - make_interval(days => p_snapshot_days) limit v_slice);
  get diagnostics c = row_count; v_more := v_more or c >= v_slice;
  delete from public.dq_run_rule_keys k where (k.run_id, k.rule_id, k.check_idx, k.key) in (
    select k2.run_id, k2.rule_id, k2.check_idx, k2.key from public.dq_run_rule_keys k2 join public.dq_runs r on r.id = k2.run_id
     where r.status not in ('queued', 'running', 'paused') and coalesce(r.finished_at, r.created_at) < now() - interval '7 days' limit v_slice);
  get diagnostics d = row_count; v_more := v_more or d >= v_slice;
  delete from public.dq_run_keys k where (k.run_id, k.table_name, k.key) in (
    select k2.run_id, k2.table_name, k2.key from public.dq_run_keys k2 join public.dq_runs r on r.id = k2.run_id
     where r.status not in ('queued', 'running', 'paused') and coalesce(r.finished_at, r.created_at) < now() - interval '7 days' limit v_slice);
  get diagnostics e = row_count; v_more := v_more or e >= v_slice;
  return jsonb_build_object('issues', a, 'gate_log', b, 'snapshots', c, 'run_keys', d + e, 'more', v_more);
end $function$;

revoke all on function public.fn_dq_open_by_severity(text) from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_reclaim_ai() from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_reserve_ai(integer, text, uuid, integer) from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_settle_ai(uuid, integer, numeric) from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_release_ai(uuid) from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_retention(integer, integer, integer, integer) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_open_by_severity(text), public.fn_dq_reclaim_ai(), public.fn_dq_reserve_ai(integer, text, uuid, integer), public.fn_dq_settle_ai(uuid, integer, numeric), public.fn_dq_release_ai(uuid), public.fn_dq_retention(integer, integer, integer, integer) to service_role;
-- the three-argument retention of workstream C is superseded by the sliced one
drop function if exists public.fn_dq_retention(integer, integer, integer);
