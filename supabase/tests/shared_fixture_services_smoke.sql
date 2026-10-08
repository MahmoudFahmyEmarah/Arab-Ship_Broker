-- Shared Fixture services behavioural smoke. The harness must prepend the
-- migrations and wrap this body in BEGIN / ROLLBACK.

set local session_replication_role = replica;

insert into auth.users (id, email, aud, role) values
  ('10000000-0000-4000-8000-000000000001', 'ntf-one@test.invalid', 'authenticated', 'authenticated'),
  ('10000000-0000-4000-8000-000000000002', 'ntf-two@test.invalid', 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.users
  (id, supabase_user_id, email, full_name, role, subscription_tier, is_active)
values
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'ntf-one@test.invalid', 'Notification One', 'broker', 'T3', true),
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'ntf-two@test.invalid', 'Notification Two', 'broker', 'T3', true)
on conflict (id) do nothing;

set local session_replication_role = origin;

create or replace function pg_temp.ntf_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'member')
  )::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.ntf_owner() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

do $$
declare
  u1 constant uuid := '10000000-0000-4000-8000-000000000001';
  u2 constant uuid := '10000000-0000-4000-8000-000000000002';
  n1 uuid;
  n1_replay uuid;
  n2 uuid;
  n3 uuid;
  n4 uuid;
  n5 uuid;
  n6 uuid;
  n7 uuid;
  n8 uuid;
  n_retry_expiring uuid;
  n_late uuid;
  n_expired uuid;
  digest_batch uuid;
  late_batch uuid;
  j record;
  first_token uuid;
  first_snapshot jsonb;
  retry_snapshot jsonb;
  first_snapshot_at timestamptz;
  n integer;
  refused boolean := false;
