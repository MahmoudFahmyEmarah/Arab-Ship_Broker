#!/usr/bin/env bash
# Two real PostgreSQL sessions racing the market handle issuer.
# Proves one active actor/purpose/listing tuple, expiry rotation, safe detail
# resolution, and inverse cargo/vessel match enumeration without lock cycles.
# This script commits a fixed, namespaced fixture and removes exactly those
# rows on every exit.
set -euo pipefail

cd "$(dirname "$0")/../../.."
PSQL="${HARNESS_PSQL:-docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres}"
TMP="$(mktemp -d -t market-handle-race.XXXXXX)"

ORG=20000000-0000-4000-8000-000000000001
OWNER=20000000-0000-4000-8000-000000000011
ACTOR=20000000-0000-4000-8000-000000000012
VESSEL=20000000-0000-4000-8000-000000000031
AVAIL=20000000-0000-4000-8000-000000000041
CARGO=20000000-0000-4000-8000-000000000051
HIDDEN_NAME='RACE HIDDEN TBN HULL'
HIDDEN_IMO='9654321'

cleanup() {
  $PSQL -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<SQL || true
set session_replication_role = replica;
drop table if exists market_private._test_handle_race_barrier;
delete from market_private.listing_handles where actor_user_id in ('$OWNER','$ACTOR') or listing_id in ('$AVAIL','$CARGO');
delete from public.listing_ownership where listing_id in ('$AVAIL','$CARGO');
delete from public.cargo_listings where id = '$CARGO';
delete from public.vessel_availability where id = '$AVAIL';
delete from public.vessels where id = '$VESSEL';
delete from public.organization_members where user_id in ('$OWNER','$ACTOR');
delete from public.users where id in ('$OWNER','$ACTOR');
delete from auth.users where id in ('$OWNER','$ACTOR');
delete from public.organizations where id = '$ORG';
delete from public.ports where locode = 'ZZMRP';
SQL
  rm -rf "$TMP"
}
trap cleanup EXIT
cleanup
mkdir -p "$TMP"

$PSQL -q -v ON_ERROR_STOP=1 <<SQL
set session_replication_role = replica;
create unlogged table market_private._test_handle_race_barrier (
  actor_user_id uuid not null,
  round_no integer not null,
  participant text not null check (participant in ('cargo', 'vessel', 'release')),
  primary key (actor_user_id, round_no, participant)
);
insert into auth.users (id,email,aud,role,raw_app_meta_data) values
 ('$OWNER','market-race-owner@privacy.test','authenticated','authenticated','{"role":"member"}'),
 ('$ACTOR','market-race-actor@privacy.test','authenticated','authenticated','{"role":"member"}');
insert into public.organizations (id,name,org_type,desk_contact_name) values
 ('$ORG','RACE HIDDEN POSTER ORG','owner','RACE HIDDEN DESK');
insert into public.users (id,supabase_user_id,email,full_name,company,role,subscription_tier,is_active) values
 ('$OWNER','$OWNER','market-race-owner@privacy.test','RACE HIDDEN POSTER PERSON','RACE HIDDEN POSTER ORG','vessel_owner','T3',true),
 ('$ACTOR','$ACTOR','market-race-actor@privacy.test','Race Outsider','Race Outsider Co','cargo_owner','T3',true);
insert into public.organization_members (org_id,user_id,member_role,is_current,status) values
 ('$ORG','$OWNER','admin',true,'active');
insert into public.ports (locode,trade_name,country,zone,port_type,is_active,is_verified) values
 ('ZZMRP','Market Race Port','Egypt','E.MED','Sea Port',true,true);
insert into public.vessels
 (id,vessel_name,imo_number,vessel_type,dwt_grain,build_year,flag,is_geared,grain_certified,dg_certified,is_sanctioned,is_tbn)
 values ('$VESSEL','$HIDDEN_NAME','$HIDDEN_IMO','Bulk Carrier',31337,2014,'Liberia',true,true,false,false,true);
