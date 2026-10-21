-- PDA agents staging run · read-only preflight invariants (Codex C2O-160 / C2O-162 P0-1). Run by
-- scripts/e2e/pda-agents-preflight.sh inside a READ ONLY transaction, before the runner may write anything. Prints one
-- 'ok'/'FAIL' line per invariant and a last line 'PREFLIGHT INVARIANTS OK' only when every one holds.
--
--   I1  the 15:27 run (19 Oct, staging-browser-run-20261019-152658, pre-runner spec) left nothing: no row of ANY identity
--       shape that spec could create (its exact stamp was not kept, so every stamp of those shapes is checked), across
--       Auth (users, identities, sessions, refresh tokens, MFA, one-time tokens), public, market_private and the
--       notification descendants; plus no orphaned descendant of a deleted user or listing
--   I2  no run of the CURRENT runner left anything either (the pdaag-<12 hex> shapes)
--   I3  the post-Wave-7 target: none of the Wave 8 / Agents objects exists (the runner applies them unrecorded)
--   I4  every named guard trigger is present and enabled
--   I5  email dispatch is off, and beta_mode is exactly the pinned post-Wave-7 value
begin transaction read only;
do $pf$
declare
  n bigint; bad int := 0; acc text := ''; r record;
begin
  -- I1 · the 15:27 run's shapes (e2e/pda-agents.spec.ts at c49618d: emails e2e-pda-ag-{m,s,a}-<stamp>@arabshipbroker.test,
  --       orgs 'E2E Agents Charterers|E2E Portal Agency|E2E Email Agency <S>', ports 'E2E AGENTS PORT …', vessel
  --       'E2E AGENTS VESSEL …', cargo ref 'E2EPDAAG-…' / commodity 'E2E AGENTS WHEAT …', profile 'E2E Agents Member')
  select (select count(*) from auth.users where email like 'e2e-pda-ag-%@arabshipbroker.test')
       + (select count(*) from auth.identities i where i.identity_data->>'email' like 'e2e-pda-ag-%@arabshipbroker.test')
       + (select count(*) from public.users where email like 'e2e-pda-ag-%@arabshipbroker.test')
       + (select count(*) from public.organizations where name like 'E2E Agents Charterers %' or name like 'E2E Portal Agency %' or name like 'E2E Email Agency %')
       + (select count(*) from public.ports where trade_name like 'E2E AGENTS PORT %')
       + (select count(*) from public.vessels where vessel_name like 'E2E AGENTS VESSEL %')
       + (select count(*) from public.cargo_listings where ref like 'E2EPDAAG-%' or commodity_name like 'E2E AGENTS WHEAT %')
       + (select count(*) from public.profiles where display_name in ('E2E Agents Member', 'E2E Agency Staff', 'E2E Agents Owner'))
    into n;
  acc := acc || case when n = 0 then 'ok   ' else 'FAIL ' end || 'I1 15:27-run identity shapes remaining: ' || n || E'\n'; bad := bad + (n <> 0)::int;

  -- I1 · orphans a partial delete would leave (one line per class, so pre-existing orphans can be told from 15:27 residue)
  for r in
    select 'auth.identities without a user' as what, (select count(*) from auth.identities i where not exists (select 1 from auth.users u where u.id = i.user_id)) as n
    union all select 'auth.sessions without a user', (select count(*) from auth.sessions s where not exists (select 1 from auth.users u where u.id = s.user_id))
    union all select 'auth.refresh_tokens without a user', (select count(*) from auth.refresh_tokens t where t.user_id is not null and not exists (select 1 from auth.users u where u.id::text = t.user_id))
    union all select 'auth.mfa_factors without a user', (select count(*) from auth.mfa_factors f where not exists (select 1 from auth.users u where u.id = f.user_id))
    union all select 'public.users without an Auth account', (select count(*) from public.users p where p.supabase_user_id is not null and not exists (select 1 from auth.users u where u.id = p.supabase_user_id))
    union all select 'notifications without a recipient', (select count(*) from public.notifications x where not exists (select 1 from public.users u where u.id = x.recipient_user_id))
    union all select 'notification_deliveries without a notification', (select count(*) from public.notification_deliveries d where not exists (select 1 from public.notifications x where x.id = d.notification_id))
    union all select 'notification_digest_batches without a recipient', (select count(*) from public.notification_digest_batches b where not exists (select 1 from public.users u where u.id = b.recipient_user_id))
    union all select 'listing_ownership (cargo) without a listing', (select count(*) from public.listing_ownership o where o.listing_type = 'cargo' and not exists (select 1 from public.cargo_listings c where c.id = o.listing_id))
    union all select 'listing_ownership (availability) without a listing', (select count(*) from public.listing_ownership o where o.listing_type = 'vessel_availability' and not exists (select 1 from public.vessel_availability a where a.id = o.listing_id))
    union all select 'market_private.listing_handles without an actor', (select count(*) from market_private.listing_handles h where h.actor_user_id is not null and not exists (select 1 from public.users u where u.id = h.actor_user_id))
    union all select 'organization_members without a user', (select count(*) from public.organization_members m where not exists (select 1 from public.users u where u.id = m.user_id))
  loop
    acc := acc || case when r.n = 0 then 'ok   ' else 'FAIL ' end || 'I1.orphans ' || r.what || ': ' || r.n || E'\n'; bad := bad + (r.n <> 0)::int;
  end loop;

  -- I2 · the current runner's shapes (pdaag-<12 hex>) and the race fixture's
  select (select count(*) from auth.users where email ~ '^e2e-pdaag-[0-9a-f]{12}-')
       + (select count(*) from public.users where email ~ '^e2e-pdaag-[0-9a-f]{12}-')
       + (select count(*) from public.organizations where name ~ '^E2E pdaag-[0-9a-f]{12} ')
       + (select count(*) from public.ports where trade_name ~ '^E2E PDAAG-[0-9A-F]{12} ')
       + (select count(*) from public.vessels where vessel_name ~ '^E2E PDAAG-[0-9A-F]{12} ')
       + (select count(*) from public.cargo_listings where ref ~ '^E2E-pdaag-[0-9a-f]{12}$')
       + (select count(*) from pg_namespace where nspname = 'race_fixture')
    into n;
  acc := acc || case when n = 0 then 'ok   ' else 'FAIL ' end || 'I2 runner/race identity shapes remaining: ' || n || E'\n'; bad := bad + (n <> 0)::int;

  -- I3 · post-Wave-7: no Wave 8 / Agents object exists
  select count(*) into n from (values
      ('public.pda_member_preferences'), ('public.pda_estimate_sets'), ('public.pda_agencies'), ('public.pda_port_agents'),
      ('public.pda_agency_events'), ('public.pda_quote_requests'), ('public.pda_quote_request_recipients'),
      ('public.pda_agency_quotes'), ('public.pda_quote_acceptances')) t(rel)
   where to_regclass(t.rel) is not null;
  select n + count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('list_pda_ports_workspace', 'get_my_pda_preferences', 'pda_save_estimate_set', 'get_my_pda_agency',
         'create_pda_quote_request', 'pda_accept_agency_quote', 'pda_admin_record_agency_quote', 'list_pda_tariff_packs');
  acc := acc || case when n = 0 then 'ok   ' else 'FAIL ' end || 'I3 Wave 8 / Agents objects present (must be 0 on the post-Wave-7 target): ' || n || E'\n'; bad := bad + (n <> 0)::int;

  -- I4 · named guards present and enabled
  select count(*) into n from (values
      ('public.pda_estimates', 'trg_pda_estimates_immutable'), ('public.pda_estimate_lines', 'trg_pda_estimate_lines_immutable'),
      ('public.notifications', 'notifications_snapshot_guard')) g(rel, tg)
   where not exists (select 1 from pg_trigger t where t.tgrelid = to_regclass(g.rel) and t.tgname = g.tg and t.tgenabled = 'O');
  select n + count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
   where s.nspname in ('public', 'market_private', 'fixture_private') and not t.tgisinternal and t.tgenabled = 'D';
  acc := acc || case when n = 0 then 'ok   ' else 'FAIL ' end || 'I4 named guards missing/disabled, or any application trigger disabled: ' || n || E'\n'; bad := bad + (n <> 0)::int;

  -- I5 · email off, beta pinned (post-Wave-7 staging: beta_mode true, restored at 15:45 on 19 Oct)
  select (select count(*) from public.notification_dispatch_config where id = 1 and dispatch_url is not null)
       + (select count(*) from public.app_settings where key = 'beta_mode' and value <> 'true'::jsonb)
       + (1 - (select count(*) from public.app_settings where key = 'beta_mode'))
    into n;
  acc := acc || case when n = 0 then 'ok   ' else 'FAIL ' end || 'I5 email dispatch off and beta_mode = true: ' || (n = 0)::text || E'\n'; bad := bad + (n <> 0)::int;

  perform set_config('e2e.preflight', acc || case when bad = 0 then 'PREFLIGHT INVARIANTS OK' else 'PREFLIGHT INVARIANTS FAILED (' || bad || ')' end, false);
end $pf$;
select current_setting('e2e.preflight');
commit;
