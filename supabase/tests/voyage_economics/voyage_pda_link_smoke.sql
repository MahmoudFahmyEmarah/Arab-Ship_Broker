-- Voyage Economics · the port DA from a saved PDA estimate (7 Oct 2026, Wave 3)
-- for 20261007200000_voyage_pda_estimates.sql (list_voyage_pda_estimates) and the save's
-- get_pda_estimate read.
--
--   docker exec -i supabase_db_arab-ship-broker psql -U postgres -d <db> -v ON_ERROR_STOP=1 -f - \
--     < supabase/tests/voyage_economics/voyage_pda_link_smoke.sql
--
-- BEGIN … ROLLBACK. Run as the database owner. Every block raises on failure.

begin;

create temp table vp_ids (k text primary key, v uuid not null);
insert into vp_ids values
  ('u_a', '00000000-0000-4000-8000-0000000007a1'), ('u_b', '00000000-0000-4000-8000-0000000007a2'),
  ('e_cur', '00000000-0000-4000-8000-0000000007e1'), ('e_old', '00000000-0000-4000-8000-0000000007e2'),
  ('e_new', '00000000-0000-4000-8000-0000000007e3'), ('e_egp', '00000000-0000-4000-8000-0000000007e4'),
  ('e_b', '00000000-0000-4000-8000-0000000007e5'), ('e_other_port', '00000000-0000-4000-8000-0000000007e6');
grant select on vp_ids to authenticated;
create or replace function pg_temp.vp(p_k text) returns uuid language sql stable as $f$ select v from vp_ids where k = p_k $f$;
create or replace function pg_temp.vp_as(p_k text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.vp(p_k)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.vp(p_k), 'role', 'authenticated',
            'app_metadata', json_build_object('role', 'member'))::text, true);
  execute 'set local role authenticated';
end $f$;

insert into auth.users (id, email, aud, role)
select v, k || '@voyage-pda.test', 'authenticated', 'authenticated' from vp_ids where k like 'u\_%' on conflict (id) do nothing;
insert into public.users (id, supabase_user_id, email, full_name, company, role, subscription_tier, is_active)
select v, v, k || '@voyage-pda.test', 'Voyage PDA ' || k, 'Voyage PDA Co', 'cargo_owner', 'T3', true from vp_ids where k like 'u\_%'
on conflict do nothing;
insert into public.ports (locode, trade_name, country, zone, port_type, is_active, is_verified) values
  ('ZZVPA', 'Voyage PDA Port A', 'Egypt', 'E.MED', 'Sea Port', true, true),
  ('ZZVPB', 'Voyage PDA Port B', 'Egypt', 'E.MED', 'Sea Port', true, true)
on conflict do nothing;

-- manual_required needs no tariff version; the coverage is what the voyage maps to a status
insert into public.pda_estimates (id, owner_user_id, port_locode, terminal_name, call_date, coverage, input_snapshot, native_currency, native_total, converted_currency, converted_total, supersedes_id, generated_at) values
  (pg_temp.vp('e_old'),  pg_temp.vp('u_a'), 'ZZVPA', 'Old berth', date '2026-10-20', 'manual_required', '{}', 'USD', 15000, null, null, null, now() - interval '3 days'),
  (pg_temp.vp('e_new'),  pg_temp.vp('u_a'), 'ZZVPA', 'New berth', date '2026-10-20', 'manual_required', '{}', 'USD', 16000, null, null, pg_temp.vp('e_old'), now() - interval '2 days'),
  (pg_temp.vp('e_cur'),  pg_temp.vp('u_a'), 'ZZVPA', 'Main quay', date '2026-10-21', 'manual_required', '{}', 'USD', 18250.5, null, null, null, now() - interval '1 day'),
  (pg_temp.vp('e_egp'),  pg_temp.vp('u_a'), 'ZZVPA', 'EGP only', date '2026-10-22', 'manual_required', '{}', 'EGP', 900000, null, null, null, now()),
  (pg_temp.vp('e_other_port'), pg_temp.vp('u_a'), 'ZZVPB', 'Port B', date '2026-10-23', 'manual_required', '{}', 'EGP', 800000, 'USD', 16500, null, now()),
  (pg_temp.vp('e_b'),    pg_temp.vp('u_b'), 'ZZVPA', 'Not yours', date '2026-10-21', 'manual_required', '{}', 'USD', 9999, null, null, null, now());

