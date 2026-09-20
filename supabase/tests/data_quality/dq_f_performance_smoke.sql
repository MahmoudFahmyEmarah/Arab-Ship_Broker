-- Data Quality · workstream F smoke test (19 Sep 2026, amended 20 Sep)
-- for 20260919150000_dq_f_performance.sql. BEGIN … ROLLBACK.
--   S1 grouped severities equal the row-by-row count
--   S2 reservations: cap, idempotency key, settle with real usage, release,
--      lease expiry reclaimed, a settled reservation refuses a second settle
--   S3 retention deletes one bounded slice per call and says when more waits

begin;

do $$
declare v jsonb; v_manual jsonb; v_id uuid; v_id2 uuid; n int; v_res jsonb; v_calls int := 0;
begin
  -- ── S1 ────────────────────────────────────────────────────────────────────
  v := public.fn_dq_open_by_severity(null);
  select jsonb_build_object('error', count(*) filter (where severity = 'error'), 'warn', count(*) filter (where severity = 'warn'), 'info', count(*) filter (where severity = 'info'))
    into v_manual from public.dq_issues where status = 'open';
  if v <> v_manual then raise exception 'S1: grouped % differs from manual %', v, v_manual; end if;

  -- ── S2 · reservations ─────────────────────────────────────────────────────
  update public.dq_settings set ai_daily_tokens = 1000 where id = 1;
  delete from public.dq_ai_reservations where day = current_date;
  delete from public.dq_ai_usage where day = current_date;
  v := public.fn_dq_reserve_ai(600, 'smoke/k1', null, 600);
  if not (v->>'ok')::boolean or (v->>'left')::int <> 400 or (v->>'reservation_id') is null then raise exception 'S2: first reservation wrong: %', v; end if;
  v_id := (v->>'reservation_id')::uuid;
  v := public.fn_dq_reserve_ai(600, 'smoke/k2', null, 600);
  if (v->>'ok')::boolean then raise exception 'S2: second reservation should exceed the cap: %', v; end if;
  -- the same key again is the same reservation, not a second one
  v := public.fn_dq_reserve_ai(600, 'smoke/k1', null, 600);
  if not (v->>'ok')::boolean or (v->>'reservation_id')::uuid <> v_id or not (v->>'existing')::boolean then raise exception 'S2: idempotent re-reserve wrong: %', v; end if;
  if (select reserved from public.dq_ai_usage where day = current_date) <> 600 then raise exception 'S2: idempotent re-reserve doubled the reservation'; end if;
  -- settle with 350 actual tokens: the 600 comes back, usage is 350
  v := public.fn_dq_settle_ai(v_id, 350, 0.001);
  if not (v->>'ok')::boolean or (v->>'tokens')::int <> 350 or (v->>'reserved')::int <> 0 then raise exception 'S2: settle wrong: %', v; end if;
  if (select status from public.dq_ai_reservations where id = v_id) <> 'settled' then raise exception 'S2: reservation not marked settled'; end if;
  v := public.fn_dq_settle_ai(v_id, 350, 0.001);
  if (v->>'ok')::boolean then raise exception 'S2: a settled reservation was settled twice'; end if;
  v := public.fn_dq_reserve_ai(600, 'smoke/k3', null, 600);
  if not (v->>'ok')::boolean or (v->>'left')::int <> 50 then raise exception 'S2: after settling, 650 should remain reservable: %', v; end if;
  if not public.fn_dq_release_ai((v->>'reservation_id')::uuid) then raise exception 'S2: release refused'; end if;
  if (select reserved from public.dq_ai_usage where day = current_date) <> 0 then raise exception 'S2: release did not clear the reservation'; end if;
  -- a process that died after reserving: the lease lapses and the tokens come back
  v := public.fn_dq_reserve_ai(500, 'smoke/k4', null, 60);
  v_id2 := (v->>'reservation_id')::uuid;
  update public.dq_ai_reservations set lease_until = now() - interval '1 second' where id = v_id2;
  n := public.fn_dq_reclaim_ai();
  if n <> 1 or (select status from public.dq_ai_reservations where id = v_id2) <> 'expired' then raise exception 'S2: expired reservation not reclaimed (%)', n; end if;
  if (select reserved from public.dq_ai_usage where day = current_date) <> 0 then raise exception 'S2: reclaim did not free the budget'; end if;
  v := public.fn_dq_settle_ai(v_id2, 100, 0.0001);
  if (v->>'ok')::boolean then raise exception 'S2: an expired reservation accepted a settlement'; end if;
  -- the 80 % notice lands in the outbox once (workstream G) when usage crosses the line
  v := public.fn_dq_reserve_ai(300, 'smoke/k5', null, 600);
  perform public.fn_dq_settle_ai((v->>'reservation_id')::uuid, 500, 0.002);   -- 350 + 500 = 850 ≥ 800
  if to_regclass('public.dq_notification_outbox') is not null then
    select count(*) into n from public.dq_notification_outbox where idem_key = 'budget80/' || current_date::text;
    if n <> 1 then raise exception 'S2: expected one budget80 notification, got %', n; end if;
    v := public.fn_dq_reserve_ai(50, 'smoke/k6', null, 600);
    perform public.fn_dq_settle_ai((v->>'reservation_id')::uuid, 50, 0.0001);
    select count(*) into n from public.dq_notification_outbox where idem_key = 'budget80/' || current_date::text;
    if n <> 1 then raise exception 'S2: the budget80 notification was enqueued twice'; end if;
  end if;

  -- ── S3 · retention: one slice per call, more = true until the backlog is gone ─
  insert into public.dq_gate_log (channel, rule_code, table_name, mode, message, at)
  select 'forms', 'DQ-SMK', 'ports', 'warn', 'smoke', now() - interval '60 days' from generate_series(1, 12000);
  v_res := public.fn_dq_retention(90, 30, 180, 5000);
  if (v_res->>'gate_log')::int <> 5000 or not (v_res->>'more')::boolean then raise exception 'S3: first slice wrong: %', v_res; end if;
  select count(*) into n from public.dq_gate_log where message = 'smoke';
  if n <> 7000 then raise exception 'S3: after one slice % rows remain, expected 7000', n; end if;
  loop
    v_res := public.fn_dq_retention(90, 30, 180, 5000); v_calls := v_calls + 1;
    exit when not (v_res->>'more')::boolean or v_calls > 10;
  end loop;
  select count(*) into n from public.dq_gate_log where message = 'smoke';
  if n <> 0 then raise exception 'S3: % smoke gate-log rows survived retention', n; end if;
  if v_calls <> 2 then raise exception 'S3: expected 2 more calls to drain 7,000 rows in slices of 5,000, made %', v_calls; end if;

  raise notice 'DQ F SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
