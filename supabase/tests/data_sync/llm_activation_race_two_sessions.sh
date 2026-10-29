#!/usr/bin/env bash
# Data Sync LLM keys — activation races with two REAL database sessions (C2O-182 P2), for
# 20261029100000_llm_credential_conditional_activation:
#   R1 · activate vs activate: two different fresh keys activated at the same moment, no key active before →
#        exactly one ends active and both answers are within the contract ('activated' | 'changed' |
#        'not_found'); never a raw 23505 from idx_llm_one_active
#   R2 · save vs activate: a save of key B lands while B's activation waits on the lock → the activation reads
#        the new token and answers 'changed'; B stays inactive
#
#   supabase/tests/data_sync/llm_activation_race_two_sessions.sh [psql-command]
#
# The sessions COMMIT (a race cannot be rolled back): run it ONLY against a DISPOSABLE database. It deactivates
# every key for the test and puts the previously active key back, and deletes its own rows, afterwards.
set -euo pipefail
PSQL="${1:-docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres}"
q() { $PSQL -At -v ON_ERROR_STOP=1 -c "$1"; }
fail=0
WAS_ACTIVE=$(q "select coalesce((select id::text from public.llm_credential where is_active), '')")

cleanup() {
  $PSQL -q -v ON_ERROR_STOP=0 <<SQL >/dev/null 2>&1 || true
delete from vault.secrets where id in (select secret_id from public.llm_credential where label like 'LLM-RACE-%');
delete from public.llm_credential where label like 'LLM-RACE-%';
SQL
  if [ -n "$WAS_ACTIVE" ]; then
    q "update public.llm_credential set is_active = (id = '$WAS_ACTIVE'::uuid) where is_active or id = '$WAS_ACTIVE'::uuid" >/dev/null || true
  fi
}
trap cleanup EXIT
cleanup
q "update public.llm_credential set is_active = false where is_active" >/dev/null

A=$(q "select public.save_llm_credential(null, 'LLM-RACE-A', 'anthropic', 'claude-haiku-5-5', null, 'sk-race-aaaa', false)")
B=$(q "select public.save_llm_credential(null, 'LLM-RACE-B', 'anthropic', 'claude-haiku-5-5', null, 'sk-race-bbbb', false)")
TA=$(q "select updated_at from public.llm_credential where id = '$A'")
TB=$(q "select updated_at from public.llm_credential where id = '$B'")

# ── R1 · session 1 activates A and holds its transaction 3 s; session 2 activates B meanwhile ──
OUT1=$(mktemp); OUT2=$(mktemp)
( $PSQL -At -v ON_ERROR_STOP=1 > "$OUT1" 2>&1 <<SQL
begin;
select public.set_active_llm_credential_if_unchanged('$A', '$TA');
select pg_sleep(3);
commit;
SQL
) &
P1=$!
sleep 1
( $PSQL -At -v ON_ERROR_STOP=1 > "$OUT2" 2>&1 <<SQL
select public.set_active_llm_credential_if_unchanged('$B', '$TB');
SQL
) &
P2=$!
wait $P1 || true; wait $P2 || true
R1A=$(grep -E '^(activated|changed|not_found)$' "$OUT1" | head -1 || true)
R1B=$(grep -E '^(activated|changed|not_found)$' "$OUT2" | head -1 || true)
NACT=$(q "select count(*) from public.llm_credential where is_active and label like 'LLM-RACE-%'")
if [ "$R1A" = activated ] && [ "$R1B" = activated ] && [ "$NACT" = 1 ] && ! grep -qiE 'error|23505' "$OUT1" "$OUT2"; then
  echo "  ok   R1 activate vs activate: both answers within the contract (A=$R1A, B=$R1B, serialised), exactly one active, no 23505"
else
  echo " FAIL  R1 activate vs activate: A='$R1A' B='$R1B' active=$NACT"; sed 's/^/        /' "$OUT1" "$OUT2"; fail=1
fi
WINNER=$(q "select label from public.llm_credential where is_active and label like 'LLM-RACE-%'")
[ "$WINNER" = LLM-RACE-B ] && echo "  ok   R1 the later activation wins once the first commits (B active)" || { echo " FAIL  R1 expected B active, got '$WINNER'"; fail=1; }

# ── R2 · session 1 saves B (an edit) and holds 3 s; session 2 tries to activate B with B's pre-edit token ──
q "update public.llm_credential set is_active = false where is_active" >/dev/null
TB=$(q "select updated_at from public.llm_credential where id = '$B'")
( $PSQL -At -v ON_ERROR_STOP=1 > "$OUT1" 2>&1 <<SQL
begin;
select public.save_llm_credential('$B', 'LLM-RACE-B', 'anthropic', 'claude-sonnet-5-5', null, null, false);
select pg_sleep(3);
commit;
SQL
) &
P1=$!
sleep 1
( $PSQL -At -v ON_ERROR_STOP=1 > "$OUT2" 2>&1 <<SQL
select public.set_active_llm_credential_if_unchanged('$B', '$TB');
SQL
) &
P2=$!
wait $P1 || true; wait $P2 || true
R2=$(grep -E '^(activated|changed|not_found)$' "$OUT2" | head -1 || true)
BACT=$(q "select is_active from public.llm_credential where id = '$B'")
if [ "$R2" = changed ] && [ "$BACT" = f ]; then
  echo "  ok   R2 save vs activate: the activation waited for the save, saw the new token and answered 'changed'; B inactive"
else
  echo " FAIL  R2 save vs activate: answer='$R2' B active=$BACT"; sed 's/^/        /' "$OUT2"; fail=1
fi
rm -f "$OUT1" "$OUT2"

if [ $fail = 0 ]; then echo "LLM ACTIVATION RACES: ALL PASSED"; else echo "LLM ACTIVATION RACES: FAILED"; exit 1; fi