begin
  if has_function_privilege('anon', 'public.list_my_notifications(integer,timestamptz,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.list_my_notifications(integer,timestamptz,uuid)', 'EXECUTE') then
    raise exception 'N0: notification feed RPC grants are not private-by-default';
  end if;

  n1 := public.fn_notification_enqueue(
    u1, 'fixture.proposal', 'fixture/room-1/event-1', 'New fixture proposal',
    'A counterparty submitted a proposal.', '/dashboard/fixture-room/room-1',
    'normal', '{"roomRef":"FX-001"}'::jsonb, true, now() - interval '1 minute', null
  );
  n1_replay := public.fn_notification_enqueue(
    u1, 'fixture.proposal', 'fixture/room-1/event-1', 'Different replay title',
    'This replay must not mutate the immutable snapshot.', '/dashboard/fixture-room/room-1'
  );
  if n1 <> n1_replay then raise exception 'N1: replay returned another notification'; end if;
  if (select count(*) from public.notifications where recipient_user_id = u1 and dedupe_key = 'fixture/room-1/event-1') <> 1 then
    raise exception 'N1: duplicate logical notification';
  end if;
  if (select title from public.notifications where id = n1) <> 'New fixture proposal' then
    raise exception 'N1: replay mutated the original snapshot';
  end if;
  begin
    update public.notifications set title = 'Mutated outside the read-state RPC' where id = n1;
    raise exception 'N1: immutable snapshot accepted a title mutation';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.notifications where id = n1;
    raise exception 'N1: immutable snapshot accepted a delete';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.fn_notification_enqueue(
      u1, 'fixture.link', 'fixture/room-1/unsafe-link', 'Unsafe link',
      'This href must be rejected.', '/\evil.example'
    );
    raise exception 'N1: backslash href escaped the internal-link boundary';
  exception when check_violation then null;
  end;

  execute 'set local role service_role';
  refused := false;
  begin
    update public.notifications set read_at = now() where id = n1;
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then raise exception 'N1: service role bypassed the read-state RPC'; end if;
  execute 'reset role';

  perform pg_temp.ntf_as(u1);
  if public.notification_badge() <> 1 then raise exception 'N2: recipient badge'; end if;
  if (select count(*) from public.list_my_notifications(30, null)) <> 1 then raise exception 'N2: recipient feed'; end if;
  refused := false;
  begin
    perform 1 from public.notifications limit 1;
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then raise exception 'N2: authenticated read the private table'; end if;
  if public.mark_notifications_read(array[n1]) <> 1 then
    raise exception 'N2: read-state mutation';
  end if;
  if public.notification_badge() <> 0 then
    raise exception 'N2: badge did not observe read state';
  end if;
  perform pg_temp.ntf_owner();
  n5 := public.fn_notification_enqueue(
    u1, 'fixture.read-all', 'fixture/room-1/read-all', 'Read all notice',
    'This item exercises the complete-feed read command.', null, 'info', '{}'::jsonb, false
  );
  perform pg_temp.ntf_as(u1);
  if public.notification_badge() <> 1 or public.mark_all_my_notifications_read() <> 1 then
    raise exception 'N2: mark-all did not update the complete unread feed';
  end if;
  if public.notification_badge() <> 0 then raise exception 'N2: mark-all badge remained unread'; end if;

  perform pg_temp.ntf_as(u2);
  if public.notification_badge() <> 0 then raise exception 'N3: cross-member badge leak'; end if;
  if public.mark_notifications_read(array[n1]) <> 0 then raise exception 'N3: cross-member read mutation'; end if;

  perform pg_temp.ntf_as(u1);
  perform public.set_notification_preferences(false, 'off', 9);
  perform pg_temp.ntf_owner();
  n2 := public.fn_notification_enqueue(
    u1, 'fixture.message', 'fixture/room-1/event-2', 'New room message',
    'A new masked message is available.', '/dashboard/fixture-room/room-1'
  );
  if (select in_app_visible from public.notifications where id = n2) then
    raise exception 'N4: disabled in-app preference ignored';
  end if;
  if (select status from public.notification_deliveries where notification_id = n2) <> 'suppressed' then
    raise exception 'N4: disabled email preference not audited as suppressed';
  end if;

  perform pg_temp.ntf_as(u1);
  begin
    perform public.set_notification_preferences(true, null, 9);
    raise exception 'N4: null email mode accepted';
  exception when invalid_parameter_value then null;
  end;
  perform pg_temp.ntf_owner();
  perform pg_temp.ntf_as(u1);
  perform public.set_notification_preferences(true, 'digest', 9);
  perform pg_temp.ntf_owner();

  n_expired := public.fn_notification_enqueue(
    u1, 'fixture.expired', 'fixture/room-1/expired', 'Expired notice',
    'This history remains visible although its email is obsolete.', null,
    'normal', '{}'::jsonb, true, null, now() - interval '1 second'
  );
  if (select status from public.notification_deliveries where notification_id = n_expired) <> 'suppressed'
     or (select last_error from public.notification_deliveries where notification_id = n_expired) !~ 'expired' then
    raise exception 'N4: past expiry did not suppress email';
  end if;
  perform pg_temp.ntf_as(u1);
  if not coalesce((select is_expired from public.list_my_notifications(30, null) where id = n_expired), false) then
    raise exception 'N4: expired notification disappeared from the feed';
  end if;
  if public.notification_badge() <> 1 then raise exception 'N4: expired unread item disappeared from badge'; end if;
  if public.mark_notifications_read(array[n_expired]) <> 1 then
    raise exception 'N4: expired item was not marked read';
  end if;
  if public.notification_badge() <> 0 then
    raise exception 'N4: expired item did not participate in read state';
  end if;
  perform pg_temp.ntf_owner();

  n6 := public.fn_notification_enqueue(
    u1, 'fixture.digest', 'fixture/room-1/digest-1', 'Digest one',
    'First item in one combined envelope.', '/dashboard/fixture-room/room-1', 'normal'
  );
  n7 := public.fn_notification_enqueue(
    u1, 'fixture.digest', 'fixture/room-1/digest-2', 'Digest two',
    'Second item in one combined envelope.', '/dashboard/fixture-room/room-1', 'info'
  );
  select digest_batch_id into digest_batch
    from public.notification_deliveries where notification_id = n6;
  if digest_batch is null
     or (select digest_batch_id from public.notification_deliveries where notification_id = n7) is distinct from digest_batch
     or (select count(*) from public.notification_deliveries where digest_batch_id = digest_batch) <> 2 then
    raise exception 'N5: same recipient/window did not form one digest batch';
  end if;

  -- Model an item that was valid when the envelope was first rendered but expires before an ambiguous SMTP
  -- attempt is reclaimed. C2O-092 #2: the frozen envelope is then obsolete — it is never re-sent; its still-valid
  -- items go out in a successor envelope (a new id, so a new Message-ID) and the expired item is suppressed.
  insert into public.notifications
    (recipient_user_id, dedupe_key, kind, importance, title, body, in_app_visible, expires_at)
  values
    (u1, 'fixture/room-1/retry-expiry', 'fixture.digest', 'normal',
     'Digest retry expiry', 'This item remains in the frozen retry envelope.', true,
     clock_timestamp() + interval '5 seconds')
  returning id into n_retry_expiring;
  insert into public.notification_deliveries
    (notification_id, channel, status, next_attempt_at, digest_batch_id)
  values
    (n_retry_expiring, 'email', 'queued', now() - interval '1 minute', digest_batch);

  n8 := public.fn_notification_enqueue(
    u1, 'fixture.urgent', 'fixture/room-1/urgent', 'Urgent notice',
    'Urgent mail bypasses the digest.', null, 'urgent'
  );
  if (select digest_batch_id from public.notification_deliveries where notification_id = n8) is not null then
    raise exception 'N5: urgent mail entered a digest';
  end if;

  update public.notification_digest_batches set next_attempt_at = now() - interval '2 minutes'
   where id = digest_batch;
  update public.notification_deliveries set next_attempt_at = now() - interval '1 minute'
   where notification_id = n8;

  -- C2O-092 #6: an urgent item is claimed before an older due digest (no digest backlog starves it)
  select * into j from public.fn_notification_email_claim(600, 8);
  if j.job_kind <> 'instant' or j.id <> (select d.id from public.notification_deliveries d where d.notification_id = n8) then
    raise exception 'N5: an urgent item must be claimed before an older due digest';
  end if;
  -- park the urgent item (back to queued, an hour away) so the digest checks below run on their own; it is made
  -- due again before the bounded-failure check
  update public.notification_deliveries set status = 'queued', claim_token = null, lease_until = null, attempts = 0,
         next_attempt_at = now() + interval '1 hour' where id = j.id;
  select * into j from public.fn_notification_email_claim(600, 8);
  if j.job_kind <> 'digest' or j.id <> digest_batch or j.claim_token is null or j.attempts <> 1 then
    raise exception 'N5: due digest envelope not claimed next';
  end if;
  select jsonb_agg(to_jsonb(s) order by s.created_at, s.id)
    into first_snapshot
    from public.fn_notification_email_snapshot('digest', j.id, j.claim_token, 25) s;
  select snapshot_at into first_snapshot_at
    from public.notification_digest_batches where id = digest_batch;
  if jsonb_array_length(first_snapshot) <> 3
     or (select max(total_count) from public.fn_notification_email_snapshot('digest', j.id, j.claim_token, 25)) <> 3 then
    raise exception 'N5: digest snapshot did not combine all items';
  end if;
  if public.fn_notification_email_settle('digest', j.id, gen_random_uuid(), 'sent', null, 8) then
    raise exception 'N5: wrong digest token settled envelope';
  end if;
  first_token := j.claim_token;

  -- Once claimed, the same recipient/window is closed. A late enqueue must be
  -- placed in a later batch and must never be settled as part of this envelope.
  n_late := public.fn_notification_enqueue(
    u1, 'fixture.digest', 'fixture/room-1/digest-late', 'Late digest item',
    'This item belongs to a later envelope.', null, 'normal'
  );
  select digest_batch_id into late_batch
    from public.notification_deliveries where notification_id = n_late;
  if late_batch is null or late_batch = digest_batch then
    raise exception 'N5: enqueue attached to a claimed digest envelope';
  end if;

  perform pg_sleep(5.1);
  update public.notification_digest_batches set lease_until = now() - interval '1 second' where id = j.id;
  select * into j from public.fn_notification_email_claim(600, 8);
  if j.job_kind <> 'digest' or j.id = digest_batch or j.claim_token = first_token or j.attempts <> 1 then
    raise exception 'N5: the obsolete envelope must be succeeded, not re-sent (claimed % attempt %)', j.id, j.attempts;
  end if;
  if (select status from public.notification_digest_batches where id = digest_batch) <> 'suppressed'
     or (select generation from public.notification_digest_batches where id = j.id) <> 1
     or (select status from public.notification_deliveries where notification_id = n_retry_expiring) <> 'suppressed' then
    raise exception 'N5: the obsolete envelope is closed, its expired item suppressed, the successor is generation 1';
  end if;
  select jsonb_agg(to_jsonb(s) order by s.created_at, s.id)
    into retry_snapshot
    from public.fn_notification_email_snapshot('digest', j.id, j.claim_token, 25) s;
  if jsonb_array_length(retry_snapshot) <> 2 or retry_snapshot::text like '%Digest retry expiry%' then
    raise exception 'N5: the successor carries exactly the two still-valid items';
  end if;
  if not public.fn_notification_email_settle('digest', j.id, j.claim_token, 'sent', null, 8) then
    raise exception 'N5: valid digest claim did not settle';
  end if;
  if (select count(*) from public.notification_deliveries where digest_batch_id = j.id and status = 'sent') <> 2
     or (select status from public.notification_deliveries where notification_id = n_late) <> 'queued' then
    raise exception 'N5: digest children did not settle together';
  end if;
  -- the urgent item is due again for the bounded-failure check
  update public.notification_deliveries set next_attempt_at = now() - interval '1 minute' where notification_id = n8;

  select * into j from public.fn_notification_email_claim(600, 1);
  if j.job_kind <> 'instant'
     or not public.fn_notification_email_settle('instant', j.id, j.claim_token, 'failed', 'test failure', 1) then
    raise exception 'N5: bounded instant failure did not settle';
  end if;
  if (select status from public.notification_deliveries where notification_id = n8) <> 'failed' then
    raise exception 'N5: retry ceiling did not fail instant delivery';
  end if;

  n4 := public.fn_notification_enqueue(
    u2, 'fixture.inactive', 'fixture/room-2/inactive', 'Inactive notice',
    'This delivery must be suppressed before claim.', null, 'urgent'
  );
  update public.users set is_active = false where id = u2;
  select * into j from public.fn_notification_email_claim(600, 8);
  if j.id is not null then raise exception 'N5: inactive recipient delivery was claimed'; end if;
  if (select status from public.notification_deliveries where notification_id = n4) <> 'suppressed' then
    raise exception 'N5: inactive recipient delivery was not suppressed';
  end if;

  update public.users set is_active = false where id = u1;
  perform pg_temp.ntf_as(u1);
  begin
    perform public.notification_badge();
  exception when insufficient_privilege then
    n := 1;
  end;
  if coalesce(n, 0) <> 1 then raise exception 'N6: inactive member was not refused'; end if;
  perform pg_temp.ntf_owner();

  raise notice 'SHARED FIXTURE SERVICES SMOKE: ALL ASSERTIONS PASSED';
