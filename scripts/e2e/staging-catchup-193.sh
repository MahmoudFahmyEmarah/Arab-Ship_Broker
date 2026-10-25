#!/usr/bin/env bash
# Hosted STAGING catch-up 185 -> 193: applies AND records the eight migrations production carries since 19/25 Oct 2026
# (Wave 8: 20261018100000/110000/120000; Wave 9: 20261018130000/140000, 20261019100000/110000/120000), byte-identical
# to what production ran (sha256 pinned below), so later staging runs start from production's schema (B2O-091).
#
#   scripts/e2e/staging-catchup-193.sh --precheck
#       read-only: the pre-state gates and the RECEIPT FIELDS line the peer reviews before minting the receipt
#   scripts/e2e/staging-catchup-193.sh --i-hold-the-staging-window --peer-mail-read-at=<unix seconds>
#       the catch-up, inside an announced STAGING EXCLUSIVE window, with a receipt minted by the peer auditor
#   CATCHUP_STANDIN_DB=asb_<name> scripts/e2e/staging-catchup-193.sh --standin
#       rehearsal on a LOCAL scratch clone (agents only): same gates and steps against the scratch database; no receipt,
#       no mailbox gate, no backup
#
# Forward change, no rollback trap: the rollback path is the read-only pg_dump of staging taken before the first write
# (location and size go in the log). Each migration is applied AND recorded in ONE transaction, so a version can never
# be applied but unrecorded; a failure stops the run and a re-run continues from staging's own history (a contiguous
# recorded prefix of the eight is accepted, anything else is refused).
#
# Pre-state = the pinned manifest's first 185 versions, and the preflight invariants all ok except I3a, which must read
# "0" (no Wave 8 / Agents object yet). Post-state = the pinned 193 manifest and every invariant ok (I3a = 16 of 16,
# I3b = 0: no Wave 10 design object). The new schema and data fingerprints are printed as the new staging baseline.
set -uo pipefail
MODE="${1:-}"
case "$MODE" in
  --precheck|--standin) ;;
  --i-hold-the-staging-window)
    READ_AT="${2:-}"; READ_AT="${READ_AT#--peer-mail-read-at=}"
    [[ "${2:-}" == --peer-mail-read-at=* && "$READ_AT" =~ ^[0-9]{10}$ ]] || { echo "REFUSED: --peer-mail-read-at=<unix seconds> (when you finished reading every live mailbox in full)"; exit 2; };;
  *) echo "usage: $0 --precheck | --i-hold-the-staging-window --peer-mail-read-at=<unix> | (CATCHUP_STANDIN_DB=asb_x) --standin"; exit 2;;
esac

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2
. scripts/e2e/run-log-helpers.sh || { echo "REFUSED: scripts/e2e/run-log-helpers.sh is missing"; exit 2; }

# the eight migrations, in order, with the sha256 of the exact bytes production ran (git blobs of aa48744)
CHAIN=(
  "20261018100000_pda_ports_workspace f42856eba687110529ad701619d2a08d9adbe4ea9a4d1de4626a4009ae9c2f0e"
  "20261018110000_pda_member_preferences 6684664312f2f212e0eb129aac7ba4db1616af321642150489e0408f291303b6"
  "20261018120000_pda_estimate_sets 49fd7dc77d9c43a933f538ef998829254f89b88674cd5bd6cc594378c383e8aa"
  "20261018130000_pda_agencies c75535f34eab1d2df06786145776e12a29f385f477b6406931125817316aa7f2"
  "20261018140000_pda_estimate_set_org_lineage 938b2064a2bb2c9b94580b246ea3af5905670af3e9f803b923bc5a233a27b4ca"
  "20261019100000_pda_quote_requests 28061bb1800b72c68a906344b44879bf360d2602f4dd7c379da91215478fe65b"
  "20261019110000_pda_quote_acceptance 0f5d3bbebd5533f65f0081e392f5c7b95d33ea30dc7cd9584a10c7bec29b748b"
  "20261019120000_pda_desk_quotes 54c1787d238de9a0f08475fcde5991ec3c5e8c36ccac4e43a7cf7e1dc501d79d"
)