-- ── P1 · the picker lists the member's own current estimates for the port, newest first ─
do $$
declare r jsonb; ids text;
begin
  perform pg_temp.vp_as('u_a');
  r := public.list_voyage_pda_estimates('ZZVPA');
  select string_agg(x->>'id', ',' order by ord) into ids from jsonb_array_elements(r) with ordinality t(x, ord);
  if ids <> concat_ws(',', pg_temp.vp('e_egp'), pg_temp.vp('e_cur'), pg_temp.vp('e_new')) then
    raise exception 'P1: own current estimates newest first expected (superseded and foreign left out), got %', ids; end if;
  if (select x->>'usdTotal' from jsonb_array_elements(r) x where x->>'id' = pg_temp.vp('e_cur')::text)::numeric <> 18250.5
     or (select x->'usdTotal' from jsonb_array_elements(r) x where x->>'id' = pg_temp.vp('e_egp')::text) <> 'null'::jsonb then
    raise exception 'P1: usdTotal is the USD total, or null when the estimate has none: %', r; end if;
  r := public.list_voyage_pda_estimates('ZZVPB');
  if jsonb_array_length(r) <> 1 or (r->0->>'usdTotal')::numeric <> 16500 then raise exception 'P1: a converted USD total is offered: %', r; end if;
  if public.list_voyage_pda_estimates('zzvpa') <> '[]'::jsonb or public.list_voyage_pda_estimates('') <> '[]'::jsonb or public.list_voyage_pda_estimates(null) <> '[]'::jsonb then
    raise exception 'P1: a malformed port lists nothing'; end if;
  raise notice 'P1 ok: own, current, newest first; USD total native or converted, null otherwise; malformed port lists nothing';
end $$;

-- ── P2 · another member sees only their own; the save's read refuses a foreign estimate ─
do $$
declare r jsonb; v_refused boolean := false;
begin
  perform pg_temp.vp_as('u_b');
  r := public.list_voyage_pda_estimates('ZZVPA');
  if jsonb_array_length(r) <> 1 or r->0->>'id' <> pg_temp.vp('e_b')::text then raise exception 'P2: member B sees only their own: %', r; end if;
  begin
    perform public.get_pda_estimate(pg_temp.vp('e_cur'));
  exception when others then
    v_refused := sqlerrm like 'PDA_AUTH%';
  end;
  if not v_refused then raise exception 'P2: get_pda_estimate must refuse another member''s estimate'; end if;
  perform pg_temp.vp_as('u_a');
  r := public.get_pda_estimate(pg_temp.vp('e_cur'));
  if r->>'portLocode' <> 'ZZVPA' or r->>'coverage' <> 'manual_required' or r->>'nativeCurrency' <> 'USD' or (r->>'nativeTotal')::numeric <> 18250.5 then
    raise exception 'P2: the save reads the fields pdaFromEstimate needs: %', r; end if;
  raise notice 'P2 ok: members see only their own estimates; the save''s read refuses a foreign one and carries port, coverage and totals';
end $$;

-- ── P3 · grants ──────────────────────────────────────────────────────────────
do $$
begin
  reset role;
  if has_function_privilege('anon', 'public.list_voyage_pda_estimates(text)', 'execute')
     or has_function_privilege('service_role', 'public.list_voyage_pda_estimates(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.list_voyage_pda_estimates(text)', 'execute') then
    raise exception 'P3: the picker is member-session only'; end if;
  if not exists (select 1 from pg_proc where oid = 'public.list_voyage_pda_estimates(text)'::regprocedure and prosecdef
                   and array_to_string(proconfig, ',') like '%search_path=pg_catalog, public%') then
    raise exception 'P3: security definer with a fixed search_path'; end if;
  raise notice 'P3 ok: member-session only, security definer, fixed search_path';
end $$;

do $$ begin raise notice 'VOYAGE PDA LINK SMOKE: ALL ASSERTIONS PASSED'; end $$;

rollback;
