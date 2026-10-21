#!/usr/bin/env bash
# Behaviour of scripts/e2e/run-log-helpers.sh and of the capture idiom the staging runner's trap uses. No database,
# no network: fake psql functions. Run:  bash scripts/e2e/run-log-helpers-test.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2
. scripts/e2e/run-log-helpers.sh
RUN=pdaag-000000000000; n=0
pass(){ n=$((n+1)); echo "  ok   $*"; }
fake_psql(){ echo "notice: something" >&2; echo "row1"; echo "TEARDOWN OK $RUN"; return 0; }
fake_psql_err(){ echo "row1"; echo "psql:stdin:12: ERROR:  TEARDOWN_RESIDUE: 9 run-stamped row(s) remain" >&2; return 3; }

# 1 · the capture idiom: stdout kept in order, stderr marked, the OK line judged from stdout alone
td=$( { fake_psql 2>&1 1>&3 3>&- | sed 's/^/STDERR /'; } 3>&1 )
tdok=$(printf '%s\n' "$td" | grep -v '^STDERR ' | tail -1); tderr=$(printf '%s\n' "$td" | sed -n 's/^STDERR //p')
[ "$tdok" = "TEARDOWN OK $RUN" ] && [ "$tderr" = "notice: something" ] && pass "capture: the OK line is the last stdout line; stderr is separated" || { echo "FAIL capture: [$tdok] [$tderr]"; exit 1; }
td=$( { fake_psql_err 2>&1 1>&3 3>&- | sed 's/^/STDERR /'; } 3>&1 )
tdok=$(printf '%s\n' "$td" | grep -v '^STDERR ' | tail -1); tderr=$(printf '%s\n' "$td" | sed -n 's/^STDERR //p')
[ "$tdok" != "TEARDOWN OK $RUN" ] && [[ "$tderr" == *TEARDOWN_RESIDUE* ]] && pass "capture on error: no OK line; the error text is in memory" || { echo "FAIL capture on error"; exit 1; }
dn=$({ echo "marker;"; echo "sql"; } | fake_psql_err 2>&1); st=$?
[ $st = 3 ] && [[ "$dn" == *ERROR* ]] && pass "DOWN-style capture: the status is psql's ($st), the ERROR text is in memory" || { echo "FAIL DOWN capture"; exit 1; }

# 2 · logdir: a removed directory is re-created; an impossible one yields a temporary directory; keep never fails or prints
T=$(mktemp -d "${TMPDIR:-/tmp}/run-log-helpers-test.XXXXXX"); trap 'rm -rf "$T"' EXIT
D="$T/wiped/$RUN"; mkdir -p "$D"; rm -rf "$T/wiped"; L=$(logdir "$D" "x")
[ "$L" = "$D" ] && [ -d "$L" ] && pass "logdir re-created the removed directory" || { echo "FAIL logdir re-create [$L]"; exit 1; }
L2=$(logdir "/proc/nonexistent-cannot-create/x" "pda-agents-run-$RUN" 2>/dev/null)
[ -d "$L2" ] && [[ "$L2" == */pda-agents-run-$RUN.* ]] && pass "logdir fell back to a temporary directory named after the stem" && rmdir "$L2" || { echo "FAIL logdir fallback [$L2]"; exit 1; }
L3=$(TMPDIR=/proc/nonexistent logdir "/proc/nonexistent-cannot-create/x" "x" 2>/dev/null)
[ "$L3" = "." ] && pass "logdir never answers with an empty string (the current directory is the last resort)" || { echo "FAIL logdir last resort [$L3]"; exit 1; }
out=$(keep "/proc/nonexistent/x.log" "text" 2>&1); st=$?
[ $st = 0 ] && [ -z "$out" ] && pass "keep on an unwritable path: status 0, nothing printed" || { echo "FAIL keep [$st] [$out]"; exit 1; }
keep "$T/kept.log" "line"; [ "$(cat "$T/kept.log")" = "line" ] && pass "keep on a writable path writes the text" || { echo "FAIL keep write"; exit 1; }
echo "run-log helpers: $n checks passed"
