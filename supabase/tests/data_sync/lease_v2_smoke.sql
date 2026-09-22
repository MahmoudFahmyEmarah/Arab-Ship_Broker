-- Data Sync hardening — lease v2 behavioural test for
-- 20260920100000_sync_lease_v2.sql (20 Sep 2026).
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/lease_v2_smoke.sql
--   supabase db query --local  --file supabase/tests/data_sync/lease_v2_smoke.sql
--
-- BEGIN … ROLLBACK: nothing persists. Prints LEASE V2 SMOKE: ALL ASSERTIONS
-- PASSED or raises at the first failure. Acceptance:
--   1. two claims with owner_label = 'cron': first true, second false
--   2. a different label is refused as well
--   3. an expired lease can be acquired (and gets a NEW token)
--   4. a stale token can neither checkpoint nor release
--   5. the active token can checkpoint and release
--   6. two simulated cron runs: the second claim is refused, so it never fetches
--   + the v1 functions cannot touch a v2 lease

begin;

-- ── the lease itself (whatsapp source: no checkpoint semantics attached) ────
do $$
declare r jsonb; r2 jsonb; t1 uuid; t2 uuid; s public.sync_source_state%rowtype; v_src text := 'whatsapp';
begin
  update public.sync_source_state set lease_until = null, lease_token = null, lease_owner = null where source = v_src;

  r := public.claim_sync_run_v2(v_src, 'cron', 60);
  if not (r->>'claimed')::boolean or (r->>'lease_token') is null then raise exception 'T1: first claim must succeed with a token: %', r; end if;
  t1 := (r->>'lease_token')::uuid;

  -- 1 · same label, live lease → refused
  r2 := public.claim_sync_run_v2(v_src, 'cron', 60);
  if (r2->>'claimed')::boolean then raise exception 'T1: a second claim with the same label must be refused: %', r2; end if;
  if r2->>'lease_owner' <> 'cron' then raise exception 'T1: the refusal must name the holder label: %', r2; end if;
  if (r2->>'lease_token') is not null then raise exception 'T1: a refusal must not hand out a token'; end if;

  -- 2 · a different label is refused too
  r2 := public.claim_sync_run_v2(v_src, 'admin:someone', 60);
  if (r2->>'claimed')::boolean then raise exception 'T2: a different label must be refused while the lease is live: %', r2; end if;

  -- 4 · a foreign token cannot release
  if public.release_sync_run_v2(v_src, gen_random_uuid()) then raise exception 'T4: a foreign token released the lease'; end if;
  if public.release_sync_run_v2(v_src, null) then raise exception 'T4: a null token released the lease'; end if;

  -- 3 · an expired lease is acquired, with a new token
  update public.sync_source_state set lease_until = now() - interval '1 second' where source = v_src;
  r2 := public.claim_sync_run_v2(v_src, 'admin:someone', 60);
  if not (r2->>'claimed')::boolean then raise exception 'T3: an expired lease must be acquired: %', r2; end if;
  t2 := (r2->>'lease_token')::uuid;
  if t2 = t1 then raise exception 'T3: a new claim must mint a new token'; end if;

  -- 4 · the stale token (the run that expired) cannot release the new lease
  if public.release_sync_run_v2(v_src, t1) then raise exception 'T4: the stale token released the new lease'; end if;
  select * into s from public.sync_source_state where source = v_src;
  if s.lease_token <> t2 or s.lease_owner <> 'admin:someone' then raise exception 'T4: the lease changed on a stale release'; end if;

  -- 5 · the active token releases
  if not public.release_sync_run_v2(v_src, t2) then raise exception 'T5: the active token must release'; end if;
  select * into s from public.sync_source_state where source = v_src;
  if s.lease_token is not null or s.lease_until is not null or s.lease_owner is not null then raise exception 'T5: the lease was not cleared'; end if;
  raise notice 'lease v2: ok';
end $$;

-- ── the email checkpoint under a token ──────────────────────────────────────
do $$
declare r jsonb; tok uuid; stale uuid := gen_random_uuid(); s public.sync_source_state%rowtype; v_uid bigint;
begin
  update public.sync_source_state set lease_until = null, lease_token = null, lease_owner = null where source = 'email';
  select last_uid into v_uid from public.sync_source_state where source = 'email';

  r := public.claim_sync_run_v2('email', 'cron', 60);
  if not (r->>'claimed')::boolean then raise exception 'T5: could not take the email lease: %', r; end if;
  tok := (r->>'lease_token')::uuid;

  -- 4 · a stale / null token cannot move the checkpoint
  if public.set_email_checkpoint_v2(stale, 424242, 777, now()) then raise exception 'T4: a stale token moved the checkpoint'; end if;
  if public.set_email_checkpoint_v2(null, 424242, 777, now()) then raise exception 'T4: a null token moved the checkpoint'; end if;
  select * into s from public.sync_source_state where source = 'email';
  if s.last_uid is distinct from v_uid then raise exception 'T4: the checkpoint moved under a stale token'; end if;

  -- 5 · the active token moves it (a new epoch makes the value deterministic)
  if not public.set_email_checkpoint_v2(tok, 424242, 5, '2026-09-20T00:00:00Z') then raise exception 'T5: the active token must move the checkpoint'; end if;
  select * into s from public.sync_source_state where source = 'email';
  if s.uid_validity <> 424242 or s.last_uid <> 5 then raise exception 'T5: checkpoint not stored: % %', s.uid_validity, s.last_uid; end if;
  perform public.set_email_checkpoint_v2(tok, 424242, 3, null);
  select * into s from public.sync_source_state where source = 'email';
  if s.last_uid <> 5 then raise exception 'T5: last_uid must never go backwards within an epoch'; end if;

  -- v1 cannot touch a v2 lease (the deployed application during the transition)
  if public.set_email_checkpoint('cron', 424242, 99, null) then raise exception 'T7: v1 checkpoint moved a v2 lease'; end if;
  if public.release_sync_run('email', 'cron') then raise exception 'T7: v1 release freed a v2 lease'; end if;
  r := public.claim_sync_run('email', 'cron', 60);
  if (r->>'claimed')::boolean then raise exception 'T7: a v1 claim took over a live v2 lease'; end if;
  select * into s from public.sync_source_state where source = 'email';
  if s.lease_token <> tok or s.last_uid <> 5 then raise exception 'T7: v1 changed the v2 lease or checkpoint'; end if;

  -- 6 · two simulated cron runs: the second claim is refused, so it never fetches
  r := public.claim_sync_run_v2('email', 'cron', 60);
  if (r->>'claimed')::boolean then raise exception 'T6: a second cron run claimed while the first holds the lease'; end if;

  -- an expired v2 lease can be taken by the v1 function too (no dead-lock across versions)
  update public.sync_source_state set lease_until = now() - interval '1 second' where source = 'email';
  r := public.claim_sync_run('email', 'cron', 60);
  if not (r->>'claimed')::boolean then raise exception 'T8: v1 must be able to take an EXPIRED v2 lease'; end if;
  select * into s from public.sync_source_state where source = 'email';
  if s.lease_token is not null then raise exception 'T8: a v1 claim must clear the token'; end if;
  -- …and a live v1 lease refuses v2
  r := public.claim_sync_run_v2('email', 'cron', 60);
  if (r->>'claimed')::boolean then raise exception 'T8: v2 claimed over a live v1 lease'; end if;
  if not public.release_sync_run('email', 'cron') then raise exception 'T8: v1 holder must release its own lease'; end if;
  raise notice 'checkpoint v2: ok';
  raise notice 'LEASE V2 SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