insert into public.vessel_availability
 (id,vessel_id,open_port_locode,open_port_name,open_zone,open_date,status,review_status,accepts_part_cargo)
 values ('$AVAIL','$VESSEL','ZZMRP','Market Race Port','E.MED',current_date + 5,'OPEN','APPROVED',false);
insert into public.cargo_listings
 (id,ref,status,review_status,cargo_type,commodity_name,is_dg_cargo,is_grain_cargo,
  qty_min_mt,qty_max_mt,load_port_locode,load_port_name,load_zone,
  disch_port_locode,disch_port_name,disch_zone,laycan_from,laycan_to,is_spot,
  load_terms,freight_idea_usd_mt,created_at,refreshed_at)
 values
 ('$CARGO','MARKET-RACE-CARGO','IN','APPROVED','Dry Bulk','RACE MATCH CARGO',false,true,
  30000,32000,'ZZMRP','Market Race Port','E.MED',
  'ZZMRP','Market Race Port','E.MED',current_date + 8,current_date + 12,false,
  'FIOST',25.00,now(),now());
insert into public.listing_ownership
 (listing_type,listing_id,owner_user_id,owner_org_id,role,is_current,transfer_reason)
 values
 ('vessel_availability','$AVAIL','$OWNER','$ORG','primary',true,'initial_post'),
 ('cargo','$CARGO','$OWNER','$ORG','primary',true,'initial_post');
set session_replication_role = origin;
SQL

cat > "$TMP/issue.sql" <<SQL
begin;
select set_config('request.jwt.claim.sub','$ACTOR',true);
select set_config('request.jwt.claims','{"sub":"$ACTOR","role":"authenticated","app_metadata":{"role":"member"}}',true);
set local role authenticated;
set local lock_timeout = '4s';
set local statement_timeout = '12s';
select coalesce(x->>'listing_key',x->>'id')
  from jsonb_array_elements(public.list_market_vessels(null,null)) x
 where coalesce(x->'vessel'->>'dwt_grain',x->>'dwt_grain') = '31337';
commit;
SQL

run_pair() {
  local sql="$1" out1="$2" out2="$3" p1 p2 r1=0 r2=0
  $PSQL -qAt -v ON_ERROR_STOP=1 < "$sql" > "$out1" 2>&1 & p1=$!
  $PSQL -qAt -v ON_ERROR_STOP=1 < "$sql" > "$out2" 2>&1 & p2=$!
  wait "$p1" || r1=$?
  wait "$p2" || r2=$?
  if [ "$r1" != 0 ] || [ "$r2" != 0 ]; then
    echo "FAIL: concurrent sessions exited $r1/$r2" >&2
    tail -10 "$out1" >&2 || true
    tail -10 "$out2" >&2 || true
    exit 1
  fi
}

