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
  if has_function_privilege('anon', 'public.list_my_notifications(integer,timestamptz)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.list_my_notifications(integer,timestamptz)', 'EXECUTE') then
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

  -- Model an item that was valid when the envelope was first rendered but
  -- expires before an ambiguous SMTP attempt is reclaimed. The original
  -- envelope must remain byte-stable under its stable Message-ID.
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

  select * into j from public.fn_notification_email_claim(600, 8);
  if j.job_kind <> 'digest' or j.id <> digest_batch or j.claim_token is null or j.attempts <> 1 then
    raise exception 'N5: due digest envelope not claimed first';
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
  if j.job_kind <> 'digest' or j.claim_token = first_token or j.attempts <> 2 then
    raise exception 'N5: expired digest lease was not reclaimed safely';
  end if;
  select jsonb_agg(to_jsonb(s) order by s.created_at, s.id)
    into retry_snapshot
    from public.fn_notification_email_snapshot('digest', j.id, j.claim_token, 25) s;
  if retry_snapshot is distinct from first_snapshot
     or (select snapshot_at from public.notification_digest_batches where id = digest_batch) is distinct from first_snapshot_at then
    raise exception 'N5: digest retry changed the frozen envelope under one message id';
  end if;
  if not public.fn_notification_email_settle('digest', j.id, j.claim_token, 'sent', null, 8) then
    raise exception 'N5: valid digest claim did not settle';
  end if;
  if (select count(*) from public.notification_deliveries where digest_batch_id = digest_batch and status = 'sent') <> 3
     or (select status from public.notification_deliveries where notification_id = n_late) <> 'queued' then
    raise exception 'N5: digest children did not settle together';
  end if;

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
