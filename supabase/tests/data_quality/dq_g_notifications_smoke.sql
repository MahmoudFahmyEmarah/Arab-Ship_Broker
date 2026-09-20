-- Data Quality · workstream G smoke test (19 Sep 2026, amended 20 Sep)
-- for 20260919160000_dq_g_notifications.sql. BEGIN … ROLLBACK.
--   S1 enqueue is idempotent on the key                  S4 back-off grows and is capped; max attempts → failed; requeue
--   S2 claim leases the row; a lapsed lease is claimable  S5 a finished run and a failed run are enqueued by settlement
--   S3 sent only when the worker says so; a foreign      S6 one nightly run per day (schedule_key unique)
--      token cannot settle

begin;

do $$
declare o public.dq_notification_outbox%rowtype; o2 public.dq_notification_outbox%rowtype; n int; v_id bigint; v_run uuid; v_rule uuid; v_step jsonb; i int; v_next timestamptz;
begin
  -- ── S1 ────────────────────────────────────────────────────────────────────
  -- This suite asserts that the FIRST claim returns its own row, so it has to
  -- own the queue. Locally each suite runs in its own transaction and starts
  -- empty; the linked harness runs every suite inside ONE transaction, so the
  -- rows earlier suites enqueued (a settled run enqueues 'run/<id>') are still
  -- there and are claimed first, by id. Found by the linked dry run on
  -- 21 Sep 2026 -- the local run cannot produce it.
  delete from public.dq_notification_outbox;

  if not public.fn_dq_outbox_enqueue('run_finished', 'smoke/run-1', '{"run_id": "x"}'::jsonb) then raise exception 'S1: first enqueue should insert'; end if;
  if public.fn_dq_outbox_enqueue('run_finished', 'smoke/run-1', '{"run_id": "x"}'::jsonb) then raise exception 'S1: second enqueue with the same key must be a no-op'; end if;
  select * into o from public.dq_notification_outbox where idem_key = 'smoke/run-1';
  if o.status <> 'queued' or o.attempts <> 0 then raise exception 'S1: wrong initial state %', o.status; end if;
  begin
    perform public.fn_dq_outbox_enqueue('bogus', 'smoke/bogus', '{}'::jsonb);
    raise exception 'S1: an unknown kind was accepted';
  exception when check_violation then null;
  end;

  -- ── S2 · claim ────────────────────────────────────────────────────────────
  select * into o from public.fn_dq_outbox_claim(10, 60);
  if o.idem_key <> 'smoke/run-1' or o.status <> 'sending' or o.claim_token is null or o.attempts <> 1 then raise exception 'S2: claim wrong: % % %', o.status, o.claim_token, o.attempts; end if;
  select count(*) into n from public.fn_dq_outbox_claim(10, 60);
  if n <> 0 then raise exception 'S2: a leased row was claimed again'; end if;
  update public.dq_notification_outbox set lease_until = now() - interval '1 second' where id = o.id;
  select * into o2 from public.fn_dq_outbox_claim(10, 60);
  if o2.id <> o.id or o2.attempts <> 2 or o2.claim_token = o.claim_token then raise exception 'S2: a lapsed lease was not reclaimed with a new token'; end if;

  -- ── S3 · settle ───────────────────────────────────────────────────────────
  if public.fn_dq_outbox_settle(o2.id, gen_random_uuid(), true, null, null) then raise exception 'S3: a foreign token settled the row'; end if;
  if (select status from public.dq_notification_outbox where id = o2.id) <> 'sending' then raise exception 'S3: foreign settle changed the status'; end if;
  if not public.fn_dq_outbox_settle(o2.id, o2.claim_token, false, 'SMTP connect ECONNREFUSED', array['ops@example.com']) then raise exception 'S3: failed settle refused'; end if;
  select * into o from public.dq_notification_outbox where id = o2.id;
  if o.status <> 'queued' or o.last_error not like 'SMTP%' or o.next_attempt_at <= now() or o.sent_at is not null then raise exception 'S3: after a failed send the row must be queued for later: % % %', o.status, o.next_attempt_at, o.last_error; end if;
  select count(*) into n from public.fn_dq_outbox_claim(10, 60);
  if n <> 0 then raise exception 'S3: a row waiting for its back-off was claimed'; end if;
  update public.dq_notification_outbox set next_attempt_at = now() where id = o.id;
  select * into o2 from public.fn_dq_outbox_claim(10, 60);
  if o2.id <> o.id or o2.attempts <> 3 then raise exception 'S3: due row not claimed for the retry'; end if;
  if not public.fn_dq_outbox_settle(o2.id, o2.claim_token, true, null, array['ops@example.com']) then raise exception 'S3: ok settle refused'; end if;
  select * into o from public.dq_notification_outbox where id = o.id;
  if o.status <> 'sent' or o.sent_at is null or o.last_error is not null or o.claim_token is not null then raise exception 'S3: sent state wrong'; end if;

  -- ── S4 · back-off and the attempt cap ─────────────────────────────────────
  perform public.fn_dq_outbox_enqueue('digest', 'smoke/digest-1', '{}'::jsonb);
  select id into v_id from public.dq_notification_outbox where idem_key = 'smoke/digest-1';
  for i in 1..8 loop
    update public.dq_notification_outbox set next_attempt_at = now(), lease_until = null, status = 'queued' where id = v_id;
    select * into o2 from public.fn_dq_outbox_claim(10, 60);
    if o2.id is distinct from v_id then raise exception 'S4: claim % returned %', i, o2.id; end if;
    perform public.fn_dq_outbox_settle(o2.id, o2.claim_token, false, 'boom ' || i, null);
    select * into o from public.dq_notification_outbox where id = v_id;
    if i < 8 then
      if o.status <> 'queued' then raise exception 'S4: attempt % should leave the row queued, got %', i, o.status; end if;
      v_next := now() + make_interval(mins => least(power(2, i)::int, 240));
      if o.next_attempt_at < v_next - interval '5 seconds' or o.next_attempt_at > v_next + interval '5 seconds' then raise exception 'S4: back-off after attempt % is %, expected about %', i, o.next_attempt_at, v_next; end if;
    end if;
  end loop;
  if o.status <> 'failed' or o.attempts <> 8 then raise exception 'S4: after 8 attempts the row must be failed, got % (%)', o.status, o.attempts; end if;
  if not public.fn_dq_outbox_requeue(v_id) then raise exception 'S4: requeue refused'; end if;
  select * into o from public.dq_notification_outbox where id = v_id;
  if o.status <> 'queued' or o.attempts <> 0 then raise exception 'S4: requeue wrong'; end if;

  -- ── S5 · settlement enqueues, inside its own transaction ──────────────────
  v_rule := (public.dq_save_rule(jsonb_build_object('code', 'DQ-SMKG', 'name', 'smoke g', 'severity', 'info', 'kind', 'declarative', 'enabled', true, 'tables', jsonb_build_array('ports'),
    'checks', jsonb_build_array(jsonb_build_object('table', 'ports', 'field', 'trade_name', 'violation_sql', 'false', 'message', 'smoke'))), null, 'smoke', 'smoke')->>'id')::uuid;
  insert into public.dq_runs (scope, mode, batch_size, rule_ids, started_by_name) values ('{"kind":"tables","tables":["ports"]}', 'rules', 1000, array[v_rule], 'smoke') returning id into v_run;
  perform public.fn_dq_prepare_run(v_run);
  loop v_step := public.fn_dq_process_batch(v_run); exit when (v_step->>'done')::boolean; end loop;
  select * into o from public.dq_notification_outbox where idem_key = 'run/' || v_run::text;
  if o.id is null or o.kind <> 'run_finished' or (o.payload->>'run_id')::uuid <> v_run then raise exception 'S5: the completed run was not enqueued'; end if;
  insert into public.dq_runs (scope, mode, batch_size, rule_ids, started_by_name, status) values ('{"kind":"tables","tables":["ports"]}', 'rules', 1000, array[v_rule], 'smoke', 'running') returning id into v_run;
  perform public.fn_dq_finish_run(v_run, 'failed', 'smoke failure');
  if not exists (select 1 from public.dq_notification_outbox where idem_key = 'run/' || v_run::text and payload->>'status' = 'failed') then raise exception 'S5: the failed run was not enqueued'; end if;

  -- ── S6 · one nightly run per day ─────────────────────────────────────────
  insert into public.dq_runs (scope, mode, batch_size, started_by_name, trigger, schedule_key) values ('{"kind":"db"}', 'rules', 1000, 'smoke', 'scheduler', 'nightly/2099-01-01');
  begin
    insert into public.dq_runs (scope, mode, batch_size, started_by_name, trigger, schedule_key) values ('{"kind":"db"}', 'rules', 1000, 'smoke', 'scheduler', 'nightly/2099-01-01');
    raise exception 'S6: a second run with the same schedule key was accepted';
  exception when unique_violation then null;
  end;

  -- ── S7 · an abandoned claim is given up at the cap (21 Sep 2026) ─────────
  -- The attempt is counted at CLAIM time, so a worker that crashes mid-send
  -- does spend its budget rather than retrying free of charge. But only
  -- fn_dq_outbox_settle used to mark a row failed at the cap — and a crashed
  -- worker never settles, so the row was re-claimed for ever: attempts
  -- climbing past eight with nothing to stop it and nothing in the console to
  -- show it had given up. The cap now lives on the claim as well.
  perform public.fn_dq_outbox_enqueue('digest', 'smoke/abandoned', '{}'::jsonb);
  select id into v_id from public.dq_notification_outbox where idem_key = 'smoke/abandoned';

  -- eight invocations that claim and then die: the lease is one second, so
  -- the next claim always finds the row reclaimable
  for i in 1..8 loop
    perform public.fn_dq_outbox_claim(10, 15, 8);
    update public.dq_notification_outbox set lease_until = now() - interval '1 second' where id = v_id;
  end loop;
  select * into o from public.dq_notification_outbox where id = v_id;
  if o.attempts > 8 then raise exception 'S7: a crashing worker exceeded the cap (% attempts)', o.attempts; end if;

  -- the ninth claim must not hand the row out again; it must give up on it
  perform public.fn_dq_outbox_claim(10, 15, 8);
  select * into o from public.dq_notification_outbox where id = v_id;
  if o.status <> 'failed' then
    raise exception 'S7: an abandoned row was claimed again instead of being given up (status %, % attempts)', o.status, o.attempts;
  end if;
  if o.last_error is null or position('abandoned after' in o.last_error) = 0 then
    raise exception 'S7: the row gives no reason an administrator can read: %', o.last_error;
  end if;
  if o.claim_token is not null then raise exception 'S7: a failed row still holds a claim token'; end if;

  -- and a row well inside its budget is still claimed normally
  perform public.fn_dq_outbox_enqueue('digest', 'smoke/healthy', '{}'::jsonb);
  select count(*) into n from public.fn_dq_outbox_claim(10, 600, 8);
  if n < 1 then raise exception 'S7: the cap on the claim stopped a healthy row being claimed'; end if;

  raise notice 'DQ G SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
