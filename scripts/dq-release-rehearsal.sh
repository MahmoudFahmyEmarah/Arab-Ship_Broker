#!/usr/bin/env bash
# The Data Quality release, rehearsed on a disposable database — including
# being interrupted (21 Sep 2026).
#
#   scripts/dq-release-rehearsal.sh [--stops "1 2 3 …"] [--quick]
#
# `supabase db push` applies every pending migration, so this release ships
# through scripts/release-apply.sh, which applies one manifest and nothing
# else. That mechanism is only trustworthy if it behaves when it is
# INTERRUPTED — a dropped connection, a deploy cancelled, a laptop closed
# between two files. The question this answers is not "does the release
# apply" but "if it stops after migration k, can the database be returned to
# exactly where it started, for every k?"
#
# For each stop k:
#   1. rebuild the database to the state before the release (repo artifacts
#      only — no production dump)
#   2. fingerprint it
#   3. apply migrations 1…k, recording each version the way release-apply does
#   4. check the migration history holds exactly those k versions — an applied
#      migration that is not recorded is invisible to the CLI, which would try
#      to apply it again over a schema that already has it
#   5. roll back with the DOWN files for 1…k, newest first
#   6. fingerprint again and compare: the schema must be back where it was,
#      apart from the backup tables the DOWNs deliberately keep
#   7. remove the k versions from the history, and check the CLI would now see
#      the release as pending again — a rollback that leaves the history
#      claiming the release is applied is not a rollback
#
# --quick rehearses the first, middle and last stop only.
# --fresh rebuilds the database before EVERY stop. The default rebuilds once
#         and then reuses it: each stop ends by proving the schema is back at
#         the baseline, so the next stop may start from there once the
#         deliberate *_bak_<version> residue is cleared. Faster, and it also
#         shows the release survives being applied and rolled back repeatedly
#         against one database.
set -uo pipefail
cd "$(dirname "$0")/.."

CONTAINER=supabase_db_arab-ship-broker
PSQL="docker exec -i $CONTAINER psql -U postgres -d postgres -q -v ON_ERROR_STOP=1"
MANIFEST=supabase/releases/dq-20260919.txt
FIRST=20260919100000

mapfile -t FILES < <(grep -vE '^\s*(#|$)' "$MANIFEST" | sort)
N=${#FILES[@]}

# the DOWN file that reverses each migration, by version
down_for() {
  case "$1" in
    20260919100000) echo supabase/rollback/20260919_dq_a_down.sql;;
    20260919110000) echo supabase/rollback/20260919_dq_d_down.sql;;
    20260919120000) echo supabase/rollback/20260919_dq_b_down.sql;;
    20260919130000) echo supabase/rollback/20260919_dq_c_down.sql;;
    20260919140000) echo supabase/rollback/20260919_dq_e_down.sql;;
    20260919150000) echo supabase/rollback/20260919_dq_f_down.sql;;
    20260919160000) echo supabase/rollback/20260919_dq_g_down.sql;;
    20260919170000) echo supabase/rollback/20260919_dq_h_down.sql;;
    20260919180000) echo supabase/rollback/20260919_dq_i_down.sql;;
    *) echo "";;
  esac
}

STOPS=""
QUICK=0
FRESH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --stops) STOPS="$2"; shift 2;;
    --quick) QUICK=1; shift;;
    --fresh) FRESH=1; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
if [ -z "$STOPS" ]; then
  if [ $QUICK -eq 1 ]; then STOPS="1 $(( (N + 1) / 2 )) $N"; else STOPS="$(seq 1 $N | tr '\n' ' ')"; fi
fi

say() { printf '%s\n' "$*"; }
fail=0

