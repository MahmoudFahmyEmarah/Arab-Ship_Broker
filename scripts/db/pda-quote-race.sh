#!/usr/bin/env bash
# PDA · two-session race: withdraw versus decline on the same quote request (Codex C2O-159 P1-3).
# Run by the isolated DB proof against a scratch database only:  scripts/db/pda-quote-race.sh <scratch-db-name>
# Session A withdraws and holds its transaction open; session B declines meanwhile. B must wait on the request lock
# and then refuse (PDA_STATE); the request ends withdrawn with its recipient still 'sent' — one valid terminal outcome.
# The fixture is committed in the scratch database (under the race_fixture schema for its ids) and dropped at the end.
set -uo pipefail
DBNAME="${1:?scratch database name}"
case "$DBNAME" in postgres|asb_e2e|asb_fixture|template*) echo "REFUSED: $DBNAME is not a scratch database"; exit 2;; esac
PSQL="docker exec -i supabase_db_arab-ship-broker psql -U postgres -d $DBNAME -X -q -At -v ON_ERROR_STOP=1"

$PSQL > /dev/null <<'SQL' || { echo "FAIL race setup"; exit 1; }
create schema race_fixture;
create table race_fixture.ids (k text primary key, v uuid not null);
do $$
declare
  admin uuid := gen_random_uuid(); member uuid := gen_random_uuid(); staff uuid := gen_random_uuid();
  member_org uuid := gen_random_uuid(); agency uuid := gen_random_uuid(); pol text; pod text; leg jsonb; route jsonb; s jsonb; r jsonb;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, f.id, 'authenticated', 'authenticated', f.email, crypt('Race1!', gen_salt('bf')), now(), '{}', '{}', now(), now()
  from (values (admin, 'race-admin@example.test'), (member, 'race-member@example.test'), (staff, 'race-staff@example.test')) f(id, email);
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier) values
    (admin, admin, 'race-admin@example.test', 'Race Admin', 'admin', true, null, 'T4'),
    (member, member, 'race-member@example.test', 'Race Member', 'cargo_owner', true, null, 'T3'),
    (staff, staff, 'race-staff@example.test', 'Race Staff', 'broker', true, null, 'T1');
  insert into public.organizations (id, name) values (member_org, 'Race Charterers'), (agency, 'Race Agency SAE');
  insert into public.organization_members (org_id, user_id, member_role, is_current, status) values
    (member_org, member, 'admin', true, 'active'), (agency, staff, 'admin', true, 'active');
  select locode into pol from public.ports where is_active and is_verified order by locode limit 1;
  select locode into pod from public.ports where is_active and is_verified and locode <> pol order by locode limit 1;
  perform public.pda_admin_upsert_agency(admin, agency, '{"displayName":"Race Agency"}');
  perform public.pda_admin_set_port_agent(admin, agency, pol, array['agency'], true);
  leg := jsonb_build_object('coverage','manual_required','tariffVersionId',null,'nativeCurrency','USD','warnings','[]'::jsonb,'totals',jsonb_build_object('native',1),
         'lines', jsonb_build_array(jsonb_build_object('label','Agency fee','basis','manual','amount',1,'explanation','x','manual',true,'manualReason','Desk estimate','enteredBy','@owner')));
  route := jsonb_build_object('title','race','canonical',jsonb_build_object('vesselAvailabilityId',gen_random_uuid(),'vesselId',null,'cargoId',gen_random_uuid(),'quantityMt',1),
         'routeInput',jsonb_build_object('load',jsonb_build_object('portLocode',pol),'discharge',jsonb_build_object('portLocode',pod)),
         'timeline','{}'::jsonb,'transits','[]'::jsonb,'totals','{}'::jsonb,'notSourced','[]'::jsonb,'allocation','vessel','displayCurrency','USD');
  s := public.pda_save_estimate_set(member, member_org,
         jsonb_build_object('portLocode',pol,'callDate','2026-11-01','vessel','{}'::jsonb,'call',jsonb_build_object('days',1,'requestedServices',jsonb_build_array('agency'))), leg,
         jsonb_build_object('portLocode',pod,'callDate','2026-11-09','vessel','{}'::jsonb,'call',jsonb_build_object('days',1,'requestedServices',jsonb_build_array('agency'))), leg,
         route, null);
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  r := public.create_pda_quote_request((s->>'id')::uuid, 'load', array[agency], array['agency']);
  insert into race_fixture.ids values ('member', member), ('staff', staff), ('agency', agency), ('request', (r->>'requestId')::uuid);
end $$;
SQL

id(){ $PSQL -c "select v from race_fixture.ids where k = '$1'"; }
MEMBER=$(id member); STAFF=$(id staff); AGENCY=$(id agency); REQ=$(id request)
claims(){ echo "select set_config('request.jwt.claim.sub', '$1', false), set_config('request.jwt.claims', json_build_object('sub','$1','app_metadata',json_build_object('role','x'))::text, false);"; }

# A: withdraw, then hold the transaction open for 3 s
{ claims "$MEMBER"; echo "begin; select public.withdraw_pda_quote_request('$REQ'); select pg_sleep(3); commit;"; } | $PSQL > /tmp/pda-race-a.log 2>&1 &
A=$!
sleep 1
# B: decline while A holds the request lock
{ claims "$STAFF"; echo "select public.decline_pda_quote_request('$REQ', '$AGENCY', 'No berth window');"; } | $PSQL > /tmp/pda-race-b.log 2>&1
B_EXIT=$?
wait $A; A_EXIT=$?

STATE=$($PSQL -c "select r.status || '/' || rc.status from public.pda_quote_requests r join public.pda_quote_request_recipients rc on rc.request_id = r.id where r.id = '$REQ'")
$PSQL -c "drop schema race_fixture cascade" > /dev/null
OK=1
[ "$A_EXIT" = 0 ] || { echo "  FAIL race: the withdrawal failed"; cat /tmp/pda-race-a.log; OK=0; }
if [ "$B_EXIT" = 0 ]; then echo "  FAIL race: the decline succeeded on a request withdrawn while it waited"; OK=0;
else grep -q "PDA_STATE" /tmp/pda-race-b.log || { echo "  FAIL race: the decline failed for another reason"; cat /tmp/pda-race-b.log; OK=0; }; fi
[ "$STATE" = "withdrawn/sent" ] || { echo "  FAIL race: terminal state is $STATE, expected withdrawn/sent"; OK=0; }
[ $OK = 1 ] && echo "  ok   race: withdraw held the request lock, the concurrent decline waited and was refused (PDA_STATE); one terminal outcome (withdrawn/sent)"
[ $OK = 1 ]
