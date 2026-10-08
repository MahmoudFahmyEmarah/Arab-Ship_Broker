-- Shared notifications · the email dispatch schedule (20261008110000). BEGIN … ROLLBACK; run as the database owner
-- on an isolated database that carries the shared core, pg_net and Vault:
--   docker exec -i supabase_db_arab-ship-broker psql -U postgres -d <db> -v ON_ERROR_STOP=1 -f - < this file
begin;

insert into auth.users (id, email, aud, role) values ('00000000-0000-4000-8000-0000000d1501', 'dispatch-proof@example.test', 'authenticated', 'authenticated');
insert into public.users (id, supabase_user_id, email, full_name, company, role, subscription_tier, is_active)
values ('00000000-0000-4000-8000-0000000d1501', '00000000-0000-4000-8000-0000000d1501', 'dispatch-proof@example.test', 'Dispatch proof', 'Proof Co', 'cargo_owner', 'T3', true);
create temp table d_q0 as select coalesce(max(id), 0) as id from net.http_request_queue;

-- D1 · no URL configured: email delivery is off, the tick makes no call
do $$
declare n int;
begin
  perform public.fn_notification_enqueue('00000000-0000-4000-8000-0000000d1501', 'proof.urgent', 'proof:1', 'Proof', 'Proof body', null, 'urgent', '{}'::jsonb, true, null, null);
  if (select dispatch_url from public.notification_dispatch_config where id = 1) is not null then raise exception 'D1: the URL must start empty'; end if;
  n := public.fn_notification_dispatch_tick();
  if n <> 0 or exists (select 1 from net.http_request_queue where id > (select id from d_q0)) then raise exception 'D1: no call without a URL (got %)', n; end if;
  raise notice 'D1 ok: without a configured URL the timer makes no call (email delivery off)';
end $$;

-- D2 · the URL is validated: https and the dispatch path only
do $$
declare e text;
begin
  begin perform public.admin_set_notification_dispatch_url('http://staging.example.com/api/cron/fixture-notifications'); e := 'accepted';
  exception when others then e := sqlerrm; end;
  if e not like 'NTF_CONFIG%' then raise exception 'D2: plain http must be refused, got %', e; end if;
  begin perform public.admin_set_notification_dispatch_url('https://staging.example.com/api/anything'); e := 'accepted';
  exception when others then e := sqlerrm; end;
  if e not like 'NTF_CONFIG%' then raise exception 'D2: another path must be refused, got %', e; end if;
  perform public.admin_set_notification_dispatch_url('https://staging.example.com/api/cron/fixture-notifications');
  if (select dispatch_url from public.notification_dispatch_config where id = 1) <> 'https://staging.example.com/api/cron/fixture-notifications' then raise exception 'D2: a valid URL must be stored'; end if;
  raise notice 'D2 ok: only https://<host>/api/cron/fixture-notifications is accepted';
end $$;

-- D3 · one due envelope: one call, to the configured URL, with the Vault token; the route's check accepts only it
do $$
declare n int; r record; v_token text;
begin
  n := public.fn_notification_dispatch_tick();
  if n <> 1 then raise exception 'D3: one due envelope means one call, got %', n; end if;
  select * into r from net.http_request_queue where id > (select id from d_q0) order by id desc limit 1;
  if r.url <> 'https://staging.example.com/api/cron/fixture-notifications' or r.method <> 'POST' then raise exception 'D3: call target %', r.url; end if;
  v_token := substr(r.headers->>'Authorization', 8);
  if r.headers->>'Authorization' not like 'Bearer %' or not public.fn_notification_dispatch_token_matches(v_token) then raise exception 'D3: the call must carry the Vault token'; end if;
  if public.fn_notification_dispatch_token_matches(v_token || 'x') or public.fn_notification_dispatch_token_matches('') or public.fn_notification_dispatch_token_matches(null) then
    raise exception 'D3: any other token must be refused'; end if;
  if length(v_token) < 32 then raise exception 'D3: the token must be long'; end if;
  raise notice 'D3 ok: one due envelope, one call with the Vault token; any other token is refused';
end $$;

