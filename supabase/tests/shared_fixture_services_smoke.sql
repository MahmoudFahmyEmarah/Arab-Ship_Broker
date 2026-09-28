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
  d public.notification_deliveries%rowtype;
  first_token uuid;
  n integer;
  refused boolean := false;
begin
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

  perform pg_temp.ntf_as(u1);
  if public.notification_badge() <> 1 then raise exception 'N2: recipient badge'; end if;
  if (select count(*) from public.list_my_notifications(30, null)) <> 1 then raise exception 'N2: recipient feed'; end if;
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
  begin
    perform public.fn_notification_enqueue(
      u1, 'fixture.expired', 'fixture/room-1/expired', 'Expired notice',
      'This notification must be refused.', null, 'normal', '{}'::jsonb,
      false, null, now() - interval '1 second'
    );
    raise exception 'N4: past expiry accepted';
  exception when invalid_parameter_value then null;
  end;

  update public.notification_deliveries
     set next_attempt_at = now() - interval '1 minute'
   where notification_id = n1;
  select * into d from public.fn_notification_delivery_claim(10, 600, 8) limit 1;
  if d.id is null or d.status <> 'sending' or d.claim_token is null then
    raise exception 'N5: due delivery not claimed';
  end if;
  if public.fn_notification_delivery_settle(d.id, gen_random_uuid(), true, null, 8) then
    raise exception 'N5: wrong claim token settled delivery';
  end if;
  first_token := d.claim_token;
  update public.notification_deliveries
     set lease_until = now() - interval '1 second'
   where id = d.id;
  select * into d from public.fn_notification_delivery_claim(10, 600, 8) limit 1;
  if d.id is null or d.claim_token = first_token or d.attempts <> 2 then
    raise exception 'N5: expired lease was not reclaimed safely';
  end if;
  if not public.fn_notification_delivery_settle(d.id, d.claim_token, true, null, 8) then
    raise exception 'N5: valid claim did not settle';
  end if;
  if (select status from public.notification_deliveries where id = d.id) <> 'sent' then
    raise exception 'N5: sent status missing';
  end if;

  n3 := public.fn_notification_enqueue(
    u2, 'fixture.retry', 'fixture/room-2/retry', 'Retry notice',
    'This delivery exercises the retry ceiling.', null, 'urgent'
  );
  select * into d from public.fn_notification_delivery_claim(1, 600, 1) limit 1;
  if d.notification_id <> n3 or not public.fn_notification_delivery_settle(d.id, d.claim_token, false, 'test failure', 1) then
    raise exception 'N5: bounded failure did not settle';
  end if;
  if (select status from public.notification_deliveries where notification_id = n3) <> 'failed' then
    raise exception 'N5: retry ceiling did not fail delivery';
  end if;

  n4 := public.fn_notification_enqueue(
    u2, 'fixture.inactive', 'fixture/room-2/inactive', 'Inactive notice',
    'This delivery must be suppressed before claim.', null, 'urgent'
  );
  update public.users set is_active = false where id = u2;
  select * into d from public.fn_notification_delivery_claim(10, 600, 8) limit 1;
  if d.id is not null then raise exception 'N5: inactive recipient delivery was claimed'; end if;
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