run_inverse_pair() {
  local sql1="$1" sql2="$2" out1="$3" out2="$4" round="$5"
  local p1 p2 r1=0 r2=0 ready deadline
  $PSQL -qAt -v ON_ERROR_STOP=1 -v race_round="$round" < "$sql1" > "$out1" 2>&1 & p1=$!
  $PSQL -qAt -v ON_ERROR_STOP=1 -v race_round="$round" < "$sql2" > "$out2" 2>&1 & p2=$!

  # Both database sessions commit an arrival marker and wait inside PostgreSQL.
  # Release them only after both are at the same pre-RPC gate; this creates
  # deterministic overlap without adding sleeps/hooks to production functions.
  deadline=$((SECONDS + 10))
  while true; do
    if ! ready=$($PSQL -qAt -v ON_ERROR_STOP=1 -c "select count(*) from market_private._test_handle_race_barrier where actor_user_id='$ACTOR' and round_no=$round and participant in ('cargo','vessel')"); then
      kill "$p1" "$p2" >/dev/null 2>&1 || true
      wait "$p1" >/dev/null 2>&1 || true
      wait "$p2" >/dev/null 2>&1 || true
      echo "FAIL: could not inspect inverse-race barrier in round $round" >&2
      exit 1
    fi
    [ "$ready" = 2 ] && break
    if [ "$SECONDS" -ge "$deadline" ]; then
      kill "$p1" "$p2" >/dev/null 2>&1 || true
      wait "$p1" >/dev/null 2>&1 || true
      wait "$p2" >/dev/null 2>&1 || true
      echo "FAIL: inverse-race sessions did not reach the barrier in round $round" >&2
      exit 1
    fi
    sleep 0.05
  done
  if ! $PSQL -q -v ON_ERROR_STOP=1 -c "insert into market_private._test_handle_race_barrier (actor_user_id,round_no,participant) values ('$ACTOR',$round,'release')" >/dev/null; then
    kill "$p1" "$p2" >/dev/null 2>&1 || true
    wait "$p1" >/dev/null 2>&1 || true
    wait "$p2" >/dev/null 2>&1 || true
    echo "FAIL: could not release inverse-race barrier in round $round" >&2
    exit 1
  fi

  wait "$p1" || r1=$?
  wait "$p2" || r2=$?
  if [ "$r1" != 0 ] || [ "$r2" != 0 ]; then
    echo "FAIL: inverse match sessions exited $r1/$r2" >&2
    tail -10 "$out1" >&2 || true
    tail -10 "$out2" >&2 || true
    exit 1
  fi
  if grep -Eqi 'deadlock detected|lock timeout|canceling statement due to lock timeout' "$out1" "$out2"; then
    echo "FAIL: inverse match sessions reported a deadlock/lock timeout" >&2
    tail -10 "$out1" >&2 || true
    tail -10 "$out2" >&2 || true
    exit 1
  fi
}

last_uuid() {
  grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' "$1" | tail -1
}

run_pair "$TMP/issue.sql" "$TMP/issue-1.out" "$TMP/issue-2.out"
K1="$(last_uuid "$TMP/issue-1.out")"
K2="$(last_uuid "$TMP/issue-2.out")"
if [ -z "$K1" ] || [ "$K1" != "$K2" ]; then
  echo "FAIL: concurrent initial issuance returned different/missing keys: [$K1] [$K2]" >&2
  exit 1
fi
N=$($PSQL -qAt -v ON_ERROR_STOP=1 -c "select count(*) from market_private.listing_handles where actor_user_id='$ACTOR' and purpose='vessel_board' and listing_id='$AVAIL' and expires_at>now()")
[ "$N" = 1 ] || { echo "FAIL: initial race left $N active tuples" >&2; exit 1; }
echo "  ok   concurrent initial issuance converged on one active key"

$PSQL -q -v ON_ERROR_STOP=1 -c "update market_private.listing_handles set expires_at=now()-interval '1 second' where key='$K1'" >/dev/null
run_pair "$TMP/issue.sql" "$TMP/rotate-1.out" "$TMP/rotate-2.out"
K3="$(last_uuid "$TMP/rotate-1.out")"
K4="$(last_uuid "$TMP/rotate-2.out")"
if [ -z "$K3" ] || [ "$K3" = "$K1" ] || [ "$K3" != "$K4" ]; then
  echo "FAIL: concurrent expiry rotation did not converge on one new key: old=$K1 new=[$K3]/[$K4]" >&2
  exit 1
fi
N=$($PSQL -qAt -v ON_ERROR_STOP=1 -c "select count(*) from market_private.listing_handles where actor_user_id='$ACTOR' and purpose='vessel_board' and listing_id='$AVAIL' and expires_at>now()")
[ "$N" = 1 ] || { echo "FAIL: rotation race left $N active tuples" >&2; exit 1; }
echo "  ok   concurrent expiry rotation converged on one fresh key"

