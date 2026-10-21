#!/usr/bin/env bash
# PDA · two-session race: withdraw versus decline on the same quote request (Codex C2O-159 P1-3; fixture per C2O-161/162).
#
#   ASB_SCRATCH_TOKEN=<32 hex> scripts/db/pda-quote-race.sh <scratch-db-name>
#
# Disposable databases only. The target must carry the private marker the proof harness sets when it clones the
# scratch database:   alter database <scratch> set asb.disposable = '<the same 32-hex token>';
# A database without that exact marker (any shared or long-lived database) is refused, whatever its name.
#
# Session A withdraws and holds its transaction open; session B declines meanwhile. B must wait on the request lock
# and then refuse (PDA_STATE); the request ends withdrawn with its recipient still 'sent' — one valid terminal outcome.
#
# Fixture: a real minimal graph — Auth + app users, member and agency organisations with memberships, two XX ports,
# an owned cargo, vessel and open availability (listing ownership), the agency listed at the load port, one saved
# estimate set and the quote request — all stamped with one run id in the shapes supabase/tests/e2e/pda-agents-teardown.sql
# removes. Setup is ONE transaction (a failure leaves nothing). The EXIT trap always runs that checked-in teardown
# (zero residue proved inside it) and then proves no run-stamped row remains; any failure fails the script.
set -uo pipefail
DBNAME="${1:?scratch database name}"
TOKEN="${ASB_SCRATCH_TOKEN:-}"
[[ "$TOKEN" =~ ^[0-9a-f]{32}$ ]] || { echo "REFUSED: ASB_SCRATCH_TOKEN (32 hex) is required"; exit 2; }
[[ "$DBNAME" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || { echo "REFUSED: not a plain database name"; exit 2; }
PSQL="docker exec -i supabase_db_arab-ship-broker psql -U postgres -d $DBNAME -X -q -At -v ON_ERROR_STOP=1"
MARK=$($PSQL -c "select coalesce(current_setting('asb.disposable', true), '')" 2>/dev/null) || { echo "REFUSED: cannot reach $DBNAME"; exit 2; }
[ "$MARK" = "$TOKEN" ] || { echo "REFUSED: $DBNAME does not carry this run's disposable marker"; exit 2; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2
RUN="pdaag-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
[[ "$RUN" =~ ^pdaag-[0-9a-f]{12}$ ]] || { echo "REFUSED: could not make a run id"; exit 2; }
LOGS="$(mktemp -d)"
OK=1
cleanup(){
  local out residue
  if out=$($PSQL -v run="$RUN" -f - < supabase/tests/e2e/pda-agents-teardown.sql 2>"$LOGS/teardown.err") && [ "$(echo "$out" | tail -1)" = "TEARDOWN OK $RUN" ]; then
    echo "  ok   race teardown: every row of $RUN removed, guards re-enabled"
  else echo "  FAIL race teardown: $(tr '\n' ' ' < "$LOGS/teardown.err" | cut -c1-300)"; OK=0; fi
  residue=$($PSQL -c "select (select count(*) from auth.users where email like 'e2e-$RUN-%')
                         + (select count(*) from public.users where email like 'e2e-$RUN-%')
                         + (select count(*) from public.organizations where name like 'E2E $RUN %')
                         + (select count(*) from public.ports where trade_name like 'E2E ${RUN^^} %')
                         + (select count(*) from public.vessels where vessel_name like 'E2E ${RUN^^} %')
                         + (select count(*) from public.cargo_listings where ref = 'E2E-$RUN')" 2>/dev/null)
  [ "$residue" = "0" ] && echo "  ok   race residue: zero run-stamped rows" || { echo "  FAIL race residue: ${residue:-unreadable}"; OK=0; }
  rm -rf "$LOGS"
  [ $OK = 1 ] && echo "  ok   race: withdraw held the request lock, the concurrent decline waited and was refused (PDA_STATE); one terminal outcome (withdrawn/sent)"
  [ $OK = 1 ]; exit $?
}
trap cleanup EXIT

# ── setup: one transaction
$PSQL -1 -v run="$RUN" > /dev/null 2> "$LOGS/setup.err" <<'SQL' || { echo "  FAIL race setup: $(tr '\n' ' ' < "$LOGS/setup.err" | cut -c1-300)"; OK=0; exit 1; }
select set_config('e2e.run', :'run', true);
do $$
declare
  v_run text := current_setting('e2e.run'); up text := upper(current_setting('e2e.run'));
  admin uuid := gen_random_uuid(); member uuid := gen_random_uuid(); staff uuid := gen_random_uuid();
  member_org uuid; agency uuid; pol text; pod text; cargo uuid; vessel uuid; avail uuid; leg jsonb; route jsonb; s jsonb;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, f.id, 'authenticated', 'authenticated', f.email, crypt('Race1!', gen_salt('bf')), now(), '{}', '{}', now(), now()
  from (values (admin, 'e2e-' || v_run || '-a@arabshipbroker.test'), (member, 'e2e-' || v_run || '-m@arabshipbroker.test'),
               (staff, 'e2e-' || v_run || '-s@arabshipbroker.test')) f(id, email);
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier) values
    (admin, admin, 'e2e-' || v_run || '-a@arabshipbroker.test', 'Race Admin', 'admin', true, null, 'T4'),
    (member, member, 'e2e-' || v_run || '-m@arabshipbroker.test', 'Race Member', 'cargo_owner', true, null, 'T3'),
    (staff, staff, 'e2e-' || v_run || '-s@arabshipbroker.test', 'Race Staff', 'broker', true, null, 'T1');
  insert into public.organizations (name, org_type, desk_contact_name) values ('E2E ' || v_run || ' Charterers', 'broker', 'Desk') returning id into member_org;
  insert into public.organizations (name, org_type, desk_contact_name) values ('E2E ' || v_run || ' Agency', 'broker', 'Desk') returning id into agency;
  insert into public.organization_members (org_id, user_id, member_role, is_current, status) values
    (member_org, member, 'admin', true, 'active'), (agency, staff, 'admin', true, 'active');

  -- two fresh ports under the user-assigned XX prefix (inserted, never upserted)
  pol := 'XX' || substr(up, 7, 3); pod := 'XX' || substr(up, 10, 3);
  if pol = pod then pod := 'XX' || substr(up, 8, 3); end if;
  insert into public.ports (locode, trade_name, country, zone, port_type, is_active, is_verified) values
    (pol, 'E2E ' || up || ' LOAD', 'Egypt', 'E.MED', 'Sea Port', true, true),
    (pod, 'E2E ' || up || ' DISCHARGE', 'Saudi Arabia', 'R.SEA', 'Sea Port', true, true);

  -- the member's own cargo, vessel and open availability (the shapes the browser spec seeds)
  insert into public.cargo_listings (ref, status, review_status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo, qty_min_mt, qty_max_mt,
                                     load_port_locode, load_port_name, load_zone, disch_port_locode, disch_port_name, disch_zone,
                                     laycan_from, laycan_to, is_spot, load_terms, load_rate, disch_rate)
  values ('E2E-' || v_run, 'IN', 'APPROVED', 'Dry Bulk', 'E2E ' || up || ' WHEAT', false, true, 25000, 27500,
          pol, 'E2E ' || up || ' LOAD', 'E.MED', pod, 'E2E ' || up || ' DISCHARGE', 'R.SEA',
          current_date + 10, current_date + 20, false, 'FIOST', 1200, 1200) returning id into cargo;
  insert into public.vessels (vessel_name, imo_number, vessel_type, dwt_grain, gross_tonnage, scnrt, max_loa_m, build_year, flag,
                              is_geared, grain_certified, dg_certified, is_sanctioned)
  values ('E2E ' || up || ' VESSEL', (1000000 + ('x' || substr(v_run, 7, 6))::bit(24)::int % 9000000)::text, 'Bulk Carrier', 35000, 22400, 18500, 182, 2015, 'Malta',
          true, true, false, false) returning id into vessel;
  insert into public.vessel_availability (vessel_id, open_port_locode, open_port_name, open_zone, open_date, status, review_status, service_speed_kn, accepts_part_cargo)
  values (vessel, pol, 'E2E ' || up || ' LOAD', 'E.MED', current_date + 5, 'OPEN', 'APPROVED', 12, false) returning id into avail;
  insert into public.listing_ownership (listing_type, listing_id, owner_user_id, owner_org_id, role, is_current, transfer_reason) values
    ('cargo', cargo, member, member_org, 'primary', true, 'initial_post'),
    ('vessel_availability', avail, member, member_org, 'primary', true, 'initial_post');

  -- the agency, listed at the load port; one saved estimate for the real listings; the quote request
  perform public.pda_admin_upsert_agency(admin, agency, '{"displayName":"Race Agency"}');
  perform public.pda_admin_set_port_agent(admin, agency, pol, array['agency'], true);
  leg := jsonb_build_object('coverage','manual_required','tariffVersionId',null,'nativeCurrency','USD','warnings','[]'::jsonb,'totals',jsonb_build_object('native',1),
         'lines', jsonb_build_array(jsonb_build_object('label','Agency fee','basis','manual','amount',1,'explanation','x','manual',true,'manualReason','Desk estimate','enteredBy','@owner')));
  route := jsonb_build_object('title','race','canonical',jsonb_build_object('vesselAvailabilityId',avail,'vesselId',vessel,'cargoId',cargo,'quantityMt',26000),
         'routeInput',jsonb_build_object('load',jsonb_build_object('portLocode',pol),'discharge',jsonb_build_object('portLocode',pod)),
         'timeline','{}'::jsonb,'transits','[]'::jsonb,'totals','{}'::jsonb,'notSourced','[]'::jsonb,'allocation','vessel','displayCurrency','USD');
  s := public.pda_save_estimate_set(member, member_org,
         jsonb_build_object('portLocode',pol,'callDate',(current_date + 12)::text,'vessel','{}'::jsonb,'call',jsonb_build_object('days',1,'requestedServices',jsonb_build_array('agency'))), leg,
         jsonb_build_object('portLocode',pod,'callDate',(current_date + 20)::text,'vessel','{}'::jsonb,'call',jsonb_build_object('days',1,'requestedServices',jsonb_build_array('agency'))), leg,
         route, null);
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  perform public.create_pda_quote_request((s->>'id')::uuid, 'load', array[agency], array['agency']);
end $$;
SQL

q(){ $PSQL -c "$1"; }
MEMBER=$(q "select id from public.users where email = 'e2e-$RUN-m@arabshipbroker.test'")
STAFF=$(q "select id from public.users where email = 'e2e-$RUN-s@arabshipbroker.test'")
AGENCY=$(q "select id from public.organizations where name = 'E2E $RUN Agency'")
REQ=$(q "select r.id from public.pda_quote_requests r where r.requester_user_id = '$MEMBER'")
[[ "$REQ" =~ ^[0-9a-f-]{36}$ ]] || { echo "  FAIL race setup: no quote request"; OK=0; exit 1; }
claims(){ echo "select set_config('request.jwt.claim.sub', '$1', false), set_config('request.jwt.claims', json_build_object('sub','$1','app_metadata',json_build_object('role','x'))::text, false);"; }

# A: withdraw, then hold the transaction open for 3 s
{ claims "$MEMBER"; echo "begin; select public.withdraw_pda_quote_request('$REQ'); select pg_sleep(3); commit;"; } | $PSQL > "$LOGS/a.log" 2>&1 &
A=$!
# wait until A is inside its hold (its pg_sleep is the active statement), so B provably starts second
HELD=0; for _ in $(seq 1 60); do [ "$(q "select count(*) from pg_stat_activity where datname = current_database() and state = 'active' and query like 'select pg_sleep(3)%'")" = "1" ] && { HELD=1; break; }; sleep 0.25; done
[ $HELD = 1 ] || { echo "  FAIL race: session A never reached its hold"; OK=0; exit 1; }
# B: decline while A holds the request lock
{ claims "$STAFF"; echo "select public.decline_pda_quote_request('$REQ', '$AGENCY', 'No berth window');"; } | $PSQL > "$LOGS/b.log" 2>&1
B_EXIT=$?
wait $A; A_EXIT=$?

STATE=$(q "select r.status || '/' || rc.status from public.pda_quote_requests r join public.pda_quote_request_recipients rc on rc.request_id = r.id where r.id = '$REQ'")
[ "$A_EXIT" = 0 ] || { echo "  FAIL race: the withdrawal failed: $(tr '\n' ' ' < "$LOGS/a.log" | cut -c1-200)"; OK=0; }
if [ "$B_EXIT" = 0 ]; then echo "  FAIL race: the decline succeeded on a request withdrawn while it waited"; OK=0;
else grep -q "PDA_STATE" "$LOGS/b.log" || { echo "  FAIL race: the decline failed for another reason: $(tr '\n' ' ' < "$LOGS/b.log" | cut -c1-200)"; OK=0; }; fi
[ "$STATE" = "withdrawn/sent" ] || { echo "  FAIL race: terminal state is $STATE, expected withdrawn/sent"; OK=0; }
exit 0
