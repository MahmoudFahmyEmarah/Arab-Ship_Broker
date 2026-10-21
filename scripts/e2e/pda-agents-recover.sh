#!/usr/bin/env bash
# Recovery of ONE PDA agents staging run whose EXIT trap could not complete (21 Oct 2026, pdaag-071e362f5fba: Playwright
# cleaned the runner's log directory, so the trap's redirects failed and its teardown/DOWNs never executed).
#
#   scripts/e2e/pda-agents-recover.sh <run id> --i-hold-the-staging-window
#
# Exactly the trap's own steps, through the checked-in artefacts, logging OUTSIDE test-results/:
#   1. the teardown for the run id (zero residue proved inside it)
#   2. the DOWNs of the chain newest-first, each with its history-export marker, only where the migration is present
#   3. beta_mode restored to true
#   4. the four read-only measurements, compared with the receipt's pinned SCHEMA/DATA, the pinned manifest and the invariants
# Fails closed: any step that fails leaves the rest to a human; a probe that errors is a failure, never "not present".
# Output is captured in memory and kept best effort (run-log-helpers.sh): no database step runs through a file redirect.
# Secrets are never printed.
set -uo pipefail
RUN="${1:?run id}"; [[ "$RUN" =~ ^pdaag-[0-9a-f]{12}$ ]] || { echo "REFUSED: malformed run id"; exit 2; }
[ "${2:-}" = "--i-hold-the-staging-window" ] || { echo "REFUSED: run only inside an announced STAGING EXCLUSIVE window"; exit 2; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT" || exit 2
. scripts/e2e/staging-target.sh
. scripts/e2e/run-log-helpers.sh || { echo "REFUSED: scripts/e2e/run-log-helpers.sh is missing"; exit 2; }
RECEIPT="${ASB_STAGING_RECEIPT:-$HOME/.asb-staging-receipt}"
R_SCHEMA=$(tr -d '\r' < "$RECEIPT" | sed -n 's/^SCHEMA=//p'); R_DATA=$(tr -d '\r' < "$RECEIPT" | sed -n 's/^DATA=//p')
[[ "$R_SCHEMA" =~ ^[0-9a-f]{32}$ && "$R_DATA" =~ ^[0-9a-f]{32}$ ]] || { echo "REFUSED: no receipt fingerprints to compare with"; exit 2; }
LOG="tmp/pda-agents-recover/$RUN-$(date +%H%M%S)"; mkdir -p "$LOG" || { echo "REFUSED: cannot create $LOG"; exit 2; }
FAILED=0; fail(){ echo "  FAIL $*"; FAILED=1; }
echo "== recovery of $RUN ($(date +%H:%M:%S)) → $LOG"

# 1 · teardown (stdout and stderr captured in memory, stderr lines marked; judged on the last stdout line)
td=$( { psqlq -v run="$RUN" -f - < supabase/tests/e2e/pda-agents-teardown.sql 2>&1 1>&3 3>&- | sed 's/^/STDERR /'; } 3>&1 )
tdok=$(printf '%s\n' "$td" | grep -v '^STDERR ' | tail -1); keep "$LOG/teardown.log" "$td"
if [ "$tdok" = "TEARDOWN OK $RUN" ]; then
  echo "  ok   teardown: every row of $RUN removed, guards re-enabled, zero residue proved"
else fail "teardown: last line '${tdok:-<none>}'; $(printf '%s\n' "$td" | sed -n 's/^STDERR //p' | tr '\n' ' ' | redact | cut -c1-300)"; exit 1; fi

# 2 · DOWNs newest first, only where the object is present
for m in 20261019120000_pda_desk_quotes 20261019110000_pda_quote_acceptance 20261019100000_pda_quote_requests 20261018140000_pda_estimate_set_org_lineage \
         20261018130000_pda_agencies 20261018120000_pda_estimate_sets 20261018110000_pda_member_preferences 20261018100000_pda_ports_workspace; do
  case "$m" in
    20261019120000_*) marker="set local asb.pda_desk_quotes_down = 'history-exported:$RUN';"; probe="select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pda_agency_quotes' and column_name = 'entered_via')";;
    20261019110000_*) marker="set local asb.pda_acceptances_down = 'history-exported:$RUN';"; probe="select to_regclass('public.pda_quote_acceptances') is not null";;
    20261019100000_*) marker="set local asb.pda_quotes_down = 'history-exported:$RUN';"; probe="select to_regclass('public.pda_quote_requests') is not null";;
    20261018140000_*) marker=""; probe="select coalesce(pg_get_functiondef(to_regprocedure('public.pda_save_estimate_set(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,uuid)')) like '%v_org uuid := p_owner_org_id%', false)";;
    20261018130000_*) marker="set local asb.pda_agencies_down = 'registry-exported:$RUN';"; probe="select to_regclass('public.pda_agencies') is not null";;
    20261018120000_*) marker="set local asb.pda_sets_down = 'history-exported:$RUN';"; probe="select to_regclass('public.pda_estimate_sets') is not null";;
    20261018110000_*) marker="set local asb.pda_prefs_down = 'discard-preferences';"; probe="select to_regclass('public.pda_member_preferences') is not null";;
    20261018100000_*) marker=""; probe="select to_regprocedure('public.list_pda_ports_workspace(date)') is not null";;
  esac
  present=$(psqlro -c "$probe" 2>&1) || { fail "probe for $m failed: $(printf '%s' "$present" | tr '\n' ' ' | redact | cut -c1-200)"; exit 1; }
  case "$present" in
    t) ;;
    f) echo "  ..   $m not present; nothing to roll back"; continue;;
    *) fail "probe for $m answered neither t nor f"; exit 1;;
  esac
  if dn=$({ echo "$marker"; cat "supabase/rollback/${m}_down.sql"; } 2>&1 | psqlq -1 -f - 2>&1); then keep "$LOG/down-$m.log" "$dn"; echo "  ok   DOWN $m"
  else keep "$LOG/down-$m.log" "$dn"; fail "DOWN $m: $(printf '%s\n' "$dn" | grep -m1 -i error || printf '%s\n' "$dn" | head -1 | redact)"; exit 1; fi
