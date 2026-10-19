#!/usr/bin/env bash
# PDA agents browser run on the approved hosted STAGING project, fail-closed (Codex C2O-158/159 P0).
#
#   scripts/e2e/pda-agents-run.sh --i-hold-the-staging-window
#
# Only in an announced STAGING EXCLUSIVE window. Refuses production anywhere and any target but staging.
#
# Lifecycle:
#   1. baseline fingerprints (schema, data and disabled triggers)
#   2. the PDA migrations, applied unrecorded
#   3. beta_mode off
#   4. next build + Playwright e2e/pda-agents.spec.ts under one run id
# Whatever happens after step 1 (a partial seed, a failed migration, a failed browser step), the EXIT trap runs:
#   - the checked-in teardown for that run id
#   - the DOWNs of every migration this run applied, newest first
#   - beta_mode restored
#   - the fingerprints compared with the baseline
# Any teardown, rollback or fingerprint difference makes the run FAILED, never a warning.
# Every database call is checked. Secrets travel in the environment only and are never printed.
set -uo pipefail
[ "${1:-}" = "--i-hold-the-staging-window" ] || { echo "REFUSED: run only inside an announced STAGING EXCLUSIVE window (--i-hold-the-staging-window)"; exit 2; }

STAGING_REF=sidcsytgqalqacsgyguz
PROD_REF=rezfejaxbmdzkslrrefr
DB_FILE="${ASB_STAGING_DB_FILE:-$HOME/.asb-staging-db}"
ENV_FILE="${ASB_STAGING_ENV_FILE:-$HOME/.asb-staging-env}"
CA_FILE="${ASB_STAGING_CA_FILE:-$HOME/.asb-staging-root.crt}"
IMG="${E2E_PG_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.127}"
for f in "$DB_FILE" "$ENV_FILE" "$CA_FILE"; do [ -r "$f" ] || { echo "REFUSED: $f is not readable"; exit 2; }; done
DBURL="$(cat "$DB_FILE")"
case "$DBURL" in *"$PROD_REF"*) echo "REFUSED: production database"; exit 2;; *"postgres.$STAGING_REF@"*|*"db.$STAGING_REF.supabase.co"*) ;; *) echo "REFUSED: the database is not the staging project"; exit 2;; esac
grep -q "$PROD_REF" "$ENV_FILE" && { echo "REFUSED: production in the env file"; exit 2; }
grep -q "^NEXT_PUBLIC_SUPABASE_URL=https://$STAGING_REF.supabase.co/*$" "$ENV_FILE" || { echo "REFUSED: the env file's API is not the staging project"; exit 2; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2
RUN="pdaag-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
[[ "$RUN" =~ ^pdaag-[0-9a-f]{12}$ ]] || { echo "REFUSED: could not make a run id"; exit 2; }
LOG="test-results/pda-agents-run/$RUN"; mkdir -p "$LOG"
echo "== PDA agents staging run $RUN ($(date +%H:%M:%S))"

CERT="$(cygpath -w "$CA_FILE" 2>/dev/null || echo "$CA_FILE")"
psqlq(){ MSYS_NO_PATHCONV=1 docker run --rm -i -v "$CERT:/root/.postgresql/root.crt:ro" -e PGURL="$DBURL" --entrypoint sh "$IMG" \
           -c 'psql "$PGURL" -X -q -At -v ON_ERROR_STOP=1 "$@"' sh "$@"; }
SCHEMA_FP="select md5(string_agg(x, '|' order by x)) from (
  select p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'
  union all select c.relname || ':' || c.relkind::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
  union all select co.conrelid::regclass::text || '/' || co.conname || ':' || md5(pg_get_constraintdef(co.oid)) from pg_constraint co join pg_namespace n on n.oid = co.connamespace where n.nspname = 'public'
  union all select tg.tgrelid::regclass::text || '/' || tg.tgname || ':' || tg.tgenabled from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not tg.tgisinternal) s"
# exact row counts of every table the run can touch (public, market_private, auth users and identities)
DATA_FP="do \$\$ declare r record; n bigint; acc text := ''; begin
  for r in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where c.relkind = 'r' and (n.nspname in ('public', 'market_private') or (n.nspname = 'auth' and c.relname in ('users', 'identities')))
           order by 1, 2 loop
    execute format('select count(*) from %I.%I', r.nspname, r.relname) into n;
    acc := acc || r.nspname || '.' || r.relname || '=' || n || ';';
  end loop;
  perform set_config('e2e.data_fp', acc, false);
end \$\$; select current_setting('e2e.data_fp');"

FAILED=0; APPLIED=(); BETA=""; ENVBK=""; PW=1
fail(){ echo "  FAIL $*"; FAILED=1; }