# The same catalogue the migration harness compares, taken directly. It is
# restated here rather than shelled out to, because this script has to take
# the fingerprint at points the harness has no concept of — after migration k
# of n, and again after rolling k back.
fingerprint() {   # $1 output file
  $PSQL -tA -f - > "$1" 2>&1 <<'SQL'
select 'table ' || c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
union all
select 'column ' || table_name || '.' || column_name || ' ' || data_type || ' null=' || is_nullable || ' default=' || coalesce(column_default, '')
  from information_schema.columns where table_schema = 'public'
union all
select 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || md5(coalesce(p.prosrc, '')) || ' vol=' || p.provolatile::text || ' definer=' || p.prosecdef::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
union all
select 'index ' || indexname || ' ' || indexdef from pg_indexes where schemaname = 'public'
union all
select 'policy ' || tablename || '.' || policyname || ' ' || cmd from pg_policies where schemaname = 'public'
union all
select 'trigger ' || c.relname || '.' || t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal
union all
select 'constraint ' || con.conrelid::regclass::text || '.' || con.conname || ' ' || pg_get_constraintdef(con.oid)
  from pg_constraint con join pg_namespace n on n.oid = con.connamespace where n.nspname = 'public'
union all
select 'sequence ' || sequencename from pg_sequences where schemaname = 'public'
order by 1;
SQL
}

# The backup tables the DOWN files deliberately keep. They are the only
# difference the fingerprint tolerates, and they have to go before the next
# stop or the renames collide.
clear_residue() {
  $PSQL -tA -c "
    do \$\$
    declare r record;
    begin
      for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'r'
                  and (c.relname like '%\\_bak\\_2026%' or c.relname = 'dq_issues_dedup_backup')
      loop execute format('drop table if exists public.%I cascade', r.relname); end loop;
    end \$\$;" > /dev/null 2>&1
}

rebuilt=0
prepare_database() {
  if [ $FRESH -eq 1 ] || [ $rebuilt -eq 0 ]; then
    if ! bash scripts/db-rebuild.sh --before "$FIRST" > /tmp/reh-rebuild.log 2>&1; then
      say " FAIL  rebuild failed"; tail -6 /tmp/reh-rebuild.log; return 1
    fi
    rebuilt=1
    return 0
  fi
  # reuse: clear the deliberate residue and confirm we really are at the
  # baseline before applying anything on top of it
  clear_residue
  fingerprint /tmp/reh-reuse.txt
  if [ "$(grep -c . /tmp/reh-reuse.txt)" -lt 2000 ]; then
    say " FAIL  could not fingerprint the reused database"; return 1
  fi
  if ! diff -q /tmp/reh-base.txt /tmp/reh-reuse.txt > /dev/null; then
    say " FAIL  the reused database is not at the baseline before this stop:"
    diff /tmp/reh-base.txt /tmp/reh-reuse.txt | head -6 | sed 's/^/        /'
    return 1
  fi
  return 0
}

say "── Data Quality release rehearsal · $N migrations · stops: $STOPS"
[ $FRESH -eq 1 ] && say "   (rebuilding before every stop)" || say "   (one rebuild, then reused — each stop proves it returned to the baseline)"

