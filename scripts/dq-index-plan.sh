#!/usr/bin/env bash
# The lock-sensitive DDL in the Data Quality release, measured and verified
# (21 Sep 2026).
#
#   scripts/dq-index-plan.sh [--psql "<command>"] [--explain-only]
#
# Migration 20260919170000_dq_h_scaling.sql contains the only statements in
# this release that can hold a busy table. Read plainly:
#
#   four CREATE INDEX on ports and cargo_listings
#       A plain CREATE INDEX takes a SHARE lock: reads continue, every write
#       to that table waits until the index is built. On `ports` that is
#       nothing (hundreds of rows). On `cargo_listings` it is every member
#       posting a cargo, for as long as the build takes.
#
#   ALTER TABLE dq_issues ADD COLUMN search_text … GENERATED … STORED
#       This is the one to respect. A stored generated column REWRITES THE
#       WHOLE TABLE under ACCESS EXCLUSIVE — no reads, no writes, no console,
#       for the duration. dq_issues is the largest table the module owns and
#       grows with every run.
#
#   CREATE INDEX … USING gin (search_text …)
#       A GIN index over the new column, built immediately after the rewrite.
#
# THE SAFE ORDER, and why it works:
#
#   1. Measure. Run this script with --explain-only against production (it
#      only reads: EXPLAIN without ANALYZE executes nothing). If dq_issues is
#      small — say under 100 000 rows — the rewrite is seconds and the
#      migration can simply be applied.
#
#   2. If it is large, pre-create the four ordinary indexes CONCURRENTLY at a
#      quiet moment, BEFORE the release. CREATE INDEX CONCURRENTLY does not
#      block writes, and cannot run inside a transaction — which is exactly
#      why the migration cannot use it. The migration's statements are all
#      `create index if not exists`, so each one it finds already built is a
#      no-op and costs nothing.
#
#   3. The generated column cannot be made concurrent. Either take a short
#      window for it, or apply the release when the console is idle: the
#      rewrite is the only part that stops reads, and nothing outside
#      /admin/data-quality reads dq_issues.
#
#   4. After the release, run this script again without --explain-only to
#      confirm the planner actually USES what was built. An index nobody
#      chooses is a write cost with no read benefit, and the point of the
#      five-trigram-indexes-to-one change was to stop paying it.
#
# Nothing here writes. The CONCURRENTLY statements are PRINTED for the owner
# to run deliberately, not executed.
set -uo pipefail
cd "$(dirname "$0")/.."
PSQL="docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres"
EXPLAIN_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --psql) PSQL="$2"; shift 2;;
    --explain-only) EXPLAIN_ONLY=1; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
say() { printf '%s\n' "$*"; }

say "── 1 · what the lock-sensitive statements will touch"
$PSQL -tA -c "
select rpad(c.relname, 22) || ' rows≈' || lpad(case when c.reltuples < 0 then 'unanalyzed' else c.reltuples::bigint::text end, 12)
       || '  total=' || lpad(pg_size_pretty(pg_total_relation_size(c.oid)), 10)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('dq_issues', 'cargo_listings', 'ports')
 order by pg_total_relation_size(c.oid) desc;" 2>&1 | sed 's/^/  /'
say ""
say "  A stored generated column rewrites dq_issues under ACCESS EXCLUSIVE."
say "  Treat anything above ~100k rows as needing a deliberate window."

say ""
say "── 2 · pre-create these CONCURRENTLY before the release, if the tables are busy"
cat <<'SQL' | sed 's/^/  /'
-- outside any transaction, one at a time; each is safe to repeat
create index concurrently if not exists idx_ports_port_key
  on public.ports (public.fn_port_key(trade_name)) where is_active;
create index concurrently if not exists idx_ports_locode_compact
  on public.ports (lower(replace(locode, ' ', ''))) where is_active;
create index concurrently if not exists idx_ports_locode_upper_compact
  on public.ports (replace(upper(locode), ' ', ''));
create index concurrently if not exists idx_cl_dup_load_key
  on public.cargo_listings (coalesce(load_port_locode, lower(btrim(load_port_name))));
-- check none ended up invalid (a failed CONCURRENTLY build leaves one behind):
select c.relname from pg_index i join pg_class c on c.oid = i.indexrelid where not i.indisvalid;
SQL

say ""
say "── 3 · do the planner's choices match what was built?"
say "  (EXPLAIN without ANALYZE: it plans, it does not execute)"

# The row count decides whether a plan means anything. On a table with a
# handful of rows a sequential scan IS the cheapest plan and the planner is
# right to choose it, so a missing index there is not a finding - it is an
# empty database. Saying WARN anyway would train the reader to ignore WARN.
MIN_ROWS_FOR_A_VERDICT=5000

plan() {  # $1 label  $2 sql  $3 index expected in the plan  $4 table
  local out rows
  out="$($PSQL -tA -c "explain $2" 2>&1)"
  if printf '%s' "$out" | grep -qi "ERROR"; then
    say " skip  $1 - $(printf '%s' "$out" | grep -i ERROR | head -1 | cut -c1-90)"
    return 0
  fi
  rows="$($PSQL -tA -c "select greatest(coalesce((select reltuples from pg_class where oid = 'public.$4'::regclass), 0), 0)::bigint" 2>/dev/null | tr -d ' \r')"
  [ -n "${rows:-}" ] || rows=0
  if printf '%s' "$out" | grep -q "$3"; then
    say "  ok   $1 uses $3  ($rows rows)"
  elif [ "$rows" -lt $MIN_ROWS_FOR_A_VERDICT ]; then
    say "  n/a  $1 - $4 holds $rows row(s); a sequential scan is the correct plan at that size."
    say "       This says nothing about $3 either way. Run it against production to learn anything."
  else
    say " WARN  $1 does NOT use $3 on $rows rows - the index is being paid for and not used:"
    printf '%s\n' "$out" | head -4 | sed 's/^/         /'
  fi
}

plan "port name lookup"        "select 1 from public.ports where public.fn_port_key(trade_name) = 'x' and is_active" "idx_ports_port_key" "ports"
plan "locode lookup"           "select 1 from public.ports where lower(replace(locode, ' ', '')) = 'x' and is_active" "idx_ports_locode_compact" "ports"
plan "duplicate-listing check" "select 1 from public.cargo_listings where coalesce(load_port_locode, lower(btrim(load_port_name))) = 'x'" "idx_cl_dup_load_key" "cargo_listings"
plan "issue search"            "select 1 from public.dq_issues where search_text ilike '%acme%'" "idx_trgm_dq_issues_search" "dq_issues"

say ""
say "── 4 · the five indexes the release removes"
$PSQL -tA -c "
select case when count(*) = 0 then '  ok   all five per-column trigram indexes are gone'
            else '  note ' || count(*) || ' still present: ' || string_agg(indexname, ', ') end
  from pg_indexes
 where schemaname = 'public'
   and indexname in ('idx_trgm_dq_issues_row_label','idx_trgm_dq_issues_row_key','idx_trgm_dq_issues_rule_code','idx_trgm_dq_issues_field','idx_trgm_dq_issues_observed');" 2>&1 | grep -v '^$'

if [ $EXPLAIN_ONLY -eq 1 ]; then
  say ""
  say "(--explain-only: nothing was built or changed.)"
fi