finish(){
  echo "== teardown, rollback, verification ($(date +%H:%M:%S))"
  [ -f .env.local ] && rm -f .env.local; [ -n "$ENVBK" ] && mv "$ENVBK" .env.local
  if out=$(psqlq -v run="$RUN" -f - < supabase/tests/e2e/pda-agents-teardown.sql 2>"$LOG/teardown.err") && [ "$(echo "$out" | tail -1)" = "TEARDOWN OK $RUN" ]; then
    echo "  ok   teardown: every row of $RUN removed, guards re-enabled, zero residue proved"
  else fail "teardown: $(tr '\n' ' ' < "$LOG/teardown.err" | sed 's/postgres[a-z]*:\/\/[^ ]*/<db-url>/g' | cut -c1-300)"; fi
  local i m marker
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
    if { echo "$marker"; cat "supabase/rollback/${m}_down.sql"; } | psqlq -1 -f - > "$LOG/down-$m.log" 2>&1; then echo "  ok   DOWN $m"
    else fail "DOWN $m: $(grep -m1 ERROR "$LOG/down-$m.log")"; fi
  done
  if [ -n "$BETA" ]; then
    psqlq -c "update public.app_settings set value = '$BETA'::jsonb where key = 'beta_mode'" > /dev/null 2>&1 && echo "  ok   beta_mode restored to $BETA" || fail "beta_mode not restored"
  fi
  local s1 d1
  s1=$(psqlq -c "$SCHEMA_FP" 2>/dev/null) || fail "schema fingerprint unreadable"
  d1=$(psqlq -c "$DATA_FP" 2>/dev/null | tail -1) || fail "data fingerprint unreadable"
  [ -n "$s1" ] && [ "$s1" = "$S0" ] && echo "  ok   schema fingerprint = baseline (${s1:0:12})" || fail "schema fingerprint ${s1:0:12} differs from baseline ${S0:0:12}"
  if [ -n "$d1" ] && [ "$d1" = "$D0" ]; then echo "  ok   data fingerprint = baseline (every table's row count)"
  else
    fail "data fingerprint differs from baseline:"
    diff <(echo "$D0" | tr ';' '\n') <(echo "$d1" | tr ';' '\n') | grep '^[<>]' | head -20 | sed 's/^/        /'
  fi
  [ $PW = 0 ] || fail "browser run (see $LOG)"
  if [ $FAILED = 0 ]; then echo "== RUN $RUN PASSED ($(date +%H:%M:%S))"; exit 0; else echo "== RUN $RUN FAILED ($(date +%H:%M:%S))"; exit 1; fi
}

# 1 · baseline
S0=$(psqlq -c "$SCHEMA_FP") || { echo "REFUSED: staging unreachable"; exit 2; }
D0=$(psqlq -c "$DATA_FP" | tail -1) || { echo "REFUSED: data fingerprint unreadable"; exit 2; }
[ -n "$S0" ] && [ -n "$D0" ] || { echo "REFUSED: empty baseline"; exit 2; }
BETA=$(psqlq -c "select value::text from public.app_settings where key = 'beta_mode'") || { echo "REFUSED: beta_mode unreadable"; exit 2; }
[ -n "$(psqlq -c "select 1 from public.notification_dispatch_config where id = 1 and dispatch_url is null")" ] || { echo "REFUSED: staging has an email dispatch URL"; exit 2; }
echo "  ok   baseline: schema ${S0:0:12}, data fingerprint taken, beta_mode=$BETA, email dispatch off"
trap finish EXIT

# 2 · PDA migrations (unrecorded; rolled back in the trap)
for m in 20261018100000_pda_ports_workspace 20261018110000_pda_member_preferences 20261018120000_pda_estimate_sets 20261018130000_pda_agencies \
         20261018140000_pda_estimate_set_org_lineage 20261019100000_pda_quote_requests 20261019110000_pda_quote_acceptance 20261019120000_pda_desk_quotes; do
  if [ -n "$(psqlq -c "select 1 from supabase_migrations.schema_migrations where version = '${m%%_*}'")" ]; then
    fail "migration $m is already recorded on staging; this run applies only unreleased PDA migrations"; exit 1
  fi
  psqlq -1 -f - < "supabase/migrations/$m.sql" > "$LOG/apply-$m.log" 2>&1 || { fail "apply $m: $(grep -m1 ERROR "$LOG/apply-$m.log")"; exit 1; }
  APPLIED+=("$m"); echo "  ok   applied $m"
done

# 3 · beta off
psqlq -c "update public.app_settings set value = 'false'::jsonb where key = 'beta_mode'" > /dev/null || { fail "beta_mode off"; exit 1; }

# 4 · build + browser, bound to staging and to this run id
[ -f .env.local ] && { ENVBK=".env.local.bk-$RUN"; mv .env.local "$ENVBK"; }
cp "$ENV_FILE" .env.local
set -a; . "$ENV_FILE"; set +a
export E2E_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" E2E_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" E2E_SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
export E2E_ALLOW_REMOTE="$STAGING_REF" E2E_DB_URL="$DBURL" E2E_PG_IMAGE="$IMG" E2E_RUN_ID="$RUN"
npx next build --webpack > "$LOG/build.log" 2>&1 || { fail "next build (see $LOG/build.log)"; exit 1; }
echo "  ok   next build against staging"
npx playwright test --config=playwright.pda.config.ts e2e/pda-agents.spec.ts > "$LOG/playwright.log" 2>&1; PW=$?
tail -25 "$LOG/playwright.log"
exit 0
