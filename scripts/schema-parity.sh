#!/usr/bin/env bash
# Does a rebuilt database match the deployed schema? (21 Sep 2026)
#
#   scripts/schema-parity.sh <reference-schema.sql> [container] [database]
#
# scripts/db-rebuild.sh proves the repository can BUILD a database. This
# proves the result is the RIGHT one: every table, view, function, trigger and
# enum type in the reference schema is present in the rebuilt database, and
# the rebuilt database has nothing the reference does not (beyond objects the
# reference was taken before).
#
# The reference is a schema-only dump of the deployed project:
#   supabase db dump --linked -f reference-schema.sql      (read-only)
#   or pg_dump --schema-only against any known-good database
#
# The dump is an INPUT to this check, never to the build. db-rebuild.sh reads
# nothing but files in this repository.
set -uo pipefail
REF="${1:?usage: schema-parity.sh <reference-schema.sql> [container] [database]}"
CONTAINER="${2:-supabase_db_arab-ship-broker}"
DB="${3:-postgres}"
[ -f "$REF" ] || { echo "reference schema not found: $REF" >&2; exit 2; }
cd "$(dirname "$0")/.."
TMP="$(mktemp -d -t parity.XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
fail=0
say() { printf '%s\n' "$*"; }

# ── what the reference has ────────────────────────────────────────────────
python - "$REF" > "$TMP/ref.txt" <<'PY'
import re, sys
s = open(sys.argv[1], encoding="utf-8", errors="replace").read()
def out(kind, pat):
    for n in sorted(set(m.group(1).lower() for m in re.finditer(pat, s, re.I))):
        print(f"{kind} {n}")
out("table",    r'CREATE TABLE(?: IF NOT EXISTS)? "public"\."([a-z_0-9]+)"')
out("view",     r'CREATE(?: OR REPLACE)? VIEW "public"\."([a-z_0-9]+)"')
out("function", r'CREATE OR REPLACE FUNCTION "public"\."([a-z_0-9]+)"')
out("trigger",  r'CREATE(?: OR REPLACE)? TRIGGER "([a-z_0-9]+)"')
out("enum",     r'CREATE TYPE "public"\."([a-z_0-9]+)" AS ENUM')
PY

# ── what the rebuilt database has ─────────────────────────────────────────
docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -At -c "
select 'table ' || c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p')
union all
select 'view ' || table_name from information_schema.views where table_schema='public'
union all
select 'function ' || p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
union all
select 'trigger ' || t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
union all
select 'enum ' || t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace
 where n.nspname='public' and t.typtype='e'
order by 1" | tr -d '' | sed '/^$/d' | sort -u > "$TMP/built.txt"
sort -u "$TMP/ref.txt" -o "$TMP/ref.txt"

missing="$(grep -Fxv -f "$TMP/built.txt" "$TMP/ref.txt" || true)"
extra="$(grep -Fxv -f "$TMP/ref.txt" "$TMP/built.txt" || true)"

say "── reference: $(wc -l < "$TMP/ref.txt") objects · rebuilt: $(wc -l < "$TMP/built.txt") objects"
if [ -n "$missing" ]; then
  say " FAIL  in the reference but NOT in the rebuilt database:"
  printf '%s\n' "$missing" | sed 's/^/        /'
  fail=1
else
  say "  ok   every reference object is present in the rebuilt database"
fi
if [ -n "$extra" ]; then
  say "  info in the rebuilt database but not in the reference ($(printf '%s\n' "$extra" | grep -c .)):"
  printf '%s\n' "$extra" | sed 's/^/        /'
  say "       (expected when the reference predates the migrations under review)"
fi

if [ $fail = 0 ]; then say "SCHEMA PARITY: OK"; else say "SCHEMA PARITY: FAILED"; exit 1; fi
