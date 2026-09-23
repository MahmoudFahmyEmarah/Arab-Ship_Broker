-- Phase 7 (Data Sync hardening phase 1, 18 Sep 2026) — intake durability
-- smoke test for 20260918110000_sync_phase1_intake_durability.sql.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/phase7_intake_smoke.sql
--
-- Wrapped in BEGIN … ROLLBACK: nothing persists. Run as the database owner.
-- Prints PHASE 7 SMOKE: ALL ASSERTIONS PASSED, or raises at the first failure.

begin;

-- ── email run lease ──────────────────────────────────────────────────────────
do $$
declare r jsonb; r2 jsonb;
begin
  -- a source that has never run (whatsapp has no checkpoint row) gets a row with the lease
  r := public.claim_sync_run('whatsapp', 'cron', 60);
  if not (r->>'claimed')::boolean then raise exception 'first claim should succeed: %', r; end if;

  -- a second caller is refused while the lease is live
  r2 := public.claim_sync_run('whatsapp', 'admin:someone', 60);
  if (r2->>'claimed')::boolean then raise exception 'second claim should be refused: %', r2; end if;
  if r2->>'lease_owner' <> 'cron' then raise exception 'refusal should name the holder: %', r2; end if;

  -- the holder may re-claim (extends its own lease)
  r2 := public.claim_sync_run('whatsapp', 'cron', 60);
  if not (r2->>'claimed')::boolean then raise exception 'holder re-claim should succeed: %', r2; end if;

  -- an expired lease is taken over
  update public.sync_source_state set lease_until = now() - interval '1 second' where source = 'whatsapp';
  r2 := public.claim_sync_run('whatsapp', 'admin:someone', 60);
  if not (r2->>'claimed')::boolean then raise exception 'expired lease should be taken over: %', r2; end if;

  -- release: only the holder can
  if public.release_sync_run('whatsapp', 'cron') then raise exception 'non-holder release must be a no-op'; end if;
  if not public.release_sync_run('whatsapp', 'admin:someone') then raise exception 'holder release should succeed'; end if;
  raise notice 'lease: ok';
end $$;

-- ── email checkpoint ────────────────────────────────────────────────────────
do $$
declare r jsonb; s public.sync_source_state%rowtype;
begin
  -- the checkpoint belongs to the email source; take its lease (restored by the rollback)
  r := public.claim_sync_run('email', 'smoke', 60);
  if not (r->>'claimed')::boolean then
    update public.sync_source_state set lease_until = now() - interval '1 second' where source = 'email';
    r := public.claim_sync_run('email', 'smoke', 60);
  end if;
  if not public.set_email_checkpoint('smoke', 1000, 50, '2026-09-18T08:00:00Z') then raise exception 'holder should move the checkpoint'; end if;
  select * into s from public.sync_source_state where source = 'email';
  if s.uid_validity <> 1000 or s.last_uid <> 50 then raise exception 'checkpoint not stored: % %', s.uid_validity, s.last_uid; end if;

  -- only forward within the epoch
  perform public.set_email_checkpoint('smoke', 1000, 40, '2026-09-18T07:00:00Z');
  select * into s from public.sync_source_state where source = 'email';
  if s.last_uid <> 50 then raise exception 'last_uid must not go backwards: %', s.last_uid; end if;
  if s.last_sync_at < '2026-09-18T08:00:00Z' then raise exception 'last_sync_at must not go backwards: %', s.last_sync_at; end if;

  -- a new epoch resets the UID
  perform public.set_email_checkpoint('smoke', 2000, 3, null);
  select * into s from public.sync_source_state where source = 'email';
  if s.uid_validity <> 2000 or s.last_uid <> 3 then raise exception 'new UIDVALIDITY should reset last_uid: % %', s.uid_validity, s.last_uid; end if;

  -- not the holder → false, nothing moves
  if public.set_email_checkpoint('impostor', 2000, 99, null) then raise exception 'non-holder must not move the checkpoint'; end if;
  select * into s from public.sync_source_state where source = 'email';
  if s.last_uid <> 3 then raise exception 'non-holder moved the checkpoint'; end if;
  raise notice 'checkpoint: ok';
end $$;

-- ── WhatsApp claims ─────────────────────────────────────────────────────────
do $$
declare n int; n2 int; tok uuid; parked int;
begin
  insert into public.whatsapp_message (wa_message_id, provider, wa_from, body, received_at)
  select 'SMOKE:' || g, 'meta', '+20100000000' || g, 'smoke ' || g, now() - (g || ' minutes')::interval
    from generate_series(1, 10) g;

  -- worker A claims 6, worker B gets the remaining 4, a third gets none
  select count(*) into n  from public.claim_whatsapp_messages('A', 6, 60, false);
  select count(*) into n2 from public.claim_whatsapp_messages('B', 6, 60, false);
  if n <> 6 or n2 <> 4 then raise exception 'claims should split 6/4, got %/%', n, n2; end if;
  select count(*) into n from public.claim_whatsapp_messages('C', 6, 60, false);
  if n <> 0 then raise exception 'nothing left to claim, got %', n; end if;

  -- every claimed row is processing with a token and attempts = 1
  select count(*) into n from public.whatsapp_message where wa_message_id like 'SMOKE:%' and status = 'processing' and lease_token is not null and attempts = 1;
  if n <> 10 then raise exception 'all 10 should be leased, got %', n; end if;

  -- an expired lease is reclaimable; attempts increments
  update public.whatsapp_message set lease_until = now() - interval '1 second' where wa_message_id = 'SMOKE:1';
  select count(*) into n from public.claim_whatsapp_messages('D', 10, 60, false);
  if n <> 1 then raise exception 'exactly the expired one should be reclaimed, got %', n; end if;
  select attempts into n from public.whatsapp_message where wa_message_id = 'SMOKE:1';
  if n <> 2 then raise exception 'attempts should be 2, got %', n; end if;

  -- handing back returns rows to pending
  select lease_token into tok from public.whatsapp_message where wa_message_id = 'SMOKE:2';
  select public.release_whatsapp_messages(array[tok]) into n;
  if n <> 1 then raise exception 'one row should be handed back, got %', n; end if;
  select count(*) into n from public.whatsapp_message where wa_message_id = 'SMOKE:2' and status = 'pending' and lease_token is null;
  if n <> 1 then raise exception 'handed-back row should be pending without a token'; end if;

  -- a poison message is parked after the attempt limit
  update public.whatsapp_message set attempts = 5, status = 'processing', lease_until = now() - interval '1 second' where wa_message_id = 'SMOKE:3';
  perform public.claim_whatsapp_messages('E', 10, 60, false);
  select count(*) into parked from public.whatsapp_message where wa_message_id = 'SMOKE:3' and status = 'failed' and error like '%gave up after 5 attempts%';
  if parked <> 1 then raise exception 'poison message should be parked as failed'; end if;

  -- failed rows are only claimed on request
  select count(*) into n from public.claim_whatsapp_messages('F', 10, 60, false);
  select count(*) into n2 from public.claim_whatsapp_messages('G', 10, 60, true);
  if n2 < 1 then raise exception 'include_failed should claim the parked message'; end if;
  raise notice 'claims: ok (plain claim after park returned %, with failed %)', n, n2;
end $$;

do $$ begin raise notice 'PHASE 7 SMOKE: ALL ASSERTIONS PASSED'; end $$;

rollback;