-- D4 · a backlog: at most three calls per tick; nothing due: no call
do $$
declare n int; i int;
begin
  for i in 2 .. 6 loop
    perform public.fn_notification_enqueue('00000000-0000-4000-8000-0000000d1501', 'proof.urgent', 'proof:' || i, 'Proof', 'Proof body', null, 'urgent', '{}'::jsonb, true, null, null);
  end loop;
  n := public.fn_notification_dispatch_tick();
  if n <> 3 then raise exception 'D4: a backlog means three calls, got %', n; end if;
  update public.notification_deliveries set status = 'sent', sent_at = now() where status = 'queued';
  update public.notification_digest_batches set status = 'sent', sent_at = now() where status = 'queued';
  n := public.fn_notification_dispatch_tick();
  if n <> 0 then raise exception 'D4: nothing due means no call, got %', n; end if;
  raise notice 'D4 ok: a backlog gets at most three calls per tick; nothing due, no call';
end $$;

-- D5 · schedule and grants
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'notification-dispatch' and schedule = '* * * * *' and command = 'select public.fn_notification_dispatch_tick()') then
    raise exception 'D5: the per-minute job must be scheduled'; end if;
  if has_function_privilege('authenticated', 'public.fn_notification_dispatch_tick()', 'execute')
     or has_function_privilege('authenticated', 'public.admin_set_notification_dispatch_url(text)', 'execute')
     or has_function_privilege('authenticated', 'public.fn_notification_dispatch_token_matches(text)', 'execute')
     or has_function_privilege('anon', 'public.fn_notification_dispatch_token_matches(text)', 'execute') then
    raise exception 'D5: no member may call the dispatch functions'; end if;
  if has_table_privilege('authenticated', 'public.notification_dispatch_config', 'select') or has_table_privilege('service_role', 'public.notification_dispatch_config', 'update') then
    raise exception 'D5: the config is reachable only through its function'; end if;
  if not has_function_privilege('service_role', 'public.fn_notification_dispatch_token_matches(text)', 'execute') then raise exception 'D5: the route needs the token check'; end if;
  raise notice 'D5 ok: every minute; members cannot call or read anything; the route can check a token';
end $$;

-- D6 · the operator alert: an urgent email waiting 10+ minutes alerts every active super admin, once per hour
do $$
declare n int;
begin
  insert into auth.users (id, email, aud, role) values ('00000000-0000-4000-8000-0000000d1502', 'alert-admin@example.test', 'authenticated', 'authenticated');
  insert into public.users (id, supabase_user_id, email, full_name, company, role, admin_tier, subscription_tier, is_active)
  values ('00000000-0000-4000-8000-0000000d1502', '00000000-0000-4000-8000-0000000d1502', 'alert-admin@example.test', 'Alert admin', 'Arab ShipBroker', 'admin', 'super', 'T4', true);
  perform public.fn_notification_enqueue('00000000-0000-4000-8000-0000000d1501', 'proof.urgent', 'proof:late', 'Late', 'Late body', null, 'urgent', '{}'::jsonb, true, null, null);
  update public.notification_deliveries d set created_at = clock_timestamp() - interval '11 minutes'
    from public.notifications x where x.id = d.notification_id and x.dedupe_key = 'proof:late';
  n := public.fn_notification_dispatch_alert();
  if n < 1 or not exists (select 1 from public.notifications where recipient_user_id = '00000000-0000-4000-8000-0000000d1502' and kind = 'system.notification_alert' and payload->>'condition' = 'urgent-waiting') then
    raise exception 'D6: a late urgent email must alert the super admin (n=%)', n; end if;
  perform public.fn_notification_dispatch_alert();
  if (select count(*) from public.notifications where recipient_user_id = '00000000-0000-4000-8000-0000000d1502' and payload->>'condition' = 'urgent-waiting') <> 1 then
    raise exception 'D6: one alert per hour per condition'; end if;
  if has_function_privilege('authenticated', 'public.fn_notification_dispatch_alert()', 'execute') then raise exception 'D6: members cannot raise alerts'; end if;
  raise notice 'D6 ok: a late urgent email alerts the super admins once an hour; members cannot call it';
end $$;

do $$ begin raise notice 'NOTIFICATION DISPATCH SCHEDULE SMOKE: ALL ASSERTIONS PASSED'; end $$;
rollback;