# shape proofs: what each version creates, present with its security shape (want) or entirely absent (fresh);
# any other answer is unreadable and stops the run
proof_q() { case "$1" in
  20261018100000) echo "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'list_pda_ports_workspace'";;
  20261018110000) echo "select concat_ws('/', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'pda_member_preferences' and c.relrowsecurity), (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('get_my_pda_preferences','set_my_pda_preferences')))";;
  20261018120000) echo "select concat_ws('/', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'pda_estimate_sets' and c.relrowsecurity), (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('get_pda_estimate_set','list_my_pda_estimate_sets')))";;
  20261018130000) echo "select concat_ws('/', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('pda_agencies','pda_agency_events','pda_port_agents') and c.relrowsecurity), (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('fn_pda_agency_events_append_only','get_my_pda_agency','list_pda_port_agents','pda_admin_list_agencies','pda_admin_set_port_agent','pda_admin_upsert_agency')))";;
  20261018140000) echo "select coalesce(pg_get_functiondef(to_regprocedure('public.pda_save_estimate_set(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,uuid)')) like '%v_org uuid := p_owner_org_id%', false)::int";;
  20261019100000) echo "select concat_ws('/', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('pda_quote_requests','pda_quote_request_recipients','pda_agency_quotes') and c.relrowsecurity), (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('create_pda_quote_request','decline_pda_quote_request','withdraw_pda_quote_request','submit_pda_agency_quote','list_my_pda_quote_requests','fn_pda_is_agency_staff','fn_pda_quote_guard','fn_pda_can_read_quote_request')))";;
  20261019110000) echo "select concat_ws('/', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'pda_quote_acceptances' and c.relrowsecurity), (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('pda_accept_agency_quote','pda_quote_acceptance_context','fn_pda_carried_quote','fn_pda_leg_matches_quote','fn_pda_quote_acceptance_immutable','fn_pda_quote_request_closed')))";;
  20261019120000) echo "select concat_ws('/', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pda_agency_quotes' and column_name in ('entered_via','desk_source')), (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('pda_admin_record_agency_quote','pda_admin_list_quote_requests','fn_pda_agency_has_staff')))";;
esac; }
proof_want()  { case "$1" in 20261018100000) echo 1;; 20261018110000) echo 1/2;; 20261018120000) echo 1/2;; 20261018130000) echo 3/6;; 20261018140000) echo 1;; 20261019100000) echo 3/8;; 20261019110000) echo 1/6;; 20261019120000) echo 2/3;; esac; }
proof_fresh() { case "$1" in 20261018100000) echo 0;; 20261018110000) echo 0/0;; 20261018120000) echo 0/0;; 20261018130000) echo 0/0;; 20261018140000) echo 0;; 20261019100000) echo 0/0;; 20261019110000) echo 0/0;; 20261019120000) echo 0/0;; esac; }

