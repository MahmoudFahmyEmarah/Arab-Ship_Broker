#!/usr/bin/env bash
# Migration harness (20 Sep 2026; linked mode and fingerprint corrected 21 Sep)
# — replaces the retired scripts/sql-dryrun.sh.
#
#   scripts/migration-harness.sh --chain <file>... --smokes <file>... --downs <file>... [--target local|linked] [--allow-residue <regex>]
#
# Steps, in order, all mandatory unless a group is empty:
#   1. fingerprint the baseline schema
#   2. apply the forward chain (each file its own transaction, ON_ERROR_STOP)
#   3. run every smoke suite; each MUST reach its "ALL ASSERTIONS PASSED"
#      marker, and each suite is verified BY NAME (not by a count)
#   4. apply every DOWN file in the order given (pass them newest first)
#   5. fingerprint again; the two must be identical apart from --allow-residue
#      lines (backup tables a DOWN deliberately leaves behind)
#
# The fingerprint covers: tables and their owners, columns with data type,
# nullability, defaults and generated expressions; functions with body
# checksum, owner, volatility, security and search_path; indexes; policies;
# triggers; constraints; enum types with their labels; installed extensions;
# function and table grants.
#
# Fails on: any SQL error, a warning matching the fatal list, a smoke suite
# that did not reach its marker, a non-zero exit of psql / the CLI, or a
# fingerprint difference. Exit codes are preserved and temporary files are
# removed by a trap.
#
# Targets:
#   local   docker exec psql into the local Supabase container (default);
#           set HARNESS_PSQL to use another psql command
#   linked  the linked project through `supabase db query`, as ONE
#           transaction that is conclusively rolled back (forward + smokes +
#           downs + fingerprint comparison all inside it; nothing persists).
#
#           The result has to escape a transaction that is thrown away, so the
#           final DO block RAISES it: an exception is the only channel whose
#           message survives a rollback. `supabase db query` therefore exits
#           NON-ZERO on a successful run. That is expected, and the command
#           substitution below must not be allowed to trip `set -e` — hence
#           `rc=0; res="$(…)" || rc=$?`. Before 21 Sep 2026 it read
#           `res="$(…)" ; rc=$?`, which aborted the script at that line under
#           `set -e` and printed neither a result nor a failure.
set -euo pipefail

