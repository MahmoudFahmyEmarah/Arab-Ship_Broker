#!/usr/bin/env bash
# The migration-list parsers (scripts/release-check.sh, scripts/migration-applied.py) read every shape the CLI prints
# (3 Nov 2026: a trailing "update available" notice after the JSON stopped Wave 11 at release-check).
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail=0; ok(){ if eval "$2"; then echo "  ok   $1"; else echo "  FAIL $1"; fail=1; fi; }

printf 'Initialising login role...\n{"migrations":[{"local":"20261029100000","remote":"20261029100000","time":"x"},{"local":"20261103100000","remote":"","time":"y"}],"message":"Migrations listed"}\nA new version of Supabase CLI is available: v3.0.0 (currently installed v2.122.0)\nWe recommend updating regularly\n' > "$T/json-notice"
printf 'Connecting to remote database...\n\n   Local          | Remote         | Time (UTC)\n  ----------------|----------------|---------------------\n   20261029100000 | 20261029100000 | 2026-10-29 10:00:00\n   20261103100000 |                | 2026-11-03 10:00:00\n\nA new version of Supabase CLI is available\n' > "$T/plain"
printf '   `Local`          | `Remote`         | `Time`\n   `20261029100000` | `20261029100000` | `2026-10-29`\n   `20261103100000` | `              ` | `2026-11-03`\n' > "$T/backtick"
printf 'Initialising login role...\nsomething went wrong\n' > "$T/garbage"

for shape in json-notice plain backtick; do
  python scripts/migration-applied.py 20261029100000 < "$T/$shape" && r=0 || r=$?
  ok "$shape: 20261029100000 reads as applied" '[ $r = 0 ]'
  python scripts/migration-applied.py 20261103100000 < "$T/$shape" && r=0 || r=$?
  ok "$shape: 20261103100000 reads as NOT applied" '[ $r = 1 ]'
done
python scripts/migration-applied.py 20261029100000 < "$T/garbage" 2>/dev/null && r=0 || r=$?
ok "unparseable output is 'could not read' (2), never applied/not applied" '[ $r = 2 ]'

# release-check's embedded parser, extracted verbatim and run on the same shapes
sed -n "/^parsed=\$(python - \"\$tmp\" <<'PY'$/,/^PY$/p" scripts/release-check.sh | sed '1d;$d' > "$T/rc.py"
ok "release-check parser extracted" '[ -s "$T/rc.py" ]'
for shape in json-notice plain backtick; do
  out=$(python "$T/rc.py" "$T/$shape")
  ok "$shape: release-check reads 2 rows" '[ "$(printf "%s\n" "$out" | sed -n "s/^ROWS=//p")" = 2 ]'
  ok "$shape: release-check's pending set is exactly 20261103100000" '[ "$(printf "%s\n" "$out" | grep -E "^[0-9]{14}$")" = 20261103100000 ]'
done
out=$(python "$T/rc.py" "$T/garbage")
ok "unparseable output gives ROWS=0 (release-check then refuses)" '[ "$(printf "%s\n" "$out" | sed -n "s/^ROWS=//p")" = 0 ]'
[ $fail = 0 ] && echo "MIGRATION LIST PARSERS: ALL ASSERTIONS PASSED" || { echo "MIGRATION LIST PARSERS: FAILED"; exit 1; }
