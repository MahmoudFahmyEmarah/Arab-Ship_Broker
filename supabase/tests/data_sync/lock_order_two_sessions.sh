#!/usr/bin/env bash
# Data Sync hardening — deadlock avoidance with two REAL database sessions
# (workstream H, 21 Sep 2026).
#
# DISPOSABLE DATABASE ONLY: the sessions commit. Never point this at
# production. The script cleans up after itself.
#
#   supabase/tests/data_sync/lock_order_two_sessions.sh [psql-command]
#
#   1. the hazard is real        two sessions taking the same two locks in
#                                opposite order deadlock, and PostgreSQL
#                                aborts one. This is the failure the fix
#                                exists to prevent, proved rather than
#                                assumed.
#   2. the helper removes it     both sessions ask fn_sync_lock_all for the
#                                same pair set in opposite argument order;
#                                it sorts, so one simply waits.
#   3. commit versus commit      two batches whose staged rows touch the same
#                                two ports in opposite row order, committed at
#                                the same moment.
#   4. commit versus bulk edit   a commit and a bulk_update_live_records over
#                                the same keys, in opposite order.
#   5. commit versus undo        a commit of one batch against an undo of
#                                another that touched the same key.
set -uo pipefail
PSQL="${1:-docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres}"
q() { $PSQL -At -v ON_ERROR_STOP=1 -c "$1"; }
fail=0
ok()   { if [ "$1" = "$2" ]; then echo "  ok   $3 ($1)"; else echo " FAIL  $3 — expected [$2] got [$1]"; fail=1; fi; }
okne() { if [ "$1" != "$2" ]; then echo "  ok   $3 ($1)"; else echo " FAIL  $3 — did not expect [$2]"; fail=1; fi; }
T="${TMPDIR:-/tmp}"
KA=ZZLKA; KB=ZZLKB

cleanup() {
  $PSQL -q -v ON_ERROR_STOP=0 > /dev/null 2>&1 <<SQL || true
delete from public.sync_commit_audit where business_key in ('$KA','$KB');
delete from public.record_edit_audit where business_key in ('$KA','$KB');
delete from public.sync_staged_row where batch_id in (select id from public.sync_batch where label like 'LOCKORDER%');
delete from public.sync_upload_job where file_name like 'lockorder%';
delete from public.sync_batch where label like 'LOCKORDER%';
delete from public.ports where locode in ('$KA','$KB');
SQL
}
cleanup
trap cleanup EXIT

echo "── 1 · the hazard: opposite order, no helper"
# A takes KA then KB; B takes KB then KA. One of them must be aborted.
$PSQL -At -c "begin; select public.fn_sync_row_lock('ports','$KA'); select pg_sleep(1); select public.fn_sync_row_lock('ports','$KB'); commit;" > "$T/h1a.txt" 2>&1 &
$PSQL -At -c "begin; select public.fn_sync_row_lock('ports','$KB'); select pg_sleep(1); select public.fn_sync_row_lock('ports','$KA'); commit;" > "$T/h1b.txt" 2>&1 &
wait
ok "$(cat "$T/h1a.txt" "$T/h1b.txt" | grep -ci 'deadlock detected' || true)" "1" "locking in opposite order really does deadlock"

echo "── 2 · the fix: the same pair set through fn_sync_lock_all"
# Both sessions pass the pair set in OPPOSITE argument order. The helper sorts
# it, so both request (ports,KA) before (ports,KB) and one waits its turn.
$PSQL -At -c "begin; select public.fn_sync_lock_all(array['ports','ports'], array['$KA','$KB']); select pg_sleep(1); commit; select 'A done';" > "$T/h2a.txt" 2>&1 &
sleep 0.2
$PSQL -At -c "begin; select public.fn_sync_lock_all(array['ports','ports'], array['$KB','$KA']); select pg_sleep(1); commit; select 'B done';" > "$T/h2b.txt" 2>&1 &
wait
ok "$(cat "$T/h2a.txt" "$T/h2b.txt" | grep -ci 'deadlock detected' || true)" "0" "no deadlock when both go through the helper"
ok "$(cat "$T/h2a.txt" "$T/h2b.txt" | grep -c 'done' || true)" "2" "both sessions completed"