TARGET=local; CHAIN=(); SMOKES=(); DOWNS=(); ALLOW='^$'
FATAL_WARNINGS='there is already a transaction in progress|no transaction is in progress|skipping|is deprecated'
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2;;
    --allow-residue) ALLOW="$2"; shift 2;;
    --chain) shift; while [ $# -gt 0 ] && [[ "$1" != --* ]]; do CHAIN+=("$1"); shift; done;;
    --smokes) shift; while [ $# -gt 0 ] && [[ "$1" != --* ]]; do SMOKES+=("$1"); shift; done;;
    --downs) shift; while [ $# -gt 0 ] && [[ "$1" != --* ]]; do DOWNS+=("$1"); shift; done;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
[ ${#CHAIN[@]} -gt 0 ] || { echo "--chain is required" >&2; exit 2; }

TMP="$(mktemp -d -t harness.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
fail=0
say() { printf '%s\n' "$*"; }
failed() { say " FAIL  $*"; fail=1; }

# One column named fp; the first branch's alias names the whole union.
FINGERPRINT_SQL=$(cat <<'SQL'
select 'table ' || c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity::text as fp
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
union all
select 'column ' || c.table_name || '.' || c.column_name || ' ' || c.data_type || ' null=' || c.is_nullable
       || ' default=' || coalesce(c.column_default, '') || ' gen=' || c.is_generated || ' genexpr=' || coalesce(c.generation_expression, '')
  from information_schema.columns c where c.table_schema = 'public'
union all
select 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || md5(pg_get_functiondef(p.oid))
       || ' owner=' || pg_get_userbyid(p.proowner) || ' vol=' || p.provolatile::text || ' definer=' || p.prosecdef::text
       || ' cfg=' || coalesce(array_to_string(p.proconfig, ','), '')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
union all
select 'index ' || indexname || ' ' || md5(indexdef) from pg_indexes where schemaname = 'public'
union all
select 'policy ' || tablename || '.' || policyname || ' ' || md5(coalesce(qual, '') || '|' || coalesce(with_check, '') || '|' || cmd || '|' || array_to_string(roles, ','))
  from pg_policies where schemaname = 'public'
union all
select 'trigger ' || c.relname || '.' || t.tgname || ' ' || md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal
union all
select 'constraint ' || conrelid::regclass::text || '.' || conname || ' ' || md5(pg_get_constraintdef(oid)) from pg_constraint where connamespace = 'public'::regnamespace
union all
select 'enum ' || t.typname || ' ' || md5(string_agg(e.enumlabel, ',' order by e.enumsortorder))
  from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
 where n.nspname = 'public' group by t.typname
union all
select 'extension ' || extname || ' ' || extversion from pg_extension
union all
select 'sequence ' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'S'
union all
select 'grant ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || r.rolname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace, pg_roles r
 where n.nspname = 'public' and r.rolname in ('anon', 'authenticated', 'service_role', 'dq_evaluator') and has_function_privilege(r.oid, p.oid, 'execute')
union all
select 'tablegrant ' || table_name || ' ' || grantee || ' ' || privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role', 'dq_evaluator')
order by 1
SQL
)

if [ "$TARGET" = local ]; then
  PSQL="${HARNESS_PSQL:-docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres}"
  run_file() { # $1 file $2 label — one transaction; output AND exit code both inspected
    local out; local rc=0
    out=$($PSQL -v ON_ERROR_STOP=1 -q -1 -f - < "$1" 2>&1) || rc=$?
    if [ $rc -ne 0 ]; then failed "$2: psql exited $rc — $(echo "$out" | grep -E "ERROR|FATAL" | head -2 | tr '\n' ' ')"; echo "$out" | tail -5; return 1; fi
    if echo "$out" | grep -qE "ERROR|FATAL"; then failed "$2: $(echo "$out" | grep -E "ERROR|FATAL" | head -2 | tr '\n' ' ')"; return 1; fi
    if echo "$out" | grep -E "WARNING" | grep -Eq "$FATAL_WARNINGS"; then failed "$2: fatal warning: $(echo "$out" | grep -E "WARNING" | grep -E "$FATAL_WARNINGS" | head -1)"; return 1; fi
    say "  ok   $2"; return 0
  }
  smoke_file() { # a smoke file carries its own BEGIN/ROLLBACK and must print the marker
    local out; local rc=0
    out=$($PSQL -v ON_ERROR_STOP=1 -q -f - < "$1" 2>&1) || rc=$?
    if [ $rc -ne 0 ]; then failed "$(basename "$1"): psql exited $rc — $(echo "$out" | grep -E "ERROR|FATAL" | head -2 | tr '\n' ' ')"; return 1; fi
    if echo "$out" | grep -qE "ERROR|FATAL"; then failed "$(basename "$1"): $(echo "$out" | grep -E "ERROR|FATAL" | head -2 | tr '\n' ' ')"; return 1; fi
    if ! echo "$out" | grep -q "ALL ASSERTIONS PASSED"; then failed "$(basename "$1"): no 'ALL ASSERTIONS PASSED' marker (the suite did not run to its end)"; return 1; fi
    say "  ok   $(basename "$1")"; return 0
  }
  fingerprint() { $PSQL -At -v ON_ERROR_STOP=1 -c "$FINGERPRINT_SQL"; }

  say "── 1 · baseline fingerprint"; fingerprint > "$TMP/before.txt"; say "  ok   $(wc -l < "$TMP/before.txt") catalog lines"
  say "── 2 · forward chain"; for f in "${CHAIN[@]}"; do run_file "$f" "$(basename "$f")" || true; done
  [ $fail = 0 ] || { say "FORWARD CHAIN FAILED"; exit 1; }
  say "── 3 · smoke suites"; for s in "${SMOKES[@]:-}"; do [ -n "$s" ] && { smoke_file "$s" || true; }; done
  if [ ${#DOWNS[@]} -gt 0 ]; then
    say "── 4 · DOWN chain (as given)"; for d in "${DOWNS[@]}"; do run_file "$d" "$(basename "$d")" || true; done
    say "── 5 · fingerprint after DOWN"; fingerprint > "$TMP/after.txt"
    if diff <(grep -Ev "$ALLOW" "$TMP/before.txt") <(grep -Ev "$ALLOW" "$TMP/after.txt") > "$TMP/diff.txt"; then
      say "  ok   tables, columns, defaults, generated expressions, function bodies and owners, indexes, policies, triggers, constraints, enums, extensions and grants are back at the baseline"
    else
      failed "schema differs from the baseline after the DOWN chain:"; head -40 "$TMP/diff.txt"
    fi
    if [ "$ALLOW" != '^$' ]; then say "  info residue allowed by --allow-residue: $(grep -cE "$ALLOW" "$TMP/after.txt") line(s)"; fi
  fi
else
  # ── linked: ONE transaction, conclusively rolled back ─────────────────────
  # Each smoke file loses its own BEGIN/ROLLBACK (they would end the harness
  # transaction) and its final marker notice becomes a row naming the SUITE
  # FILE, so every suite is verified individually rather than by a count.
  out="$TMP/linked.sql"
  expected=""
  {
    echo "begin;"
    echo "create temp table harness_before as $FINGERPRINT_SQL;"
    for f in "${CHAIN[@]}"; do echo "-- ── chain: $(basename "$f")"; cat "$f"; echo; done
    echo "create temp table harness_markers (name text);"
    for s in "${SMOKES[@]:-}"; do
      [ -n "$s" ] || continue
      b="$(basename "$s")"
      expected="$expected$b
"
      echo "-- ── suite: $b"
      sed -E "s/raise notice '[^']*ALL ASSERTIONS PASSED';/insert into harness_markers values ('$b');/" "$s" \
        | grep -viE '^[[:space:]]*(begin|rollback|commit)[[:space:]]*;[[:space:]]*$'
      echo
    done
    for d in "${DOWNS[@]:-}"; do [ -n "$d" ] && { echo "-- ── down: $(basename "$d")"; cat "$d"; echo; }; done
    echo "create temp table harness_after as $FINGERPRINT_SQL;"
    # the expected suite names, so a missing one is named rather than counted
    echo "create temp table harness_expected (name text);"
    printf '%s' "$expected" | while IFS= read -r b; do [ -n "$b" ] && echo "insert into harness_expected values ('$b');"; done
    cat <<SQL
do \$h\$
declare v_missing text; v_diff int; v_sample text;
begin
  select string_agg(e.name, ', ' order by e.name) into v_missing
    from harness_expected e where not exists (select 1 from harness_markers m where m.name = e.name);
  select count(*) into v_diff from (
    (select fp from harness_before except select fp from harness_after) union all
    (select fp from harness_after except select fp from harness_before)) d
   where fp !~ '$ALLOW';
  select string_agg(fp, ' ;; ') into v_sample from (
    select fp from (
      (select fp from harness_before except select fp from harness_after) union all
      (select fp from harness_after except select fp from harness_before)) d
     where fp !~ '$ALLOW' limit 5) s;
  raise exception 'HARNESS RESULT suites_ok=% missing_suites=[%] fingerprint_diff_lines=% sample=[%]',
    (select count(*) from harness_markers), coalesce(v_missing, ''), v_diff, coalesce(v_sample, '');
end \$h\$;
SQL
    echo "rollback;"
  } > "$out"

  # The DO block above raises on purpose, so the CLI exits non-zero on a
  # SUCCESSFUL dry run. Capture the status without letting `set -e` abort.
  rc=0
  res="$(supabase db query --linked --file "$out" 2>&1)" || rc=$?
  res="$(printf '%s' "$res" | grep -viE 'new version|recommend updating|Initialising|Connecting to remote')"
  printf '%s\n' "$res" > "$TMP/linked.out"
  if printf '%s' "$res" | grep -q "HARNESS RESULT"; then
    line="$(printf '%s' "$res" | grep -o 'HARNESS RESULT[^"]*' | head -1 | sed 's/\\n.*//')"
    say "  $line"
    missing="$(printf '%s' "$line" | sed -E 's/.*missing_suites=\[([^]]*)\].*/\1/')"
    dl="$(printf '%s' "$line" | sed -E 's/.*fingerprint_diff_lines=([0-9]+).*/\1/')"
    [ -z "$missing" ] || failed "smoke suite(s) that did not reach their marker: $missing"
    if [ ${#DOWNS[@]} -gt 0 ]; then [ "$dl" = 0 ] || failed "$dl fingerprint line(s) differ after the DOWN chain"; fi
    say "  ok   the transaction ended in ROLLBACK — nothing was applied to the linked project"
  else
    # No result marker means the transaction aborted on a real SQL error
    # before the final block, or the CLI itself failed.
    failed "linked dry run did not reach the result marker (CLI exit $rc). First errors:"
    printf '%s' "$res" | grep -iE 'error|fatal|unexpected' | head -5 | cut -c1-300 | sed 's/^/        /'
  fi
fi

if [ $fail = 0 ]; then say "HARNESS: OK (${#CHAIN[@]} migrations, ${#SMOKES[@]} suites, ${#DOWNS[@]} downs, target $TARGET)"; else say "HARNESS: FAILED"; exit 1; fi