for k in $STOPS; do
  say ""
  say "════ interrupted after migration $k of $N"
  if ! prepare_database; then fail=1; continue; fi
  # the baseline fingerprint is taken once and kept: every stop is measured
  # against the same reference, not against whatever the last one left
  [ -s /tmp/reh-base.txt ] || fingerprint /tmp/reh-base.txt
  base_lines=$(grep -c . /tmp/reh-base.txt)
  # A fingerprint that failed to run is a FEW lines of error text, and
  # comparing it with another failure reads as "identical". That is how a
  # rehearsal reports success while proving nothing — it happened here on the
  # first run (21 Sep 2026), an ambiguous `oid` in the constraint clause. The
  # floor is the guard: this schema has thousands of catalogue lines.
  if [ "$base_lines" -lt 2000 ]; then
    say " FAIL  the baseline fingerprint is only $base_lines line(s) — it did not run:"
    head -3 /tmp/reh-base.txt | sed 's/^/        /'
    fail=1; continue
  fi
  say "  baseline: $base_lines catalog lines"

  # ── apply 1…k, recording each ──────────────────────────────────────────
  applied=()
  stopped=0
  for ((i = 0; i < k; i++)); do
    f="${FILES[$i]}"; v="${f%%_*}"
    if ! $PSQL -1 -f - < "supabase/migrations/$f" > /tmp/reh-apply.log 2>&1; then
      say " FAIL  $f did not apply"; grep -E "ERROR" /tmp/reh-apply.log | head -3; fail=1; stopped=1; break
    fi
    $PSQL -c "insert into supabase_migrations.schema_migrations (version, name) values ('$v', '${f%.sql}') on conflict (version) do nothing;" > /dev/null 2>&1
    # the recording is not optional: read it back, as release-apply does
    if ! $PSQL -tAc "select 1 from supabase_migrations.schema_migrations where version = '$v'" 2>/dev/null | grep -q 1; then
      say " FAIL  $v applied but was NOT recorded — the next push would apply it again"; fail=1; stopped=1; break
    fi
    applied+=("$v")
  done
  [ $stopped -eq 1 ] && continue
  say "  applied and recorded: ${#applied[@]}"

  n_hist=$($PSQL -tAc "select count(*) from supabase_migrations.schema_migrations where version >= '$FIRST'" 2>/dev/null | tr -d ' \r')
  if [ "$n_hist" != "$k" ]; then
    say " FAIL  the history holds $n_hist release version(s), expected $k"; fail=1; continue
  fi

  # ── roll back 1…k, newest first ────────────────────────────────────────
  rb_failed=0
  for ((i = k - 1; i >= 0; i--)); do
    f="${FILES[$i]}"; v="${f%%_*}"
    d="$(down_for "$v")"
    if [ -z "$d" ] || [ ! -f "$d" ]; then say " FAIL  no DOWN file for $v"; fail=1; rb_failed=1; break; fi
    if ! $PSQL -1 -f - < "$d" > /tmp/reh-down.log 2>&1; then
      say " FAIL  $(basename "$d") did not apply"; grep -E "ERROR" /tmp/reh-down.log | head -3; fail=1; rb_failed=1; break
    fi
    $PSQL -c "delete from supabase_migrations.schema_migrations where version = '$v';" > /dev/null 2>&1
  done
  [ $rb_failed -eq 1 ] && continue

  # ── the schema is back where it started ────────────────────────────────
  fingerprint /tmp/reh-after.txt
  after_lines=$(grep -c . /tmp/reh-after.txt)
  if [ "$after_lines" -lt 2000 ]; then
    say " FAIL  the post-rollback fingerprint is only $after_lines line(s) — it did not run"
    head -3 /tmp/reh-after.txt | sed 's/^/        /'
    fail=1; continue
  fi
  diff_out=$(diff /tmp/reh-base.txt /tmp/reh-after.txt | grep -vE 'dq_issues_dedup_backup|_bak_20260919' | grep -E '^[<>]' || true)
  if [ -n "$diff_out" ]; then
    say " FAIL  the schema did not return to the baseline after rolling back $k migration(s):"
    printf '%s\n' "$diff_out" | head -8 | sed 's/^/        /'
    fail=1
  else
    residue=$(diff /tmp/reh-base.txt /tmp/reh-after.txt | grep -cE 'dq_issues_dedup_backup|_bak_20260919' || true)
    say "  ok   schema back at the baseline (deliberate backup residue: $residue line(s))"
  fi

  # ── and the history says the release is pending again ──────────────────
  n_hist=$($PSQL -tAc "select count(*) from supabase_migrations.schema_migrations where version >= '$FIRST'" 2>/dev/null | tr -d ' \r')
  if [ "$n_hist" != "0" ]; then
    say " FAIL  after rollback the history still claims $n_hist release version(s) are applied"; fail=1
  else
    say "  ok   history clear: the CLI would report the release as pending again"
  fi
done

say ""
if [ $fail = 0 ]; then
  say "RELEASE REHEARSAL: OK — every interruption point recovers to the baseline, schema and history alike"
else
  say "RELEASE REHEARSAL: FAILED"; exit 1
fi