# ── the shared fixture for 3–5: two ports and two batches ──────────────────
q "insert into public.ports (locode, trade_name, country, zone) values ('$KA','Lock order A','Testland','E.MED'), ('$KB','Lock order B','Testland','E.MED') on conflict (locode) do nothing" > /dev/null
mkbatch() { # $1 label  $2 first key  $3 second key → batch id
  $PSQL -At -v ON_ERROR_STOP=1 <<SQL
with b as (
  insert into public.sync_batch (source, status, label) values ('upload','gated','$1') returning id
), r as (
  insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification,
                                      payload, raw, diff, flags, row_index, gate_status, gate_rules_version, gate_payload_hash, gated_at)
  select b.id, 'ports', 'ports', 'locode', k.key, 'updated',
         jsonb_build_object('locode', k.key, 'trade_name', 'Lock order ' || k.key, 'country', 'Testland', 'zone', 'E.MED'),
         '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, k.ord, 'ok', public.fn_dq_rules_version(), md5((jsonb_build_object('locode', k.key, 'trade_name', 'Lock order ' || k.key, 'country', 'Testland', 'zone', 'E.MED'))::text), now()
    from b, (values ('$2', 1), ('$3', 2)) as k(key, ord)
  returning 1
) select id from b;
SQL
}
require_batch() { # a fixture that silently produced nothing makes steps 3-5 vacuous
  if [ -z "${1:-}" ]; then echo " FAIL  fixture: the batch could not be staged (see the error above)"; fail=1; exit 1; fi
}
B1="$(mkbatch LOCKORDER-1 "$KA" "$KB")"
B2="$(mkbatch LOCKORDER-2 "$KB" "$KA")"
require_batch "$B1"; require_batch "$B2"
ok "$(q "select count(*) from public.sync_staged_row where batch_id in ('$B1','$B2')")" "4" "two batches staged, each two rows in opposite order"

echo "── 3 · commit versus commit, overlapping keys in opposite row order"
$PSQL -At -c "begin; select public.commit_sync_batch('$B1'::uuid)->>'status'; select pg_sleep(1); commit;" > "$T/h3a.txt" 2>&1 &
sleep 0.2
$PSQL -At -c "begin; select public.commit_sync_batch('$B2'::uuid)->>'status'; select pg_sleep(1); commit;" > "$T/h3b.txt" 2>&1 &
wait
ok "$(cat "$T/h3a.txt" "$T/h3b.txt" | grep -ci 'deadlock detected' || true)" "0" "two commits over the same keys did not deadlock"
ok "$(q "select count(*) from public.sync_staged_row where batch_id in ('$B1','$B2') and committed")" "4" "every staged row committed"
ok "$(q "select count(*) from public.ports where locode in ('$KA','$KB')")" "2" "one live row per key, not duplicated"

echo "── 4 · commit versus bulk edit, opposite key order"
B3="$(mkbatch LOCKORDER-3 "$KA" "$KB")"; require_batch "$B3"
$PSQL -At -c "begin; select public.commit_sync_batch('$B3'::uuid)->>'status'; select pg_sleep(1); commit;" > "$T/h4a.txt" 2>&1 &
sleep 0.2
$PSQL -At -c "begin; select public.bulk_update_live_records('ports', array['$KB','$KA'], '{\"country\":\"Bulkland\"}'::jsonb, null)->>'updated'; select pg_sleep(1); commit;" > "$T/h4b.txt" 2>&1 &
wait
ok "$(cat "$T/h4a.txt" "$T/h4b.txt" | grep -ci 'deadlock detected' || true)" "0" "a commit and a bulk edit over the same keys did not deadlock"
okne "$(cat "$T/h4b.txt" | grep -cE '^[0-9]+$' || true)" "0" "the bulk edit reported a result"

echo "── 5 · commit versus undo, overlapping key"
B4="$(mkbatch LOCKORDER-4 "$KA" "$KB")"; require_batch "$B4"
$PSQL -At -c "begin; select public.undo_sync_batch('$B3'::uuid, true, 'lockorder')->>'reverted'; select pg_sleep(1); commit;" > "$T/h5a.txt" 2>&1 &
sleep 0.2
$PSQL -At -c "begin; select public.commit_sync_batch('$B4'::uuid)->>'status'; select pg_sleep(1); commit;" > "$T/h5b.txt" 2>&1 &
wait
ok "$(cat "$T/h5a.txt" "$T/h5b.txt" | grep -ci 'deadlock detected' || true)" "0" "a commit and an undo over the same keys did not deadlock"

if [ $fail = 0 ]; then echo "LOCK ORDER (two sessions): ALL ASSERTIONS PASSED"; else echo "LOCK ORDER (two sessions): FAILED"; exit 1; fi
