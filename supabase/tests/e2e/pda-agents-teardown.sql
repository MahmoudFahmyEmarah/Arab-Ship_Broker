-- PDA agents browser run · teardown of ONE run (Codex C2O-158/159 P0). Run by scripts/e2e/pda-agents-run.sh only:
--   psql -X -q -At -v ON_ERROR_STOP=1 -v run=<run id> -f supabase/tests/e2e/pda-agents-teardown.sql
-- Everything the run seeded or generated carries its run id (pdaag-<12 hex>): user emails e2e-<run>-*@arabshipbroker.test,
-- organisation, port, vessel and cargo names 'E2E <run> …', cargo ref 'E2E-<run>'. Children are removed before their
-- parents; the append-only guards are disabled only inside this one transaction (DDL is transactional: an error rolls
-- the disable back as well) and re-enabled before commit. The transaction proves zero residue before it commits;
-- any failure aborts it, and the runner reports the run FAILED. Works for a partial seed and for a completed run.
-- Auth (C2O-162 P0-3): the run's Auth accounts are found by email BEFORE anything is deleted, and their sessions,
-- refresh tokens, MFA factors, one-time tokens and identities are deleted explicitly and proved zero (a real browser
-- sign-in creates sessions and refresh tokens). Auth's own audit log is durable and is not touched.
select set_config('e2e.run', :'run', false);

begin;
do $$
declare
  v_run text := current_setting('e2e.run');
  v_users uuid[]; v_auth uuid[]; v_orgs uuid[]; v_sets uuid[] := '{}'; v_reqs uuid[] := '{}'; v_cargo uuid[]; v_vessels uuid[]; v_avail uuid[]; v_ports text[];
  n bigint;
