#!/usr/bin/env bash
# Release isolation (20 Sep 2026; output parsing corrected 21 Sep; --isolated
# mode and the ordering guard added 21 Sep).
#
#   scripts/release-check.sh <manifest> [--isolated]
#
# `supabase db push` applies EVERY pending migration, so a release whose
# manifest lists five migrations must not be pushed while other unapplied
# files sit in supabase/migrations. This script reads the manifest (one file
# name per line, # comments allowed), asks the linked project which local
# migrations are not applied (`supabase migration list --linked`, read-only),
# and answers one of two questions:
#
#   DEFAULT (strict) — "is a plain `db push` safe right now?"
#     Passes only when the pending set equals the manifest set exactly:
#       · a manifest entry already applied    → FAIL (pushed, or partly)
#       · a pending file not in the manifest  → FAIL (it would ride along)
#
#   --isolated — "can release-apply.sh apply THIS manifest and nothing else?"
#     Other releases may be pending; they are listed and left alone. Passes
#     when every manifest entry is still pending AND the manifest is the
#     LOWEST pending block:
#       · a manifest entry already applied    → FAIL
#       · a pending file OLDER than this release's newest file → FAIL
#
# That last rule is the one that bites. Applying a release moves the newest
# applied version forward, and the Supabase CLI refuses to insert a migration
# that predates the newest applied one. Apply Data Sync (20260920*) while Data
# Quality (20260919*) is still pending and the Data Quality release can no
# longer be pushed at all — it has to be renumbered or forced. So the older
# release goes first, and this check says so before anything is applied.
#
# Exit 0 only when the mode's conditions hold. Never applies anything.
set -uo pipefail
MANIFEST=""
ISOLATED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --isolated) ISOLATED=1; shift;;
    -*) echo "unknown argument: $1" >&2; exit 2;;
    *) MANIFEST="$1"; shift;;
  esac
done
[ -n "$MANIFEST" ] || { echo "usage: release-check.sh <manifest> [--isolated]" >&2; exit 2; }
cd "$(dirname "$0")/.."
[ -f "$MANIFEST" ] || { echo "manifest not found: $MANIFEST" >&2; exit 2; }
want=$(grep -vE '^\s*(#|$)' "$MANIFEST" | sed -E 's/\.sql\s*$//; s/_.*$//' | sort -u)
[ -n "$want" ] || { echo "manifest is empty" >&2; exit 2; }

tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
if ! npx supabase migration list --linked > "$tmp" 2>&1; then
  echo "supabase migration list failed (is the project linked?)" >&2
  tail -3 "$tmp" >&2
  exit 2
fi

# The CLI emits either a JSON object or a backtick table, depending on
# version and flags. Parse both, and fail loudly rather than reporting an
# empty pending set — a parsing bug must never read as "nothing else is
# pending, go ahead and push".
parsed=$(python - "$tmp" <<'PY'
import json, re, sys

raw = open(sys.argv[1], encoding="utf-8", errors="replace").read()
rows, pending = 0, []

m = re.search(r'\{.*"migrations".*\}\s*$', raw, re.S)
if m:
    try:
        for r in json.loads(m.group(0)).get("migrations", []):
            rows += 1
            if r.get("local") and not r.get("remote"):
                pending.append(r["local"])
    except Exception:
        rows = 0

if rows == 0:
    for line in raw.splitlines():
        t = re.match(r"\s*`([0-9]{14})?\s*`\s*\|\s*`([0-9]{14})?\s*`", line)
        if not t:
            continue
        rows += 1
        if t.group(1) and not t.group(2):
            pending.append(t.group(1))

print(f"ROWS={rows}")
for v in pending:
    print(v)
PY
)
rows=$(printf '%s\n' "$parsed" | sed -n 's/^ROWS=//p')
pending=$(printf '%s\n' "$parsed" | grep -E '^[0-9]{14}$' | sort -u)
if [ -z "${rows:-}" ] || [ "$rows" = "0" ]; then
  echo " FAIL  could not read the migration list (no rows parsed) — refusing to report a pending set" >&2
  tail -5 "$tmp" >&2
  exit 2
fi

fail=0
MODE=$([ $ISOLATED -eq 1 ] && echo "isolated (release-apply.sh)" || echo "strict (plain db push)")
echo "mode: $MODE"
echo "manifest ($(printf '%s\n' "$want" | grep -c .) migrations):"; printf '%s\n' "$want" | sed 's/^/  /'
echo "pending on the linked project ($(printf '%s\n' "$pending" | grep -c . || true) of $rows known):"
if [ -n "$pending" ]; then printf '%s\n' "$pending" | sed 's/^/  /'; else echo "  (none)"; fi

# Both modes: every manifest entry must still be pending.
for v in $want; do
  if ! printf '%s\n' "$pending" | grep -qx "$v"; then
    echo " FAIL  manifest entry $v is not pending — already applied, or the file is missing locally"; fail=1
  fi
done

extra=""
for v in $pending; do
  if ! printf '%s\n' "$want" | grep -qx "$v"; then extra="${extra}${v}\n"; fi
done
extra=$(printf '%b' "$extra" | grep -E '^[0-9]{14}$' | sort -u || true)

if [ $ISOLATED -eq 0 ]; then
  for v in $extra; do
    echo " FAIL  pending migration $v is NOT in this manifest — a db push would apply it with this release"; fail=1
  done
else
  newest=$(printf '%s\n' "$want" | sort | tail -1)
  if [ -n "$extra" ]; then
    echo "other pending migrations (release-apply.sh will not touch them):"
    printf '%s\n' "$extra" | sed 's/^/  /'
  fi
  # the ordering guard: nothing older than this release may still be pending
  older=""
  for v in $extra; do
    if [ "$v" \< "$newest" ]; then older="${older}${v}
"; fi
  done
  older=$(printf '%b' "$older" | grep -E '^[0-9]{14}$' | sort -u || true)
  if [ -n "$older" ]; then
    n=$(printf '%s
' "$older" | grep -c .)
    echo " FAIL  $n pending migration(s) are OLDER than this release's newest file ($newest):"
    printf '%s
' "$older" | sed 's/^/         /'
    echo "       Applying this release would move the newest applied version past them, and the"
    echo "       Supabase CLI then refuses to insert a migration older than the newest applied one."
    echo "       Apply the release that owns $(printf '%s
' "$older" | head -1) first."
    fail=1
  fi
fi

if [ $fail = 0 ]; then
  if [ $ISOLATED -eq 1 ]; then
    echo "RELEASE CHECK: OK — every manifest entry is pending, and no older migration is waiting behind it."
    echo "apply with:  scripts/release-apply.sh $MANIFEST --apply        (this manifest only)"
    if [ -n "$extra" ]; then
      echo "afterwards:  the migrations listed above are still pending and must be released on their own."
    fi
  else
    echo "RELEASE CHECK: OK — the pending set is exactly the manifest."
    echo "apply with:  npx supabase db push        (only these files are pending; never pass --include-all)"
  fi
else
  echo "RELEASE CHECK: FAILED — do not apply."
  if [ $ISOLATED -eq 0 ]; then
    echo "  Either ship the other pending release first, or apply this one on its own:"
    echo "    scripts/release-check.sh $MANIFEST --isolated && scripts/release-apply.sh $MANIFEST --apply"
  fi
  exit 1
fi
