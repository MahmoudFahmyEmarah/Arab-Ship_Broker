#!/usr/bin/env bash
# Apply exactly one release, while other migrations are pending (21 Sep 2026).
#
#   scripts/release-apply.sh <manifest> [--target linked|local] [--apply]
#
# `supabase db push` applies EVERY pending migration. With two releases in
# flight — Data Quality (20260919*) and Data Sync (20260920*) — that is not
# what anyone wants, and "move the other release's files out of the folder
# first" is a procedure that depends on remembering to move them back.
#
# This applies the manifest's files and nothing else:
#   · each file in its own transaction, ON_ERROR_STOP, stopping on the first
#     failure so a half-applied release is never left silently behind
#   · each version recorded in supabase_migrations.schema_migrations, so the
#     CLI afterwards reports the release as applied and `db push` will not try
#     again
#   · the other release's files are never read
#
# DRY RUN BY DEFAULT. It prints what it would do and changes nothing until
# --apply is passed. Even then it refuses unless release-check.sh agrees.
#
# It asks release-check.sh the ISOLATED question (21 Sep 2026), not the strict
# one. The strict question is "is a plain db push safe", which requires the
# pending set to equal the manifest — a condition that contradicts this
# script's entire purpose, and which used to make --apply impossible in the one
# situation it exists for. The isolated question is the right one:
#
#   · every file in this manifest is still pending  (nothing half-applied)
#   · no migration OLDER than this release is pending, because applying this
#     one would move the newest applied version past it and the CLI would then
#     refuse to insert it at all
#
# Other, NEWER pending releases are listed and left alone.
set -uo pipefail
MANIFEST="${1:?usage: release-apply.sh <manifest> [--target linked|local] [--apply]}"
shift
TARGET=linked
APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2;;
    --apply) APPLY=1; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
cd "$(dirname "$0")/.."
[ -f "$MANIFEST" ] || { echo "manifest not found: $MANIFEST" >&2; exit 2; }
say() { printf '%s\n' "$*"; }

FILES="$(grep -vE '^\s*(#|$)' "$MANIFEST")"
[ -n "$FILES" ] || { echo "manifest is empty" >&2; exit 2; }

say "── release: $(basename "$MANIFEST")  ·  target: $TARGET  ·  mode: $([ $APPLY -eq 1 ] && echo APPLY || echo 'DRY RUN')"
missing=0
for f in $FILES; do
  if [ -f "supabase/migrations/$f" ]; then say "  ok   supabase/migrations/$f"; else say " FAIL  supabase/migrations/$f is missing"; missing=1; fi
done
[ $missing -eq 0 ] || { say "RELEASE APPLY: FAILED — manifest names files that are not in the repository"; exit 1; }

if [ $APPLY -eq 0 ]; then
  say ""
  say "Dry run. Nothing was applied. Before applying:"
  say "  1. scripts/release-check.sh $MANIFEST --isolated      (or without --isolated when nothing else is pending)"
  say "  2. scripts/migration-harness.sh --target linked --chain <these files> --smokes <suites> --downs <downs newest first>"
  say "  3. scripts/release-apply.sh $MANIFEST --apply"
  exit 0
fi

# the gate: every manifest entry pending, and nothing older waiting behind it
if [ "$TARGET" = linked ]; then
  if ! bash scripts/release-check.sh "$MANIFEST" --isolated; then
    say "RELEASE APPLY: FAILED — release-check --isolated refused; nothing was applied"
    exit 1
  fi
fi

# The files are applied in version order whatever order the manifest lists
# them in: each one is recorded as applied, and a later file recorded before an
# earlier one leaves a gap the CLI will not fill.
FILES="$(printf '%s
' $FILES | sort)"

run_one() { # $1 path
  case "$TARGET" in
    linked) npx supabase db query --linked --file "$1";;
    local)  docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -1 -f - < "$1";;
    *) echo "unknown target: $TARGET" >&2; return 2;;
  esac
}
record() { # $1 version
  case "$TARGET" in
    linked) npx supabase migration repair --status applied "$1";;
    local)  docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres -q -c "insert into supabase_migrations.schema_migrations (version) values ('$1') on conflict do nothing";;
  esac
}

verify_recorded() { # $1 version — read the history back; trust nothing else
  case "$TARGET" in
    linked)
      # exit 2 from the parser means "could not read it", which is not proof
      # of anything: treat it as a failure to verify, never as verified
      npx supabase migration list --linked 2>&1 | python scripts/migration-applied.py "$1";;
    local)
      docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres -tAc         "select 1 from supabase_migrations.schema_migrations where version = '$1'" | grep -q 1;;
    *) return 1;;
  esac
}

say "── applying"
n=0
for f in $FILES; do
  v="${f%%_*}"
  say "  → $f"
  if ! run_one "supabase/migrations/$f"; then
    say " FAIL  $f did not apply. STOPPED after $n file(s)."
    say "       Roll back what was applied with the matching DOWN files in reverse order, then investigate."
    exit 1
  fi
  # Recording is not optional. An applied migration whose version is not in
  # supabase_migrations.schema_migrations is invisible to the CLI: the next
  # `db push` tries to apply it again, against a schema that already has it.
  # So a recording failure STOPS the release (21 Sep 2026) — it used to print
  # a note and carry on to the next file, which is how a release ends up half
  # recorded and unrepeatable.
  if ! rec_out="$(record "$v" 2>&1)"; then
    say " FAIL  $f WAS APPLIED but its version could not be recorded."
    printf '%s
' "$rec_out" | sed 's/^/         /'
    say "       STOPPED. The database now holds this migration's changes while the history does not."
    say "       Record it by hand before anything else:"
    say "         npx supabase migration repair --status applied $v"
    say "       Then re-run this script; already-recorded files are refused by release-check."
    exit 1
  fi
  if ! verify_recorded "$v"; then
    say " FAIL  $f was applied and 'record' reported success, but $v is NOT in the migration history."
    say "       STOPPED — the history is the only thing that stops a re-apply. Repair it by hand:"
    say "         npx supabase migration repair --status applied $v"
    exit 1
  fi
  say "       recorded $v"
  n=$((n+1))
done
say "RELEASE APPLY: OK — $n migration(s) applied and recorded; no other pending migration was touched"
