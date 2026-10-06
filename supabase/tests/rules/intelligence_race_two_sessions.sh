#!/usr/bin/env bash
# Two-session Intelligence publication proof. This test COMMITs its races and
# therefore refuses every database except a disposable asb_rules* database.
set -uo pipefail

DB="${INTELLIGENCE_TEST_DB:-asb_rules}"
CONTAINER="${INTELLIGENCE_DB_CONTAINER:-supabase_db_arab-ship-broker}"
if [[ ! "$DB" =~ ^asb_rules([_-][a-zA-Z0-9_-]+)?$ ]]; then
  echo "Refusing Intelligence race outside a disposable asb_rules* database: $DB" >&2
  exit 2
fi

PSQL=(docker exec -i "$CONTAINER" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" -At)
q() { "${PSQL[@]}" -c "$1"; }

ACTOR="$(q 'select gen_random_uuid()')"
CREATE_REQUEST="$(q 'select gen_random_uuid()')"
CREATE_B_REQUEST="$(q 'select gen_random_uuid()')"
ACTIVATE_A_REQUEST="$(q 'select gen_random_uuid()')"
ACTIVATE_B_REQUEST="$(q 'select gen_random_uuid()')"
ORIGINAL_ACTIVE="$(q "select active_rule_set_id from public.intelligence_rule_state where singleton")"
ORIGINAL_REVISION="$(q "select revision from public.intelligence_rule_state where singleton")"
ORIGINAL_ACTOR_SQL="$(q "select coalesce(quote_literal(activated_by::text) || '::uuid','null') from public.intelligence_rule_state where singleton")"
ORIGINAL_AT_SQL="$(q "select coalesce(quote_literal(activated_at::text) || '::timestamptz','null') from public.intelligence_rule_state where singleton")"
LABEL_A="Intelligence create race $ACTOR"
LABEL_B="Intelligence activation race $ACTOR"
LOG_A="/tmp/intelligence-race-${ACTOR}-a.log"
LOG_B="/tmp/intelligence-race-${ACTOR}-b.log"
LOG_C="/tmp/intelligence-race-${ACTOR}-c.log"
LOG_D="/tmp/intelligence-race-${ACTOR}-d.log"

cleanup() {
  "${PSQL[@]}" <<SQL >/dev/null 2>&1 || true
set session_replication_role = replica;
update public.intelligence_rule_state
   set active_rule_set_id = '$ORIGINAL_ACTIVE'::uuid,
       revision = $ORIGINAL_REVISION,
       activated_by = $ORIGINAL_ACTOR_SQL,
       activated_at = $ORIGINAL_AT_SQL
 where singleton;
delete from public.intelligence_rule_events where actor_user_id = '$ACTOR'::uuid;
delete from public.intelligence_rule_requests where actor_user_id = '$ACTOR'::uuid;
delete from public.intelligence_rule_provenance
 where rule_set_id in (select id from public.intelligence_rule_sets where created_by = '$ACTOR'::uuid);
delete from public.intelligence_rules
 where rule_set_id in (select id from public.intelligence_rule_sets where created_by = '$ACTOR'::uuid);
delete from public.intelligence_rule_groups
 where rule_set_id in (select id from public.intelligence_rule_sets where created_by = '$ACTOR'::uuid);
delete from public.intelligence_rule_sets where created_by = '$ACTOR'::uuid;
delete from public.users where id = '$ACTOR'::uuid;
delete from auth.users where id = '$ACTOR'::uuid;
SQL
  rm -f "$LOG_A" "$LOG_B" "$LOG_C" "$LOG_D"
}
trap cleanup EXIT

q "insert into auth.users(id,email)
   values ('$ACTOR'::uuid,'intelligence-race-$ACTOR@example.test');
   insert into public.users(id,email,full_name,role,is_active,admin_tier,subscription_tier)
   values ('$ACTOR'::uuid,'intelligence-race-$ACTOR@example.test','Intelligence Race Actor','admin',true,'super','T4')" >/dev/null

create_call() {
  local label="$1" request_id="$2"
  cat <<SQL
select public.admin_intelligence_create_rule_set(
  '$ACTOR'::uuid,
  (public.admin_intelligence_get_clone_input('$ACTOR'::uuid,'$ORIGINAL_ACTIVE'::uuid))->'document',
  (public.admin_intelligence_get_clone_input('$ACTOR'::uuid,'$ORIGINAL_ACTIVE'::uuid))->'provenance',
  '$label',
  'Two-session governed concurrency proof',
  '$ORIGINAL_ACTIVE'::uuid,
  '$request_id'::uuid
);
SQL
}

# Race 1: the same actor/request/arguments in two sessions produces one version
# and the second session replays the committed result.
{
  echo 'set role service_role; begin;'
  create_call "$LABEL_A" "$CREATE_REQUEST"
  echo 'select pg_sleep(4); commit;'
} | "${PSQL[@]}" >"$LOG_A" 2>&1 &
PID_A=$!
sleep 1
{
  echo 'set role service_role;'
  create_call "$LABEL_A" "$CREATE_REQUEST"
} | "${PSQL[@]}" >"$LOG_B" 2>&1 &
PID_B=$!
wait "$PID_A"; STATUS_A=$?
wait "$PID_B"; STATUS_B=$?

fail=0
ok() {
  if [[ "$1" == "$2" ]]; then
    echo "  ok   $3 ($1)"
  else
    echo " FAIL  $3 -- expected [$2], got [$1]"
    fail=1
  fi
}

ok "$STATUS_A" "0" "first create session committed"
ok "$STATUS_B" "0" "second create session replayed"
RESULT_A="$(grep -E '^\{' "$LOG_A" | head -1 || true)"
RESULT_B="$(grep -E '^\{' "$LOG_B" | head -1 || true)"
ok "$RESULT_B" "$RESULT_A" "both create sessions returned the same result"
ok "$(q "select count(*) from public.intelligence_rule_sets where created_by='$ACTOR'::uuid and label='$LABEL_A'")" "1" "one version was created"
ok "$(q "select count(*) from public.intelligence_rule_requests where actor_user_id='$ACTOR'::uuid and request_id='$CREATE_REQUEST'::uuid and result is not null")" "1" "one completed request was retained"
ok "$(q "select count(*) from public.intelligence_rule_events where actor_user_id='$ACTOR'::uuid and request_id='$CREATE_REQUEST'::uuid and action='version.created'")" "1" "one creation event was retained"

TARGET_A="$(q "select id from public.intelligence_rule_sets where created_by='$ACTOR'::uuid and label='$LABEL_A'")"
{
  echo 'set role service_role;'
  create_call "$LABEL_B" "$CREATE_B_REQUEST"
} | "${PSQL[@]}" >/dev/null
TARGET_B="$(q "select id from public.intelligence_rule_sets where created_by='$ACTOR'::uuid and label='$LABEL_B'")"
TARGET_A_VERSION="$(q "select version_no from public.intelligence_rule_sets where id='$TARGET_A'::uuid")"
TARGET_B_VERSION="$(q "select version_no from public.intelligence_rule_sets where id='$TARGET_B'::uuid")"

# Race 2: two different targets start from one expected revision. The global
# advisory lock serializes them; after the winner commits, the loser observes
# the changed revision and fails without a request/event residue.
"${PSQL[@]}" >"$LOG_C" 2>&1 <<SQL &
set role service_role;
begin;
select public.admin_intelligence_activate_rule_set(
  '$ACTOR'::uuid, '$TARGET_A'::uuid, $ORIGINAL_REVISION, '$ACTIVATE_A_REQUEST'::uuid,
  'ACTIVATE v$TARGET_A_VERSION'
);
select pg_sleep(4);
commit;
SQL
PID_C=$!
sleep 1
"${PSQL[@]}" >"$LOG_D" 2>&1 <<SQL &
set role service_role;
select public.admin_intelligence_activate_rule_set(
  '$ACTOR'::uuid, '$TARGET_B'::uuid, $ORIGINAL_REVISION, '$ACTIVATE_B_REQUEST'::uuid,
  'ACTIVATE v$TARGET_B_VERSION'
);
SQL
PID_D=$!
wait "$PID_C"; STATUS_C=$?
wait "$PID_D"; STATUS_D=$?

ok "$STATUS_C" "0" "first activation session committed"
if [[ "$STATUS_D" == "0" ]]; then
  echo " FAIL  competing activation unexpectedly committed"
  fail=1
else
  echo "  ok   competing activation was refused"
fi
ok "$(grep -c 'INTELLIGENCE_CONFLICT:' "$LOG_D" || true)" "1" "loser received the governed CAS conflict"
ok "$(q "select active_rule_set_id from public.intelligence_rule_state where singleton")" "$TARGET_A" "winner is the sole active version"
ok "$(q "select revision from public.intelligence_rule_state where singleton")" "$((ORIGINAL_REVISION + 1))" "revision advanced exactly once"
ok "$(q "select count(*) from public.intelligence_rule_events where actor_user_id='$ACTOR'::uuid and request_id='$ACTIVATE_A_REQUEST'::uuid and action in ('version.activated','version.rolled_back')")" "1" "winner wrote one activation event"
ok "$(q "select count(*) from public.intelligence_rule_events where actor_user_id='$ACTOR'::uuid and request_id='$ACTIVATE_B_REQUEST'::uuid")" "0" "loser wrote no event"
ok "$(q "select count(*) from public.intelligence_rule_requests where actor_user_id='$ACTOR'::uuid and request_id='$ACTIVATE_B_REQUEST'::uuid")" "0" "loser left no idempotency residue"

if [[ "$fail" == "0" ]]; then
  echo "INTELLIGENCE RACE: ALL ASSERTIONS PASSED"
fi
exit "$fail"