cat > "$TMP/detail.sql" <<SQL
begin;
select set_config('request.jwt.claim.sub','$ACTOR',true);
select set_config('request.jwt.claims','{"sub":"$ACTOR","role":"authenticated","app_metadata":{"role":"member"}}',true);
set local role authenticated;
set local lock_timeout = '4s';
set local statement_timeout = '12s';
select public.get_market_listing_detail('$K3') - 'expires_at';
commit;
SQL
run_pair "$TMP/detail.sql" "$TMP/detail-1.out" "$TMP/detail-2.out"
for f in "$TMP/detail-1.out" "$TMP/detail-2.out"; do
  detail_content="$(<"$f")"
  detail_content_lc="${detail_content,,}"
  for secret in "$AVAIL" "$VESSEL" "$HIDDEN_NAME" "$HIDDEN_IMO" 'RACE HIDDEN POSTER PERSON' 'RACE HIDDEN POSTER ORG'; do
    secret_lc="${secret,,}"
    if [[ "$detail_content_lc" == *"$secret_lc"* ]]; then
      echo "FAIL: concurrent detail leaked [$secret]" >&2
      exit 1
    fi
  done
  [[ "$detail_content" == *TBN* ]] || { echo "FAIL: concurrent detail omitted masked TBN label" >&2; exit 1; }
done
if ! cmp -s "$TMP/detail-1.out" "$TMP/detail-2.out"; then
  echo "FAIL: concurrent detail responses differed after removing per-transaction expiry" >&2
  diff -u "$TMP/detail-1.out" "$TMP/detail-2.out" >&2 || true
  exit 1
fi
echo "  ok   concurrent resolution returned identical stable privacy-safe TBN detail"

cat > "$TMP/issue-cargo.sql" <<SQL
begin;
select set_config('request.jwt.claim.sub','$ACTOR',true);
select set_config('request.jwt.claims','{"sub":"$ACTOR","role":"authenticated","app_metadata":{"role":"member"}}',true);
set local role authenticated;
select coalesce(x->>'listing_key',x->>'id')
  from jsonb_array_elements(public.list_market_cargo(null,null)) x
 where x->>'commodity_name' = 'RACE MATCH CARGO';
commit;
SQL

$PSQL -qAt -v ON_ERROR_STOP=1 < "$TMP/issue-cargo.sql" > "$TMP/issue-cargo.out" 2>&1
CK="$(last_uuid "$TMP/issue-cargo.out")"
[ -n "$CK" ] || { echo "FAIL: cargo source board key was not issued" >&2; exit 1; }

cat > "$TMP/match-from-cargo.sql" <<SQL
insert into market_private._test_handle_race_barrier (actor_user_id,round_no,participant)
values ('$ACTOR', :race_round, 'cargo');
select set_config('market_privacy.race_round', :'race_round', false);
do \$barrier\$
declare
  v_deadline timestamptz := clock_timestamp() + interval '8 seconds';
begin
  loop
    exit when exists (
      select 1
        from market_private._test_handle_race_barrier b
       where b.actor_user_id = '$ACTOR'
         and b.round_no = current_setting('market_privacy.race_round')::integer
         and b.participant = 'release'
    );
    if clock_timestamp() >= v_deadline then
      raise exception 'inverse cargo race barrier timed out';
    end if;
    perform pg_sleep(0.02);
  end loop;
end
\$barrier\$;
begin;
select set_config('request.jwt.claim.sub','$ACTOR',true);
select set_config('request.jwt.claims','{"sub":"$ACTOR","role":"authenticated","app_metadata":{"role":"member"}}',true);
set local role authenticated;
set local lock_timeout = '4s';
set local statement_timeout = '12s';
select (x->>'listing_key') || '|' || (x->>'board_listing_key')
  from jsonb_array_elements(public.list_market_matches('$CK')) x
 where x->>'open_port_name' = 'Market Race Port';
commit;
SQL