end;
$$;

-- ── C2O-092 #2/#6/#7 · urgent first, email off stops queued work, an obsolete retry is succeeded, preferences read ──
do $$
declare u2 uuid := '10000000-0000-4000-8000-000000000002'; u3 uuid := '10000000-0000-4000-8000-000000000003';
        r record; v_old uuid; v_new uuid; j jsonb; n int;
begin
  perform pg_temp.ntf_owner();
  update public.users set is_active = true where id = u2;   -- the inactive-recipient checks above left u2 inactive
  insert into auth.users (id, email, aud, role) values (u3, 'ntf-three@test.invalid', 'authenticated', 'authenticated') on conflict (id) do nothing;
  insert into public.users (id, supabase_user_id, email, full_name, role, subscription_tier, is_active)
  values (u3, u3, 'ntf-three@test.invalid', 'Notification Three', 'broker', 'T3', true) on conflict (id) do nothing;
  update public.notification_deliveries set status = 'sent', claim_token = null, lease_until = null where status in ('queued', 'sending');
  update public.notification_digest_batches set status = 'sent', claim_token = null, lease_until = null where status in ('queued', 'sending');

  -- urgent first: an older normal instant item (member on instant) and a newer urgent one; the urgent is claimed first
  insert into public.notification_preferences (user_id, email_mode) values (u3, 'instant') on conflict (user_id) do update set email_mode = 'instant';
  perform public.fn_notification_enqueue(u3, 'proof.normal', 'proof:prio:normal', 'Normal', 'Normal.', null, 'normal');
  perform public.fn_notification_enqueue(u3, 'proof.urgent', 'proof:prio:urgent', 'Urgent', 'Urgent.', null, 'urgent');
  update public.notification_deliveries d set next_attempt_at = now() - case when n.dedupe_key = 'proof:prio:normal' then interval '10 minutes' else interval '1 minute' end
    from public.notifications n where n.id = d.notification_id and n.recipient_user_id = u3;
  select * into r from public.fn_notification_email_claim(60, 8) limit 1;
  if (select n.dedupe_key from public.notification_deliveries d join public.notifications n on n.id = d.notification_id where d.id = r.id) <> 'proof:prio:urgent' then
    raise exception 'P1: the urgent item must be claimed before an older normal one'; end if;
  raise notice 'P1 ok: an urgent item is claimed before an older normal backlog';

  -- email off stops queued work, also what is already waiting
  update public.notification_preferences set email_mode = 'off' where user_id = u3;
  perform public.fn_notification_email_claim(60, 8);
  if exists (select 1 from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
              where n.recipient_user_id = u3 and d.status = 'queued') then raise exception 'P2: email off must suppress queued work'; end if;
  if (select d.last_error from public.notification_deliveries d join public.notifications n on n.id = d.notification_id where n.dedupe_key = 'proof:prio:normal') <> 'suppressed because the member turned email off' then
    raise exception 'P2: the suppression must say why'; end if;
  raise notice 'P2 ok: turning email off suppresses work already queued';

  -- an obsolete retry: a frozen digest whose item expired since its snapshot is succeeded (new id) and never re-sent
  delete from public.notification_preferences where user_id = u2;
  perform public.fn_notification_enqueue(u2, 'proof.digest', 'proof:dg:keep', 'Keep', 'Keep.', null, 'normal');
  select b.id into v_old from public.notification_digest_batches b where b.recipient_user_id = u2 and b.status = 'queued' order by b.created_at desc limit 1;
  -- an item valid at the first render that expires before the retry (enqueue would keep it out of the window, so
  -- it is placed as N5 does)
  with x as (
    insert into public.notifications (recipient_user_id, dedupe_key, kind, importance, title, body, in_app_visible, expires_at)
    values (u2, 'proof:dg:expire', 'proof.digest', 'normal', 'Expire', 'Expire.', true, clock_timestamp() + interval '3 seconds')
    returning id)
  insert into public.notification_deliveries (notification_id, channel, status, next_attempt_at, digest_batch_id)
  select x.id, 'email', 'queued', now() - interval '1 minute', v_old from x;
  update public.notification_digest_batches set next_attempt_at = now() - interval '1 minute' where id = v_old;
  select * into r from public.fn_notification_email_claim(60, 8) limit 1;   -- first attempt: frozen snapshot
  if r.id is distinct from v_old then raise exception 'P3: setup must claim the digest (got %)', r.id; end if;
  perform public.fn_notification_email_snapshot('digest', v_old, r.claim_token, 25);
  perform public.fn_notification_email_settle('digest', v_old, r.claim_token, 'failed', 'smtp down', 8);   -- first send fails
  perform pg_sleep(3);   -- the item expires (the ledger is immutable, so real time passes)
  update public.notification_digest_batches set next_attempt_at = now() - interval '1 second' where id = v_old;
  select * into r from public.fn_notification_email_claim(60, 8) limit 1;
  select b.id into v_new from public.notification_digest_batches b where b.recipient_user_id = u2 and b.generation = 1;
  if v_new is null or r.id is distinct from v_new then raise exception 'P3: the retry must claim a successor envelope (claimed %, successor %)', r.id, v_new; end if;
  if (select status from public.notification_digest_batches where id = v_old) <> 'suppressed' then raise exception 'P3: the obsolete envelope must be closed'; end if;
  if (select d.status from public.notification_deliveries d join public.notifications n on n.id = d.notification_id where n.dedupe_key = 'proof:dg:expire') <> 'suppressed'
     or (select d.digest_batch_id from public.notification_deliveries d join public.notifications n on n.id = d.notification_id where n.dedupe_key = 'proof:dg:keep') <> v_new then
    raise exception 'P3: the expired item is suppressed and the valid one moves to the successor'; end if;
  raise notice 'P3 ok: a retry after an item expired sends a successor envelope (new id, so a new Message-ID) without it';

  -- the member's preferences: defaults said out loud, then the saved value
  perform pg_temp.ntf_as(u2);
  j := public.get_my_notification_preferences();
  if (j->>'isDefault')::boolean is not true or j->>'emailMode' <> 'digest' or (j->>'digestHourUtc')::int <> 7 or (j->>'urgentEmailsAtOnce')::boolean is not true then
    raise exception 'P4: defaults expected: %', j; end if;
  perform public.set_notification_preferences(true, 'off', 9);
  j := public.get_my_notification_preferences();
  if (j->>'isDefault')::boolean or j->>'emailMode' <> 'off' or (j->>'urgentEmailsAtOnce')::boolean then raise exception 'P4: saved value expected: %', j; end if;
  perform pg_temp.ntf_owner();
  if has_function_privilege('anon', 'public.get_my_notification_preferences()', 'execute') then raise exception 'P4: anon must not read preferences'; end if;
  raise notice 'P4 ok: preferences read back the defaults, then the member''s choice';

  -- P5 · the feed cursor is (created_at, id): rows sharing one timestamp (here, one transaction) are never skipped
  perform pg_temp.ntf_as(u3);
  select count(*) into n from public.list_my_notifications(100, null, null);
  if n < 2 then raise exception 'P5: setup needs two feed rows with one timestamp (got %)', n; end if;
  select x.created_at, x.id into r from public.list_my_notifications(1, null, null) x;
  if (select count(*) from public.list_my_notifications(100, r.created_at, r.id) x where x.id <> r.id) <> n - 1
     or exists (select 1 from public.list_my_notifications(100, r.created_at, r.id) x where x.id = r.id) then
    raise exception 'P5: the second page must hold every other row, and never the first'; end if;
  perform pg_temp.ntf_owner();
  raise notice 'P5 ok: the feed pages by (created_at, id); equal timestamps are never skipped';

  -- P6 · a digest child cannot point at another member's envelope
  begin
    update public.notification_deliveries d set digest_batch_id = v_new
      from public.notifications x where x.id = d.notification_id and x.recipient_user_id = u3;
    raise exception 'P6: a cross-recipient digest link was accepted';
  exception when check_violation then null;
  end;
  raise notice 'P6 ok: the schema refuses a digest item from another member''s envelope';

  -- P7 · C2O-097 #2: opting out takes effect at once — waiting work is suppressed by the setter itself, and a job a
  -- worker already claimed sends nothing because the snapshot re-checks the current preference
  perform pg_temp.ntf_owner();
  update public.notification_deliveries set next_attempt_at = now() + interval '1 day' where status = 'queued';
  update public.notification_digest_batches set next_attempt_at = now() + interval '1 day' where status = 'queued';
  perform pg_temp.ntf_as(u2);
  perform public.set_notification_preferences(true, 'instant', 7);
  perform pg_temp.ntf_owner();
  perform public.fn_notification_enqueue(u2, 'proof.optout', 'proof:optout:claimed', 'Claimed', 'Claimed.', null, 'urgent');
  select * into r from public.fn_notification_email_claim(60, 8) limit 1;
  if r.id is null or r.job_kind <> 'instant' then raise exception 'P7: setup must claim the urgent item (got %)', r; end if;
  perform public.fn_notification_enqueue(u2, 'proof.optout', 'proof:optout:waiting', 'Waiting', 'Waiting.', null, 'urgent');
  perform pg_temp.ntf_as(u2);
  perform public.set_notification_preferences(true, 'off', 7);
  perform pg_temp.ntf_owner();
  if exists (select 1 from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
              where n.recipient_user_id = u2 and d.status = 'queued') then
    raise exception 'P7: turning email off must suppress waiting work in the same transaction'; end if;
  if exists (select 1 from public.fn_notification_email_snapshot('instant', r.id, r.claim_token, 25)) then
    raise exception 'P7: a job claimed before the opt-out must send nothing (the snapshot re-checks the preference)'; end if;
  raise notice 'P7 ok: an opt-out suppresses waiting email at once and an already-claimed job sends nothing';
  raise notice 'SHARED FIXTURE SERVICES WAVE 4 SMOKE: ALL ASSERTIONS PASSED';
end;
$$;
