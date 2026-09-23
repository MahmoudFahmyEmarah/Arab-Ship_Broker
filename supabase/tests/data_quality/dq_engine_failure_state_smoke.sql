-- Data Quality · durable engine-failure state (21 Sep 2026)
-- for fn_dq_run_note_error / fn_dq_run_clear_errors in
-- 20260919130000_dq_c_run_integrity.sql. BEGIN … ROLLBACK.
--
-- The defect: driveRun counted consecutive engine failures in a JavaScript
-- Map keyed by run id. A serverless invocation shares no memory with the next
-- one, so the count restarted at zero on every cold start and the "stop after
-- three" limit never bound — a permanently broken run could be re-kicked for
-- ever, each invocation believing it was the first to fail.
--
--   E1  the count survives the invocation: three SEPARATE calls, as three
--       separate invocations would make them, reach the limit
--   E2  the increment is atomic — two concurrent-style calls cannot both read
--       the same number and both think they are the first
--   E3  give_up is reported exactly once, at the threshold, and the error is
--       retained on the run
--   E4  a successful batch clears the streak, and only then
--   E5  the threshold is configurable, and the count is per-run
--   E6  inputs are validated and the functions are service-role only

begin;

do $$
declare
  v_run  uuid;
  v_run2 uuid;
  v_res  jsonb;
  r      public.dq_runs%rowtype;
  v_ok   boolean;
  n      int;
begin
  insert into public.dq_runs (scope, mode, batch_size, started_by_name)
  values ('{"kind":"tables","tables":["ports"]}', 'rules', 100, 'smoke')
  returning id into v_run;

  select * into r from public.dq_runs where id = v_run;
  if r.consecutive_errors <> 0 then raise exception 'E1: a new run starts at % errors', r.consecutive_errors; end if;

  -- ── E1 · three separate calls reach the limit ────────────────────────────
  -- Each call is what one serverless invocation does before returning. The
  -- old in-memory counter would have answered 1, 1, 1.
  v_res := public.fn_dq_run_note_error(v_run, 'connection reset by peer', 3);
  if (v_res->>'consecutive_errors')::int <> 1 or (v_res->>'give_up')::boolean then raise exception 'E1: first failure wrong: %', v_res; end if;
  v_res := public.fn_dq_run_note_error(v_run, 'connection reset by peer', 3);
  if (v_res->>'consecutive_errors')::int <> 2 or (v_res->>'give_up')::boolean then raise exception 'E1: second failure wrong: %', v_res; end if;
  v_res := public.fn_dq_run_note_error(v_run, 'connection reset by peer', 3);
  if (v_res->>'consecutive_errors')::int <> 3 then raise exception 'E1: third failure wrong: %', v_res; end if;
  if not (v_res->>'give_up')::boolean then raise exception 'E1: the third failure in a row must say give_up: %', v_res; end if;

  -- ── E2 · the number came from the row, not from the caller ───────────────
  select * into r from public.dq_runs where id = v_run;
  if r.consecutive_errors <> 3 then raise exception 'E2: the run holds % not 3', r.consecutive_errors; end if;
  -- the count is a single UPDATE … RETURNING, so two callers cannot both be
  -- handed the same value: the fourth call must read 4, never 1
  v_res := public.fn_dq_run_note_error(v_run, 'again', 3);
  if (v_res->>'consecutive_errors')::int <> 4 then raise exception 'E2: the counter restarted: %', v_res; end if;

  -- ── E3 · the error is retained, and the note says where it stands ────────
  select * into r from public.dq_runs where id = v_run;
  if r.last_engine_error is null or r.last_engine_error <> 'again' then raise exception 'E3: the error was not retained: %', r.last_engine_error; end if;
  if r.note is null or position('engine error' in r.note) = 0 then raise exception 'E3: the note does not mention the engine error: %', r.note; end if;
  -- a long error is truncated, not refused
  v_res := public.fn_dq_run_note_error(v_run, repeat('x', 5000), 3);
  if (v_res->>'ok')::boolean is not true then raise exception 'E3: a long error was refused: %', v_res; end if;
  select * into r from public.dq_runs where id = v_run;
  if length(r.last_engine_error) > 500 then raise exception 'E3: the retained error is % characters', length(r.last_engine_error); end if;
  if length(r.note) > 2000 then raise exception 'E3: the note grew to % characters', length(r.note); end if;

  -- ── E4 · only a successful batch clears the streak ────────────────────────
  perform public.fn_dq_run_clear_errors(v_run);
  select * into r from public.dq_runs where id = v_run;
  if r.consecutive_errors <> 0 then raise exception 'E4: the streak was not cleared: %', r.consecutive_errors; end if;
  if r.last_engine_error is not null then raise exception 'E4: the error was not cleared: %', r.last_engine_error; end if;
  -- and after clearing, the next failure is genuinely the first again
  v_res := public.fn_dq_run_note_error(v_run, 'fresh', 3);
  if (v_res->>'consecutive_errors')::int <> 1 or (v_res->>'give_up')::boolean then raise exception 'E4: after a clear the count should restart at 1: %', v_res; end if;

  -- ── E5 · the threshold is the caller's, and the count is per-run ─────────
  v_res := public.fn_dq_run_note_error(v_run, 'strict threshold', 2);
  if (v_res->>'consecutive_errors')::int <> 2 or not (v_res->>'give_up')::boolean then raise exception 'E5: a threshold of 2 should give up at 2: %', v_res; end if;

  insert into public.dq_runs (scope, mode, batch_size, started_by_name)
  values ('{"kind":"tables","tables":["ports"]}', 'rules', 100, 'smoke 2')
  returning id into v_run2;
  v_res := public.fn_dq_run_note_error(v_run2, 'other run', 3);
  if (v_res->>'consecutive_errors')::int <> 1 then raise exception 'E5: one run''s failures leaked into another: %', v_res; end if;
  select consecutive_errors into n from public.dq_runs where id = v_run;
  if n <> 2 then raise exception 'E5: the first run''s count changed to %', n; end if;

  -- ── E6 · validation and reach ────────────────────────────────────────────
  v_ok := false;
  begin perform public.fn_dq_run_note_error(null, 'no run', 3); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'E6: a null run id was accepted'; end if;

  v_res := public.fn_dq_run_note_error('00000000-0000-4000-8000-000000000000'::uuid, 'ghost', 3);
  if (v_res->>'ok')::boolean is not false or v_res->>'reason' <> 'no_such_run' then
    raise exception 'E6: an unknown run should be reported, not invented: %', v_res;
  end if;

  select count(*) into n
    from information_schema.role_routine_grants
   where routine_schema = 'public' and routine_name in ('fn_dq_run_note_error', 'fn_dq_run_clear_errors')
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC', 'dq_evaluator');
  if n > 0 then raise exception 'E6: the failure-state functions are reachable by % non-service role(s)', n; end if;

  raise notice 'DQ ENGINE FAILURE STATE SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