cat > "$TMP/match-from-vessel.sql" <<SQL
insert into market_private._test_handle_race_barrier (actor_user_id,round_no,participant)
values ('$ACTOR', :race_round, 'vessel');
select set_config('market_privacy.race_round', :'race_round', false);
do \$barrier\$
declare
  v_deadline timestamptz := clock_timestamp() + interval '8 seconds';
begin
  loop
    exit when exists (
      select 1
        from market_private._test_handle_race_barrier b
       where b.actor_user_id = '$ACTOR'
         and b.round_no = current_setting('market_privacy.race_round')::integer
         and b.participant = 'release'
    );
    if clock_timestamp() >= v_deadline then
      raise exception 'inverse vessel race barrier timed out';
    end if;
    perform pg_sleep(0.02);
  end loop;
end
\$barrier\$;
begin;
select set_config('request.jwt.claim.sub','$ACTOR',true);
select set_config('request.jwt.claims','{"sub":"$ACTOR","role":"authenticated","app_metadata":{"role":"member"}}',true);
set local role authenticated;
set local lock_timeout = '4s';
set local statement_timeout = '12s';
select (x->>'listing_key') || '|' || (x->>'board_listing_key')
  from jsonb_array_elements(public.list_market_matches('$K3')) x
 where x->>'commodity_name' = 'RACE MATCH CARGO';
commit;
SQL

VMK=''
CMK=''
for round in 1 2 3 4 5 6; do
  COUT="$TMP/inverse-cargo-$round.out"
  VOUT="$TMP/inverse-vessel-$round.out"
  run_inverse_pair "$TMP/match-from-cargo.sql" "$TMP/match-from-vessel.sql" "$COUT" "$VOUT" "$round"
  CPAIR="$(grep -E '[0-9a-f-]{36}\|[0-9a-f-]{36}' "$COUT" | tail -1 || true)"
  VPAIR="$(grep -E '[0-9a-f-]{36}\|[0-9a-f-]{36}' "$VOUT" | tail -1 || true)"
  THIS_VMK="${CPAIR%%|*}"
  THIS_VBOARD="${CPAIR##*|}"
  THIS_CMK="${VPAIR%%|*}"
  THIS_CBOARD="${VPAIR##*|}"
  if [ -z "$THIS_VMK" ] || [ -z "$THIS_CMK" ] || [ "$THIS_VBOARD" != "$K3" ] || [ "$THIS_CBOARD" != "$CK" ]; then
    echo "FAIL: inverse match keys did not correlate to stable board keys in round $round" >&2
    echo "cargo-source=[$CPAIR] vessel-source=[$VPAIR]" >&2
    exit 1
  fi
  if [ "$THIS_VMK" = "$THIS_VBOARD" ] || [ "$THIS_CMK" = "$THIS_CBOARD" ]; then
    echo "FAIL: inverse match and board purposes shared a key in round $round" >&2
    exit 1
  fi
  if [ "$round" = 1 ]; then
    VMK="$THIS_VMK"
    CMK="$THIS_CMK"
  elif [ "$THIS_VMK" != "$VMK" ] || [ "$THIS_CMK" != "$CMK" ]; then
    echo "FAIL: active inverse match keys changed in round $round" >&2
    exit 1
  fi
done

N=$($PSQL -qAt -v ON_ERROR_STOP=1 -c "select count(*) from market_private.listing_handles where actor_user_id='$ACTOR' and expires_at>now() and (purpose,listing_type,listing_id) in (('cargo_board','cargo','$CARGO'),('cargo_match','cargo','$CARGO'),('vessel_board','vessel_availability','$AVAIL'),('vessel_match','vessel_availability','$AVAIL'))")
[ "$N" = 4 ] || { echo "FAIL: inverse match race left $N/4 active purpose tuples" >&2; exit 1; }
echo "  ok   inverse cargo/vessel match races had zero lock failures and stable correlated keys"

echo "MARKET HANDLE TWO SESSIONS: 4/4 passed"
