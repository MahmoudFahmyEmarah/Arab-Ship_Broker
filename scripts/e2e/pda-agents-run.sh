#!/usr/bin/env bash
# PDA agents browser run on the approved hosted STAGING project, fail-closed (Codex C2O-158/159/162 P0).
#
#   scripts/e2e/pda-agents-run.sh --i-hold-the-staging-window --peer-mail-read-at=<unix seconds>
#
# Only in an announced STAGING EXCLUSIVE window, and only with a one-use receipt the PEER AUDITOR mints after GO
# (O2ALL-012: Opus B for Opus's runs, Opus for Opus B's)
# ($ASB_STAGING_RECEIPT, default ~/.asb-staging-receipt; machine-readable, never parsed from mailbox prose):
#   STATUS=GO                 anything else (HOLD, REVOKED, …) refuses
#   SHA=<40 hex>              the audited head; the checkout must be exactly it, with no tracked change
#   SCHEMA=<32 hex>           the schema fingerprint Codex reviewed in the read-only preflight
#   DATA=<32 hex>             the data fingerprint Codex reviewed in the read-only preflight
#   NONCE=<32 hex>            spent before the first write (ledger ~/.asb-staging-receipts-used); a receipt runs once
#   ISSUED_AT=<unix seconds>
# --peer-mail-read-at is when the operator finished reading BOTH live mailboxes IN FULL (opus-to-codex.md and
# opusb-to-all.md; post your own RUN START first, then read). It must be after the receipt, within the last 15 minutes,
# and neither mailbox may have changed since, both before and after the 60 s grace.
#
# Lifecycle:
#   0. gates: staging binding, receipt, clean audited checkout, peer mail; then the read-only measurements (manifest,
#      invariants, exact schema + data fingerprints) must equal the receipt; the nonce is spent; 60 s grace; re-checked
#   1. the PDA migrations, applied unrecorded
#   2. beta_mode off
#   3. next build + Playwright e2e/pda-agents.spec.ts under one run id
# Whatever happens after the nonce is spent, the EXIT trap runs:
#   - the checked-in teardown for that run id (zero residue incl. Auth sessions, refresh tokens, identities, MFA)
#   - the DOWNs of every migration this run applied, newest first
#   - beta_mode restored
#   - the four measurements again, compared LINE BY LINE with the baseline
# Any teardown, rollback or measurement difference makes the run FAILED, never a warning. Declared exceptions (not
# exact restoration): auth.audit_log_entries rows and sequence positions (see supabase/tests/e2e/data-fingerprint.sql).
# Logs live under tmp/pda-agents-run/<run id>/, which nothing in the run cleans (21 Oct 2026, pdaag-071e362f5fba: they
# lived under test-results/, Playwright's output directory, which it empties at start-up; the trap's redirects then
# failed and its teardown and DOWNs never ran). The trap's database steps never depend on a log being writable.
set -uo pipefail
[ "${1:-}" = "--i-hold-the-staging-window" ] || { echo "REFUSED: run only inside an announced STAGING EXCLUSIVE window (--i-hold-the-staging-window)"; exit 2; }
READ_AT="${2:-}"; READ_AT="${READ_AT#--peer-mail-read-at=}"
[[ "${2:-}" == --peer-mail-read-at=* && "$READ_AT" =~ ^[0-9]{10}$ ]] || { echo "REFUSED: --peer-mail-read-at=<unix seconds> (when you finished reading every peer mailbox in full)"; exit 2; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2
. scripts/e2e/staging-target.sh

# ── 0 · receipt, audited checkout, peer mail
RECEIPT="${ASB_STAGING_RECEIPT:-$HOME/.asb-staging-receipt}"
LEDGER="${ASB_STAGING_LEDGER:-$HOME/.asb-staging-receipts-used}"
MAILDIR="${ASB_MAILBOX_DIR:-$(cd "$(git rev-parse --git-common-dir)/.." && pwd)/docs/coordination/live}"
receipt(){ # receipt → R_STATUS R_SHA R_SCHEMA R_DATA R_NONCE R_ISSUED, strictly
  [ -r "$RECEIPT" ] || { echo "REFUSED: no receipt at $RECEIPT (the peer auditor mints it after GO)"; exit 2; }
  local body; body="$(tr -d '\r' < "$RECEIPT")"
  echo "$body" | grep -vqE '^(STATUS=[A-Z]+|SHA=[0-9a-f]{40}|SCHEMA=[0-9a-f]{32}|DATA=[0-9a-f]{32}|NONCE=[0-9a-f]{32}|ISSUED_AT=[0-9]{10}|)$' \
    && { echo "REFUSED: the receipt has a line outside the format"; exit 2; }
  R_STATUS=$(echo "$body" | sed -n 's/^STATUS=//p'); R_SHA=$(echo "$body" | sed -n 's/^SHA=//p'); R_SCHEMA=$(echo "$body" | sed -n 's/^SCHEMA=//p')
  R_DATA=$(echo "$body" | sed -n 's/^DATA=//p'); R_NONCE=$(echo "$body" | sed -n 's/^NONCE=//p'); R_ISSUED=$(echo "$body" | sed -n 's/^ISSUED_AT=//p')
  for v in "$R_STATUS" "$R_SHA" "$R_SCHEMA" "$R_DATA" "$R_NONCE" "$R_ISSUED"; do [ -n "$v" ] && [ "$(echo "$v" | wc -l)" = 1 ] || { echo "REFUSED: the receipt lacks a field or repeats one"; exit 2; }; done
  [ "$R_STATUS" = GO ] || { echo "REFUSED: the receipt says $R_STATUS, not GO"; exit 2; }
}
peer_mail(){ # every peer mailbox unchanged since the operator's full read
  local f m
  for f in opus-to-codex.md opusb-to-all.md; do
    [ -r "$MAILDIR/$f" ] || { echo "REFUSED: cannot read $MAILDIR/$f"; exit 2; }
    m=$(stat -c %Y "$MAILDIR/$f")
    [ "$m" -le "$READ_AT" ] || { echo "REFUSED: $f changed after your read ($1); read both live mailboxes in full again and re-run"; exit 2; }
  done
}
receipt
NOW=$(date +%s)
[ "$READ_AT" -ge "$R_ISSUED" ] && [ "$READ_AT" -le "$NOW" ] && [ $(( NOW - READ_AT )) -le 900 ] \
  || { echo "REFUSED: --peer-mail-read-at must be after the receipt and within the last 15 minutes"; exit 2; }
[ "$(git rev-parse HEAD)" = "$R_SHA" ] || { echo "REFUSED: the checkout is not the audited head ${R_SHA:0:12}"; exit 2; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "REFUSED: tracked files differ from the audited head"; exit 2; }
[ -f "$LEDGER" ] && grep -qx "$R_NONCE" "$LEDGER" && { echo "REFUSED: this receipt was already used"; exit 2; }
peer_mail "before the gates"

RUN="pdaag-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
[[ "$RUN" =~ ^pdaag-[0-9a-f]{12}$ ]] || { echo "REFUSED: could not make a run id"; exit 2; }
LOG="tmp/pda-agents-run/$RUN"; mkdir -p "$LOG" || { echo "REFUSED: cannot create $LOG"; exit 2; }
echo "== PDA agents staging run $RUN at ${R_SHA:0:12} ($(date +%H:%M:%S))"

# read-only measurements = what Codex reviewed
measure "$LOG/before" || { echo "REFUSED: a read-only measurement failed: $(cat "$LOG"/before/*.err 2>/dev/null | redact | tr '\n' ' ' | cut -c1-300)"; exit 2; }
diff -q <(tr -d '\r' < supabase/tests/e2e/staging-released-manifest.txt) "$LOG/before/manifest.txt" > /dev/null || { echo "REFUSED: migration history differs from the pinned manifest"; exit 2; }
[ "$(tail -1 "$LOG/before/invariants.txt")" = "PREFLIGHT INVARIANTS OK" ] || { echo "REFUSED: preflight invariants:"; sed 's/^/  /' "$LOG/before/invariants.txt"; exit 2; }
[ "$SCHEMA_MD5" = "$R_SCHEMA" ] || { echo "REFUSED: schema fingerprint $SCHEMA_MD5 is not the reviewed ${R_SCHEMA}"; exit 2; }
[ "$DATA_MD5" = "$R_DATA" ] || { echo "REFUSED: data fingerprint $DATA_MD5 is not the reviewed ${R_DATA}"; exit 2; }
[ -n "$(psqlro -c "select 1 from public.notification_dispatch_config where id = 1 and dispatch_url is null")" ] || { echo "REFUSED: staging has an email dispatch URL"; exit 2; }
BASE_SCHEMA=$SCHEMA_MD5; BASE_DATA=$DATA_MD5; BASE_MANIFEST=$(tr -d '\r' < supabase/tests/e2e/staging-released-manifest.txt)
echo "  ok   gates: receipt GO (one use), audited clean checkout, manifest, invariants, schema $BASE_SCHEMA, data $BASE_DATA = reviewed"

# spend the receipt BEFORE any write, then the grace period, then everything again
echo "$R_NONCE" >> "$LEDGER" || { echo "REFUSED: could not spend the receipt"; exit 2; }
echo "  ..   receipt spent; 60 s grace (a STOP, HOLD or revoked receipt now still stops the run)"
sleep 60
receipt; peer_mail "during the grace period"
[ "$(git rev-parse HEAD)" = "$R_SHA" ] && [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "REFUSED: the checkout changed during the grace period"; exit 2; }
measure "$LOG/grace" && [ "$SCHEMA_MD5" = "$BASE_SCHEMA" ] && [ "$DATA_MD5" = "$BASE_DATA" ] || { echo "REFUSED: staging changed during the grace period"; exit 2; }

FAILED=0; APPLIED=(); BETA="true"; ENVBK=""; STAGED=0; PW=1
fail(){ echo "  FAIL $*"; FAILED=1; }

# The trap's own rule: every database step runs whatever happened to the log directory, and a log is written only
# when it can be (keep is best effort; logdir gives the trap a writable directory or a fresh temporary one).
. scripts/e2e/run-log-helpers.sh || { echo "REFUSED: scripts/e2e/run-log-helpers.sh is missing"; exit 2; }

finish(){
  echo "== teardown, rollback, verification ($(date +%H:%M:%S))"
  LOG=$(logdir "$LOG" "pda-agents-run-$RUN"); echo "  ..   trap logs: $LOG"
  # the operator's own .env.local is touched only if step 3 replaced it with the staging copy
  if [ "$STAGED" = 1 ]; then rm -f .env.local; [ -n "$ENVBK" ] && mv "$ENVBK" .env.local; fi
  # teardown: stdout and stderr captured in memory (stderr lines marked), never through a file redirect
  local td tdok tderr
  td=$( { psqlq -v run="$RUN" -f - < supabase/tests/e2e/pda-agents-teardown.sql 2>&1 1>&3 3>&- | sed 's/^/STDERR /'; } 3>&1 )
  tdok=$(printf '%s\n' "$td" | grep -v '^STDERR ' | tail -1); tderr=$(printf '%s\n' "$td" | sed -n 's/^STDERR //p')
  keep "$LOG/teardown.log" "$td"
  if [ "$tdok" = "TEARDOWN OK $RUN" ]; then
    echo "  ok   teardown: every row of $RUN removed (incl. Auth sessions, refresh tokens, identities, MFA), guards re-enabled, zero residue proved"
  else fail "teardown: last line '${tdok:-<none>}'; $(printf '%s' "$tderr" | tr '\n' ' ' | redact | cut -c1-300)"; fi
  local i m marker dn
  for (( i=${#APPLIED[@]}-1; i>=0; i-- )); do
    m="${APPLIED[$i]}"
    case "$m" in
      20261019120000_*) marker="set local asb.pda_desk_quotes_down = 'history-exported:$RUN';";;
      20261019110000_*) marker="set local asb.pda_acceptances_down = 'history-exported:$RUN';";;
      20261019100000_*) marker="set local asb.pda_quotes_down = 'history-exported:$RUN';";;
      20261018130000_*) marker="set local asb.pda_agencies_down = 'registry-exported:$RUN';";;
      20261018120000_*) marker="set local asb.pda_sets_down = 'history-exported:$RUN';";;
      20261018110000_*) marker="set local asb.pda_prefs_down = 'discard-preferences';";;
      *) marker="";;
    esac
    if dn=$({ echo "$marker"; cat "supabase/rollback/${m}_down.sql"; } 2>&1 | psqlq -1 -f - 2>&1); then keep "$LOG/down-$m.log" "$dn"; echo "  ok   DOWN $m"
    else keep "$LOG/down-$m.log" "$dn"; fail "DOWN $m: $({ printf '%s\n' "$dn" | grep -m1 -i error || printf '%s\n' "$dn" | head -1; } | redact)"; fi
  done
  psqlq -c "update public.app_settings set value = '$BETA'::jsonb where key = 'beta_mode'" > /dev/null 2>&1 && echo "  ok   beta_mode restored to $BETA" || fail "beta_mode not restored"
  if measure "$LOG/after"; then
    # the baseline is the pinned manifest and the fingerprints, all held in memory since the gate: nothing on disk can change it
    diff -q <(printf '%s\n' "$BASE_MANIFEST") "$LOG/after/manifest.txt" > /dev/null && echo "  ok   migration history = pinned manifest" || fail "migration history differs from the pinned manifest"
    [ "$(tail -1 "$LOG/after/invariants.txt")" = "PREFLIGHT INVARIANTS OK" ] && echo "  ok   invariants hold again (no run or 15:27 shape, guards on, email off, beta true)" \
      || { fail "invariants after the run:"; sed 's/^/        /' "$LOG/after/invariants.txt"; }
    if [ "$SCHEMA_MD5" = "$BASE_SCHEMA" ]; then echo "  ok   schema fingerprint = baseline ($BASE_SCHEMA, $(wc -l < "$LOG/after/schema.txt") catalog lines)"
    else fail "schema fingerprint $SCHEMA_MD5 differs from the baseline $BASE_SCHEMA:"; [ -f "$LOG/before/schema.txt" ] && diff "$LOG/before/schema.txt" "$LOG/after/schema.txt" | grep '^[<>]' | head -20 | sed 's/^/        /'; fi
    if [ "$DATA_MD5" = "$BASE_DATA" ]; then echo "  ok   data fingerprint = baseline (every row of $(wc -l < "$LOG/after/data.txt") tables; exceptions: Auth audit log, sequence positions)"
    else fail "data fingerprint $DATA_MD5 differs from the baseline $BASE_DATA:"; [ -f "$LOG/before/data.txt" ] && diff "$LOG/before/data.txt" "$LOG/after/data.txt" | grep '^[<>]' | head -20 | sed 's/^/        /'; fi
  else fail "a measurement after the run failed: $(cat "$LOG"/after/*.err 2>/dev/null | redact | tr '\n' ' ' | cut -c1-300)"; fi
  [ $PW = 0 ] || fail "browser run (see $LOG/playwright.log and test-results/pda-agents/)"
  if [ $FAILED = 0 ]; then echo "== RUN $RUN PASSED ($(date +%H:%M:%S))"; exit 0; else echo "== RUN $RUN FAILED ($(date +%H:%M:%S))"; exit 1; fi
}
trap finish EXIT

