-- Data Quality · workstream E smoke test (19 Sep 2026)
-- for 20260919140000_dq_e_policy_and_audit.sql. BEGIN … ROLLBACK.

begin;

do $$
declare v_rule uuid; n int; v_ok boolean; e record;
begin
  select id into v_rule from public.dq_rules where deleted_at is null order by code limit 1;

  -- ── S1 · a channel-mode change is recorded with before and after ─────────
  delete from public.dq_rule_channels where rule_id = v_rule and channel = 'api';
  insert into public.dq_rule_channels (rule_id, channel, mode) values (v_rule, 'api', 'warn');
  update public.dq_rule_channels set mode = 'block' where rule_id = v_rule and channel = 'api';
  select * into e from public.dq_config_events where kind = 'channel_mode' order by id desc limit 1;
  if e.before->>'mode' <> 'warn' or e.after->>'mode' <> 'block' or e.key not like '%/api' then raise exception 'S1: channel event wrong: % % %', e.key, e.before, e.after; end if;

  -- ── S2 · a settings change records only what changed ────────────────────
  perform set_config('dq.actor_name', 'smoke', true);
  update public.dq_settings set ai_sample = case when ai_sample = 40 then 41 else 40 end where id = 1;
  select * into e from public.dq_config_events where kind = 'settings' order by id desc limit 1;
  if not (e.after ? 'ai_sample') or (e.after ? 'batch_size') or e.actor_name <> 'smoke' then raise exception 'S2: settings event wrong: % %', e.after, e.actor_name; end if;
  -- an update that changes nothing records nothing
  select count(*) into n from public.dq_config_events;
  update public.dq_settings set updated_at = now() where id = 1;
  if (select count(*) from public.dq_config_events) <> n then raise exception 'S2: a no-op update was recorded'; end if;

  -- ── S3 · limits hold at the database ─────────────────────────────────────
  v_ok := false;
  begin update public.dq_settings set ai_daily_tokens = -1 where id = 1; exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'S3: a negative token budget was accepted'; end if;
  v_ok := false;
  begin update public.dq_settings set nightly_time = '25:99' where id = 1; exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'S3: an impossible nightly time was accepted'; end if;
  v_ok := false;
  begin update public.dq_settings set auto_apply_threshold = 1.5 where id = 1; exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'S3: a threshold above 1 was accepted'; end if;

  raise notice 'DQ E SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