done

# 3 · beta
psqlq -c "update public.app_settings set value = 'true'::jsonb where key = 'beta_mode'" > /dev/null 2>&1 && echo "  ok   beta_mode = true" || fail "beta_mode not restored"

# 4 · measurements against the receipt
if measure "$LOG/after"; then
  diff -q <(tr -d '\r' < supabase/tests/e2e/staging-released-manifest.txt) "$LOG/after/manifest.txt" > /dev/null && echo "  ok   migration history = pinned manifest" || fail "migration history differs from the pinned manifest"
  [ "$(tail -1 "$LOG/after/invariants.txt")" = "PREFLIGHT INVARIANTS OK" ] && echo "  ok   invariants hold" || { fail "invariants:"; sed 's/^/        /' "$LOG/after/invariants.txt"; }
  [ "$SCHEMA_MD5" = "$R_SCHEMA" ] && echo "  ok   schema fingerprint = receipt ($SCHEMA_MD5)" || fail "schema fingerprint $SCHEMA_MD5 differs from the receipt $R_SCHEMA"
  [ "$DATA_MD5" = "$R_DATA" ] && echo "  ok   data fingerprint = receipt ($DATA_MD5)" || fail "data fingerprint $DATA_MD5 differs from the receipt $R_DATA"
else fail "a measurement failed: $(cat "$LOG"/after/*.err 2>/dev/null | redact | tr '\n' ' ' | cut -c1-300)"; fi
[ $FAILED = 0 ] && { echo "== RECOVERY OK ($(date +%H:%M:%S))"; exit 0; } || { echo "== RECOVERY INCOMPLETE ($(date +%H:%M:%S)); do not touch staging further without review"; exit 1; }