# ── 1 · PDA migrations (unrecorded; rolled back in the trap)
for m in 20261018100000_pda_ports_workspace 20261018110000_pda_member_preferences 20261018120000_pda_estimate_sets 20261018130000_pda_agencies \
         20261018140000_pda_estimate_set_org_lineage 20261019100000_pda_quote_requests 20261019110000_pda_quote_acceptance 20261019120000_pda_desk_quotes; do
  if [ -n "$(psqlro -c "select 1 from supabase_migrations.schema_migrations where version = '${m%%_*}'")" ]; then
    fail "migration $m is already recorded on staging; this run applies only unreleased PDA migrations"; exit 1
  fi
  ap=$(psqlq -1 -f - < "supabase/migrations/$m.sql" 2>&1) || { keep "$LOG/apply-$m.log" "$ap"; fail "apply $m: $({ printf '%s\n' "$ap" | grep -m1 -i error || printf '%s\n' "$ap" | head -1; } | redact)"; exit 1; }
  keep "$LOG/apply-$m.log" "$ap"; APPLIED+=("$m"); echo "  ok   applied $m"
done

# ── 2 · beta off
psqlq -c "update public.app_settings set value = 'false'::jsonb where key = 'beta_mode'" > /dev/null || { fail "beta_mode off"; exit 1; }

# ── 3 · build + browser, bound to staging and to this run id
[ -f .env.local ] && { ENVBK=".env.local.bk-$RUN"; mv .env.local "$ENVBK"; }
cp "$ENV_FILE" .env.local; STAGED=1
set -a; . "$ENV_FILE"; set +a
export E2E_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" E2E_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" E2E_SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
export E2E_ALLOW_REMOTE="$STAGING_REF" E2E_DB_URL="$DBURL" E2E_PG_IMAGE="$IMG" E2E_RUN_ID="$RUN"
bl=$(npx next build --webpack 2>&1) || { keep "$LOG/build.log" "$bl"; fail "next build (see $LOG/build.log)"; exit 1; }
keep "$LOG/build.log" "$bl"; echo "  ok   next build against staging"
# Playwright empties its own outputDir (test-results/pda-agents, playwright.pda.config.ts) at start-up; the runner's logs are elsewhere
pl=$(npx playwright test --config=playwright.pda.config.ts e2e/pda-agents.spec.ts 2>&1); PW=$?
keep "$LOG/playwright.log" "$pl"; printf '%s\n' "$pl" | tail -25
exit 0