begin
  if v_run !~ '^pdaag-[0-9a-f]{12}$' then raise exception 'TEARDOWN_REFUSED: malformed run id %', v_run; end if;

  select coalesce(array_agg(u.id), '{}') into v_users from public.users u where u.email like 'e2e-' || v_run || '-%@arabshipbroker.test';
  select coalesce(array_agg(a.id), '{}') into v_auth from auth.users a
   where a.email like 'e2e-' || v_run || '-%@arabshipbroker.test' or a.id = any (v_users);
  select coalesce(array_agg(o.id), '{}') into v_orgs from public.organizations o where o.name like 'E2E ' || v_run || ' %';
  select coalesce(array_agg(c.id), '{}') into v_cargo from public.cargo_listings c where c.ref = 'E2E-' || v_run;
  select coalesce(array_agg(v.id), '{}') into v_vessels from public.vessels v where v.vessel_name like 'E2E ' || upper(v_run) || ' %';
  select coalesce(array_agg(a.id), '{}') into v_avail from public.vessel_availability a where a.vessel_id = any (v_vessels);
  select coalesce(array_agg(p.locode), '{}') into v_ports from public.ports p where p.trade_name like 'E2E ' || upper(v_run) || ' %';

  -- PDA records (each table only if this database has it)
  if to_regclass('public.pda_estimate_sets') is not null then
    execute 'select coalesce(array_agg(id), ''{}'') from public.pda_estimate_sets where owner_user_id = any ($1)' into v_sets using v_users;
  end if;
  if to_regclass('public.pda_quote_requests') is not null then
    execute 'select coalesce(array_agg(id), ''{}'') from public.pda_quote_requests where requester_user_id = any ($1) or set_id = any ($2)' into v_reqs using v_users, v_sets;
    if to_regclass('public.pda_quote_acceptances') is not null then
      execute 'alter table public.pda_quote_acceptances disable trigger user';
      execute 'delete from public.pda_quote_acceptances where request_id = any ($1) or accepted_by = any ($2)' using v_reqs, v_users;
      execute 'alter table public.pda_quote_acceptances enable trigger user';
    end if;
    execute 'alter table public.pda_agency_quotes disable trigger user';
    execute 'delete from public.pda_agency_quotes where request_id = any ($1) or submitted_by = any ($2)' using v_reqs, v_users;
    execute 'alter table public.pda_agency_quotes enable trigger user';
    execute 'alter table public.pda_quote_request_recipients disable trigger user';
    execute 'delete from public.pda_quote_request_recipients where request_id = any ($1) or agency_org_id = any ($2)' using v_reqs, v_orgs;
    execute 'alter table public.pda_quote_request_recipients enable trigger user';
    execute 'alter table public.pda_quote_requests disable trigger user';
    execute 'delete from public.pda_quote_requests where id = any ($1)' using v_reqs;
    execute 'alter table public.pda_quote_requests enable trigger user';
  end if;
  if to_regclass('public.pda_estimate_sets') is not null then
    execute 'alter table public.pda_estimate_sets disable trigger user';
    execute 'delete from public.pda_estimate_sets where id = any ($1)' using v_sets;
    execute 'alter table public.pda_estimate_sets enable trigger user';
  end if;
  if to_regclass('public.pda_port_agents') is not null then
    execute 'alter table public.pda_agency_events disable trigger user';
    execute 'delete from public.pda_agency_events where org_id = any ($1)' using v_orgs;
    execute 'alter table public.pda_agency_events enable trigger user';
    execute 'delete from public.pda_port_agents where org_id = any ($1) or port_locode = any ($2)' using v_orgs, v_ports;
    execute 'delete from public.pda_agencies where org_id = any ($1)' using v_orgs;
  end if;
  if to_regclass('public.pda_member_preferences') is not null then
    execute 'delete from public.pda_member_preferences where user_id = any ($1)' using v_users;
  end if;
  alter table public.pda_estimate_lines disable trigger trg_pda_estimate_lines_immutable;
  alter table public.pda_estimates disable trigger trg_pda_estimates_immutable;
  delete from public.pda_estimate_lines where estimate_id in (select id from public.pda_estimates where owner_user_id = any (v_users));
  delete from public.pda_estimates where owner_user_id = any (v_users);
  alter table public.pda_estimates enable trigger trg_pda_estimates_immutable;
  alter table public.pda_estimate_lines enable trigger trg_pda_estimate_lines_immutable;

  -- notifications for the run's users
  alter table public.notifications disable trigger notifications_snapshot_guard;
  delete from public.notification_deliveries where notification_id in (select id from public.notifications where recipient_user_id = any (v_users));
  delete from public.notifications where recipient_user_id = any (v_users);
  alter table public.notifications enable trigger notifications_snapshot_guard;
  delete from public.notification_digest_batches where recipient_user_id = any (v_users);

  -- base rows
  delete from market_private.listing_handles where actor_user_id = any (v_users);
  delete from public.listing_ownership where owner_user_id = any (v_users) or listing_id = any (v_cargo || v_avail);
  delete from public.matches where cargo_id = any (v_cargo) or vessel_avail_id = any (v_avail);
  delete from public.vessel_availability where id = any (v_avail);
  delete from public.vessels where id = any (v_vessels);
  delete from public.cargo_listings where id = any (v_cargo);
  delete from public.ports where locode = any (v_ports);
  delete from public.profiles where account_id = any (v_users);
  delete from public.organization_members where user_id = any (v_users) or org_id = any (v_orgs);
  delete from public.users where id = any (v_users);
  delete from public.organizations where id = any (v_orgs);
  delete from auth.mfa_factors where user_id = any (v_auth);
  delete from auth.refresh_tokens where user_id = any (select x::text from unnest(v_auth) x);
  delete from auth.sessions where user_id = any (v_auth);
  if to_regclass('auth.one_time_tokens') is not null then
    execute 'delete from auth.one_time_tokens where user_id = any ($1)' using v_auth;
  end if;
  delete from auth.identities where user_id = any (v_auth);
  delete from auth.users where id = any (v_auth);

  -- zero residue, or the whole teardown aborts
  select (select count(*) from public.users where email like 'e2e-' || v_run || '-%')
       + (select count(*) from auth.users where email like 'e2e-' || v_run || '-%')
       + (select count(*) from public.organizations where name like 'E2E ' || v_run || ' %')
       + (select count(*) from public.ports where trade_name like 'E2E ' || upper(v_run) || ' %')
       + (select count(*) from public.vessels where vessel_name like 'E2E ' || upper(v_run) || ' %')
       + (select count(*) from public.cargo_listings where ref = 'E2E-' || v_run)
       + (select count(*) from public.pda_estimates where owner_user_id = any (v_users))
       + (select count(*) from public.notifications where recipient_user_id = any (v_users))
       + (select count(*) from auth.identities where user_id = any (v_auth))
       + (select count(*) from auth.sessions where user_id = any (v_auth))
       + (select count(*) from auth.refresh_tokens where user_id = any (select x::text from unnest(v_auth) x))
       + (select count(*) from auth.mfa_factors where user_id = any (v_auth)) into n;
  if n <> 0 then raise exception 'TEARDOWN_RESIDUE: % run-stamped row(s) remain for %', n, v_run; end if;
  if exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
             where s.nspname = 'public' and not t.tgisinternal and t.tgenabled = 'D'
               and (c.relname like 'pda\_%' or c.relname = 'notifications')) then
    raise exception 'TEARDOWN_TRIGGERS: a trigger this teardown disabled is still disabled';
  end if;
end $$;
commit;

select 'TEARDOWN OK ' || current_setting('e2e.run');
