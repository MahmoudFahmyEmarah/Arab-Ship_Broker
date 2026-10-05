\set ON_ERROR_STOP on
\if :{?rules_nonce}
\else
  \echo 'rules_nonce psql variable is required'
  \quit 2
\endif

create schema if not exists e2e_guard;
revoke all on schema e2e_guard from public, anon, authenticated, service_role;

create table if not exists e2e_guard.rules_environment (
  singleton boolean primary key default true check (singleton),
  nonce text not null check (length(nonce) >= 32),
  created_at timestamptz not null default clock_timestamp()
);
revoke all on table e2e_guard.rules_environment from public, anon, authenticated, service_role;

truncate table e2e_guard.rules_environment;
insert into e2e_guard.rules_environment (singleton, nonce) values (true, :'rules_nonce');

create or replace function public.e2e_rules_environment_snapshot(p_nonce text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_valid boolean;
begin
  select exists (
    select 1
    from e2e_guard.rules_environment e
    where e.singleton and e.nonce = p_nonce
  ) into v_valid;
  if not coalesce(v_valid, false) then
    raise exception 'E2E_RULES_GUARD: disposable environment nonce mismatch'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'marker', true,
     'matching', jsonb_build_object(
       'versions', (select count(*) from public.matching_rule_versions),
       'events', (select count(*) from public.matching_rule_events),
       'requests', (select count(*) from public.matching_rule_requests),
       'activeId', (select active_version_id from public.matching_rule_state where singleton),
       'revision', (select activation_sequence from public.matching_rule_state where singleton),
       'versionsHash', pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
         coalesce((
           select jsonb_agg(to_jsonb(v) order by v.version_no, v.id)::text
           from public.matching_rule_versions v
         ), '[]'), 'UTF8'), 'sha256'), 'hex'),
       'eventsHash', pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
         coalesce((
           select jsonb_agg(to_jsonb(e) order by e.id)::text
           from public.matching_rule_events e
         ), '[]'), 'UTF8'), 'sha256'), 'hex'),
       'requestsHash', pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
         coalesce((
           select jsonb_agg(to_jsonb(r) order by r.request_id)::text
           from public.matching_rule_requests r
         ), '[]'), 'UTF8'), 'sha256'), 'hex'),
       'stateHash', pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
         coalesce((
           select to_jsonb(s)::text
           from public.matching_rule_state s
           where s.singleton
         ), '{}'), 'UTF8'), 'sha256'), 'hex')
     ),
     'intelligence', jsonb_build_object(
       'versions', (select count(*) from public.intelligence_rule_sets),
       'events', (select count(*) from public.intelligence_rule_events),
       'requests', (select count(*) from public.intelligence_rule_requests),
       'activeId', (select active_rule_set_id from public.intelligence_rule_state where singleton),
       'revision', (select revision from public.intelligence_rule_state where singleton),
       'versionsHash', pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
         jsonb_build_object(
           'sets', coalesce((
             select jsonb_agg(to_jsonb(s) order by s.version_no, s.id)
             from public.intelligence_rule_sets s
           ), '[]'::jsonb),
           'groups', coalesce((
             select jsonb_agg(to_jsonb(g) order by g.rule_set_id, g.priority, g.code)
             from public.intelligence_rule_groups g
           ), '[]'::jsonb),
           'rules', coalesce((
             select jsonb_agg(to_jsonb(r) order by r.rule_set_id, r.priority, r.rule_code)
             from public.intelligence_rules r
           ), '[]'::jsonb),
           'provenance', coalesce((
             select jsonb_agg(to_jsonb(p) order by p.rule_set_id, p.rule_code)
             from public.intelligence_rule_provenance p
           ), '[]'::jsonb)
         )::text, 'UTF8'), 'sha256'), 'hex'),
       'eventsHash', pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
         coalesce((
           select jsonb_agg(to_jsonb(e) order by e.id)::text
           from public.intelligence_rule_events e
         ), '[]'), 'UTF8'), 'sha256'), 'hex'),
       'requestsHash', pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
         coalesce((
           select jsonb_agg(to_jsonb(r) order by r.actor_user_id, r.command, r.request_id)::text
           from public.intelligence_rule_requests r
         ), '[]'), 'UTF8'), 'sha256'), 'hex'),
       'stateHash', pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
         coalesce((
           select to_jsonb(s)::text
           from public.intelligence_rule_state s
           where s.singleton
         ), '{}'), 'UTF8'), 'sha256'), 'hex')
     )
  );
end;
$function$;

revoke all on function public.e2e_rules_environment_snapshot(text) from public, anon, authenticated;
grant execute on function public.e2e_rules_environment_snapshot(text) to service_role;