# ── the database binding
if [ "$MODE" = --standin ]; then
  case "${CATCHUP_STANDIN_DB:-}" in asb_[a-z0-9_]*) ;; *) echo "REFUSED: --standin needs CATCHUP_STANDIN_DB=asb_<name> (a local scratch clone)"; exit 2;; esac
  psqlq(){ docker exec -i supabase_db_arab-ship-broker psql -U postgres -d "$CATCHUP_STANDIN_DB" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
  psqlro(){ docker exec -i -e PGOPTIONS="-c default_transaction_read_only=on" supabase_db_arab-ship-broker psql -U postgres -d "$CATCHUP_STANDIN_DB" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
  redact(){ cat; }
  measure(){
    local out="$1"; mkdir -p "$out"
    psqlro -c "select version from supabase_migrations.schema_migrations order by version" > "$out/manifest.txt" 2> "$out/manifest.err" || return 1
    # a local stand-in carries auth.users only, so the hosted-only invariants (I1 Auth/orphans, I2, I4, I5) cannot run
    # here; the I3a/I3b block is taken VERBATIM from the preflight file and wrapped in the same output format
    { echo "begin transaction read only;"; echo "do \$pf\$ declare n bigint; bad int := 0; acc text := ''; r record; begin";
      sed -n '/^  -- I3a ·/,/^  -- I4 ·/p' supabase/tests/e2e/pda-agents-preflight.sql | sed '$d';
      echo "perform set_config('e2e.preflight', acc || case when bad = 0 then 'PREFLIGHT INVARIANTS OK' else 'PREFLIGHT INVARIANTS FAILED (' || bad || ')' end, false); end \$pf\$;";
      echo "select current_setting('e2e.preflight');"; echo "commit;"; } | psqlro -f - > "$out/invariants.txt" 2> "$out/invariants.err" || return 1
    grep -q 'I3a Wave 8 / Agents objects present' "$out/invariants.txt" && grep -q 'I3b Wave 10 design objects present' "$out/invariants.txt" || return 1
    psqlro -f - < supabase/tests/e2e/schema-fingerprint.sql > "$out/schema.txt" 2> "$out/schema.err" || return 1
    psqlro -f - < supabase/tests/e2e/data-fingerprint.sql > "$out/data.txt" 2> "$out/data.err" || return 1
    [ -s "$out/schema.txt" ] && [ -s "$out/data.txt" ] || return 1
    SCHEMA_MD5=$(md5sum < "$out/schema.txt" | cut -c1-32); DATA_MD5=$(md5sum < "$out/data.txt" | cut -c1-32)
  }
  TARGET="STAND-IN $CATCHUP_STANDIN_DB (invariants limited to I3a/I3b: the hosted-only I1/I2/I4/I5 need Auth tables a stand-in lacks)"
else
  . scripts/e2e/staging-target.sh   # staging-only binding: production refused, PGURL through the environment only
  TARGET="STAGING"
fi

LOG=$(logdir "tmp/staging-catchup-193/$(date +%Y%m%d-%H%M%S)" staging-catchup-193)
say(){ echo "$*"; keep_append "$*"; }
keep_append(){ { printf '%s\n' "$*" >> "$LOG/catchup.log"; } 2>/dev/null || true; }
die(){ say "STOP: $*"; say "Nothing after this step ran. Paste this output to Opus B."; exit 2; }
say "== staging catch-up 185 -> 193 · $MODE · target: $TARGET · head $(git rev-parse --short HEAD) · runner sha256 $(sha256sum "$0" | cut -c1-64) · $(date '+%F %H:%M:%S')"
say "  log directory: $LOG"

# ── 0 · local gates: pinned files, manifest, byte-identical chain
PIN=supabase/tests/e2e/staging-released-manifest.txt
[ "$(tr -d '\r' < "$PIN" | grep -c .)" = 193 ] || die "$PIN must pin exactly 193 versions"
PRE_MANIFEST=$(tr -d '\r' < "$PIN" | head -185); POST_MANIFEST=$(tr -d '\r' < "$PIN")
[ "$(printf '%s\n' "$POST_MANIFEST" | tail -8 | tr '\n' ' ')" = "$(for e in "${CHAIN[@]}"; do printf '%s ' "${e%%_*}"; done)" ] || die "the last eight pinned versions are not this chain, in order"
for e in "${CHAIN[@]}"; do
  m="${e%% *}"; want_sha="${e##* }"; f="supabase/migrations/$m.sql"
  [ -f "$f" ] || die "$f is missing"
  got_sha=$(sha256sum "$f" | cut -c1-64)
  [ "$got_sha" = "$want_sha" ] || die "$f is not the bytes production ran (sha256 $got_sha, pinned $want_sha)"
  tr -d '\r' < "$f" | grep -qiE '^[[:space:]]*(begin|commit|rollback|start transaction|end transaction)[[:space:]]*;' && die "$f contains a bare transaction statement"
done
say "  ok   the eight migration files are byte-identical to production's (sha256 pinned)"

# pre-state: the first 185 pinned versions, every invariant ok except I3a = 0 (no Wave 8 / Agents object yet)
pre_state_ok(){ # $1 = measurement dir
  diff -q <(printf '%s\n' "$PRE_MANIFEST") "$1/manifest.txt" > /dev/null || return 1
  [ "$(grep -c '^FAIL ' "$1/invariants.txt")" = 1 ] || return 1
  grep -qE '^FAIL I3a Wave 8 / Agents objects present .*: 0$' "$1/invariants.txt" || return 1
  [ "$(tail -1 "$1/invariants.txt")" = "PREFLIGHT INVARIANTS FAILED (1)" ] || return 1
}

# ── --precheck: read-only, prints what the peer reviews and pins in the receipt
if [ "$MODE" = --precheck ]; then
  measure "$LOG/precheck" || die "a read-only measurement failed: $(cat "$LOG"/precheck/*.err 2>/dev/null | redact | tr '\n' ' ' | cut -c1-300)"
  sed 's/^/  /' "$LOG/precheck/invariants.txt"
  if pre_state_ok "$LOG/precheck"; then
    say "  ok   pre-state: history = the pinned first 185; every invariant ok except I3a = 0"
    say "RECEIPT FIELDS: SHA=$(git rev-parse HEAD) SCHEMA=$SCHEMA_MD5 DATA=$DATA_MD5"
    say "== PRECHECK OK (read-only; nothing written)"; exit 0
  fi
  die "the target is not in the catch-up pre-state (see the invariants above and $LOG/precheck/manifest.txt)"
fi

# ── 1 · window gates (staging only): receipt, audited checkout, peer mail, health, measurements = receipt, grace
if [ "$MODE" = --i-hold-the-staging-window ]; then
  RECEIPT="${ASB_STAGING_RECEIPT:-$HOME/.asb-staging-receipt}"
  LEDGER="${ASB_STAGING_LEDGER:-$HOME/.asb-staging-receipts-used}"
  MAILDIR="${ASB_MAILBOX_DIR:-$(cd "$(git rev-parse --git-common-dir)/.." && pwd)/docs/coordination/live}"
  receipt(){
    [ -r "$RECEIPT" ] || die "no receipt at $RECEIPT (the peer auditor mints it after reviewing --precheck)"
    local body; body="$(tr -d '\r' < "$RECEIPT")"
    echo "$body" | grep -vqE '^(STATUS=[A-Z]+|SHA=[0-9a-f]{40}|SCHEMA=[0-9a-f]{32}|DATA=[0-9a-f]{32}|NONCE=[0-9a-f]{32}|ISSUED_AT=[0-9]{10}|)$' && die "the receipt has a line outside the format"
    R_STATUS=$(echo "$body" | sed -n 's/^STATUS=//p'); R_SHA=$(echo "$body" | sed -n 's/^SHA=//p'); R_SCHEMA=$(echo "$body" | sed -n 's/^SCHEMA=//p')
    R_DATA=$(echo "$body" | sed -n 's/^DATA=//p'); R_NONCE=$(echo "$body" | sed -n 's/^NONCE=//p'); R_ISSUED=$(echo "$body" | sed -n 's/^ISSUED_AT=//p')
    for v in "$R_STATUS" "$R_SHA" "$R_SCHEMA" "$R_DATA" "$R_NONCE" "$R_ISSUED"; do [ -n "$v" ] && [ "$(echo "$v" | wc -l)" = 1 ] || die "the receipt lacks a field or repeats one"; done
    [ "$R_STATUS" = GO ] || die "the receipt says $R_STATUS, not GO"
  }
  peer_mail(){ local f m
    for f in opus-to-codex.md opusb-to-all.md codex-to-opus.md; do
      [ -r "$MAILDIR/$f" ] || die "cannot read $MAILDIR/$f"
      m=$(stat -c %Y "$MAILDIR/$f"); [ "$m" -le "$READ_AT" ] || die "$f changed after your read ($1); read all three live mailboxes in full again and re-run"
    done; }
  receipt
  NOW=$(date +%s)
  [ "$READ_AT" -ge "$R_ISSUED" ] && [ "$READ_AT" -le "$NOW" ] && [ $(( NOW - READ_AT )) -le 900 ] || die "--peer-mail-read-at must be after the receipt and within the last 15 minutes"
  [ "$(git rev-parse HEAD)" = "$R_SHA" ] || die "the checkout is not the audited head ${R_SHA:0:12}"
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "tracked files differ from the audited head"
  [ -f "$LEDGER" ] && grep -qx "$R_NONCE" "$LEDGER" && die "this receipt was already used"
  peer_mail "before the gates"
  api_health || die "the staging API host does not resolve or /auth/v1/health does not answer 200"
fi

# ── 2 · the state as found (read-only)
measure "$LOG/before" || die "a read-only measurement failed: $(cat "$LOG"/before/*.err 2>/dev/null | redact | tr '\n' ' ' | cut -c1-300)"
RECORDED=$(grep -c . "$LOG/before/manifest.txt")
say "  ..   as found: $RECORDED recorded versions; schema $SCHEMA_MD5; data $DATA_MD5"
if [ "$RECORDED" = 185 ]; then
  pre_state_ok "$LOG/before" || die "185 versions recorded but not the catch-up pre-state (see $LOG/before/)"
  if [ "$MODE" = --i-hold-the-staging-window ]; then
    [ "$SCHEMA_MD5" = "$R_SCHEMA" ] || die "schema fingerprint $SCHEMA_MD5 is not the reviewed $R_SCHEMA"
    [ "$DATA_MD5" = "$R_DATA" ] || die "data fingerprint $DATA_MD5 is not the reviewed $R_DATA"
  fi
  say "  ok   pre-state = the pinned first 185, invariants as expected"
else
  # a resumed run: the recorded history must be the pinned first 185 plus a contiguous prefix of the chain
  diff -q <(printf '%s\n' "$POST_MANIFEST" | head -"$RECORDED") "$LOG/before/manifest.txt" > /dev/null || die "the recorded history ($RECORDED versions) is not a prefix of the pinned 193"
  [ "$RECORDED" -gt 185 ] && [ "$RECORDED" -le 193 ] || die "unexpected history length $RECORDED"
  say "  ..   resuming: $(( RECORDED - 185 )) of the eight already recorded"
  [ "$MODE" = --i-hold-the-staging-window ] && say "  ..   resumed run: the receipt's fingerprints were the pre-state's; the recorded prefix is proved by shape below"
fi

if [ "$MODE" = --i-hold-the-staging-window ]; then
  echo "$R_NONCE" >> "$LEDGER" || die "could not spend the receipt"
  say "  ..   receipt spent; 60 s grace (a HOLD or a changed mailbox still stops the run)"
  sleep 60
  receipt; peer_mail "during the grace period"
  [ "$(git rev-parse HEAD)" = "$R_SHA" ] && [ -z "$(git status --porcelain --untracked-files=no)" ] || die "the checkout changed during the grace period"
  measure "$LOG/grace" && [ "$(grep -c . "$LOG/grace/manifest.txt")" = "$RECORDED" ] || die "staging changed during the grace period"
  [ "$RECORDED" != 185 ] || { [ "$SCHEMA_MD5" = "$R_SCHEMA" ] && [ "$DATA_MD5" = "$R_DATA" ]; } || die "staging changed during the grace period"

  # ── 3 · the rollback path: a read-only dump of staging, outside the repository
  BK_DIR=/c/Users/mahmo/asb-backups; BK="$BK_DIR/staging-$(date +%Y%m%d-%H%M%S)-catchup193.dump"
  mkdir -p "$BK_DIR" || die "cannot create $BK_DIR"
  [ -e "$BK" ] && die "$BK already exists"
  MSYS_NO_PATHCONV=1 docker run --rm -i -v "$CERT:/root/.postgresql/root.crt:ro" -e PGURL -e PGCONNECT_TIMEOUT=30 --entrypoint sh "$IMG" \
    -c 'pg_dump "$PGURL" -Fc --no-owner --no-privileges -n public -n market_private -n fixture_private -n supabase_migrations' > "$BK" 2> "$LOG/backup.err" \
    || die "the staging dump failed: $(redact < "$LOG/backup.err" | tr '\n' ' ' | cut -c1-300)"
  BK_SIZE=$(stat -c %s "$BK"); [ "$BK_SIZE" -gt 1000000 ] || die "the staging dump is implausibly small ($BK_SIZE bytes)"
  MSYS_NO_PATHCONV=1 docker run --rm -i --entrypoint sh "$IMG" -c 'pg_restore --list > /dev/null' < "$BK" || die "the staging dump does not list (pg_restore --list failed)"
  say "  ok   rollback path: $BK ($BK_SIZE bytes, pg_restore --list OK)"
fi

# ── 4 · apply AND record each pending migration in one transaction, in order; stop at the first error
for e in "${CHAIN[@]}"; do
  m="${e%% *}"; v="${m%%_*}"
  recorded=$(psqlro -c "select count(*) from supabase_migrations.schema_migrations where version = '$v'" 2>&1)
  [[ "$recorded" =~ ^[01]$ ]] || die "could not read whether $v is recorded (got '$(printf '%s' "$recorded" | redact | head -c 200)')"
  shape=$(psqlro -c "$(proof_q "$v")" 2>&1)
  if [ "$recorded" = 1 ]; then
    [ "$shape" = "$(proof_want "$v")" ] || die "$v is recorded but its shape is '$shape' (want $(proof_want "$v"))"
    say "  ..   $m already recorded, shape $shape"; continue
  fi
  [ "$shape" = "$(proof_fresh "$v")" ] || die "$v is not recorded but its shape is '$shape' (fresh is $(proof_fresh "$v")); not the expected state — paste this to Opus B"
  name="${m#*_}"
  out=$( { cat "supabase/migrations/$m.sql"; printf '\ninsert into supabase_migrations.schema_migrations (version, name) values (%s, %s);\n' "'$v'" "'$name'"; } | psqlq -1 -f - 2>&1 ) \
    || { keep "$LOG/apply-$m.log" "$out"; die "apply $m: $({ printf '%s\n' "$out" | grep -m1 -i error || printf '%s\n' "$out" | head -1; } | redact) (rolled back: nothing of $m was written)"; }
  keep "$LOG/apply-$m.log" "$out"
  shape=$(psqlro -c "$(proof_q "$v")" 2>&1)
  [ "$shape" = "$(proof_want "$v")" ] || die "$m applied and recorded but its shape reads '$shape' (want $(proof_want "$v"))"
  say "  ok   applied and recorded $m (shape $shape)"
done

# ── 5 · the post-state: the pinned 193, every invariant ok; the new baseline
measure "$LOG/after" || die "a read-only measurement after the catch-up failed: $(cat "$LOG"/after/*.err 2>/dev/null | redact | tr '\n' ' ' | cut -c1-300)"
diff -q <(printf '%s\n' "$POST_MANIFEST") "$LOG/after/manifest.txt" > /dev/null || die "the recorded history is not the pinned 193"
sed 's/^/  /' "$LOG/after/invariants.txt"
[ "$(tail -1 "$LOG/after/invariants.txt")" = "PREFLIGHT INVARIANTS OK" ] || die "invariants after the catch-up are not all ok"
say "  ok   history = the pinned 193; every invariant ok (I3a 16 of 16, I3b 0)"
if [ -f "$LOG/before/data.txt" ]; then
  say "  ..   data tables whose row digest changed (expected: supabase_migrations.schema_migrations and only the tables these migrations seed):"
  diff "$LOG/before/data.txt" "$LOG/after/data.txt" | sed -n 's/^> data \([^ ]*\) .*/        \1/p' | sort -u | while read -r t; do say "$t"; done
fi
say "NEW BASELINE: SCHEMA=$SCHEMA_MD5 DATA=$DATA_MD5 (manifest 193)"
say "== CATCH-UP OK ($TARGET, $(date +%H:%M:%S))"
