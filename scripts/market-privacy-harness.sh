#!/usr/bin/env bash
# Market/TBN privacy firewall - forward/smoke/DOWN/fingerprint wrapper.
#
#   scripts/market-privacy-harness.sh [--target local|linked]
#       [--no-down] [--reapply] [--from-applied] [--performance]
#
# The local mode refuses to fingerprint an already-applied module. Use
# --from-applied to run the two DOWN files first, or point HARNESS_PSQL at an
# isolated database. The generic migration harness fingerprints public; this
# wrapper additionally proves that the private handle schema leaves no objects
# after DOWN.
set -uo pipefail

cd "$(dirname "$0")/.."

TARGET=local
DOWN=1
REAPPLY=0
FROM_APPLIED=0
PERFORMANCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --no-down) DOWN=0; shift ;;
    --reapply) REAPPLY=1; shift ;;
    --from-applied) FROM_APPLIED=1; shift ;;
    --performance) PERFORMANCE=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ "$TARGET" != local ] && [ "$FROM_APPLIED" = 1 ]; then
  echo "--from-applied is local-only" >&2
  exit 2
fi
if [ "$TARGET" != local ] && [ "$REAPPLY" = 1 ]; then
  echo "--reapply is local-only" >&2
  exit 2
fi

M=supabase/migrations
R=supabase/rollback
T=supabase/tests/market_privacy/market_tbn_privacy.sql
P=supabase/tests/market_privacy/market_performance_200x200.sql
RACES=(
  supabase/tests/market_privacy/market_handle_two_sessions.sh
  supabase/tests/market_privacy/market_vessel_rpc_two_sessions.sh
)
CHAIN=(
  "$M/20260923360000_market_candidate_handles.sql"
  "$M/20260923361000_market_tbn_firewall.sql"
  "$M/20260923362000_market_review_status_firewall.sql"
)
DOWNS=(
  "$R/20260923362000_market_review_status_firewall_down.sql"
  "$R/20260923361000_market_tbn_firewall_down.sql"
  "$R/20260923360000_market_candidate_handles_down.sql"
)

for f in "${CHAIN[@]}" "$T" "$P" "${RACES[@]}"; do
  [ -f "$f" ] || { echo "missing required file: $f" >&2; exit 2; }
done
if [ "$DOWN" = 1 ]; then
  for f in "${DOWNS[@]}"; do
    [ -f "$f" ] || { echo "missing required DOWN: $f" >&2; exit 2; }
  done
fi

if [ "$PERFORMANCE" = 1 ] && { [ "$TARGET" != local ] \
   || { [ "$DOWN" = 1 ] && [ "$REAPPLY" = 0 ]; }; }; then
  echo "--performance requires a local target with the module left applied" >&2
  echo "Use --no-down or --reapply and an empty disposable *market_perf* database." >&2
  exit 2
fi

PSQL="${HARNESS_PSQL:-docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres}"
apply_file() {
  local f="$1"
  $PSQL -v ON_ERROR_STOP=1 -q -1 -f - < "$f"
}

# The generic lifecycle fingerprint intentionally stays release-agnostic. This
# module also changes explicit column ACLs and deployment-specific legacy
# view/routine ACLs, including grant options, and temporarily stores their
# snapshots in market_private. Pin those catalog dimensions here so DOWN cannot
# look clean merely because the effective table-level privilege is equivalent.
MARKET_TMP="$(mktemp -d -t market-privacy-harness.XXXXXX)"
trap 'rm -rf "$MARKET_TMP"' EXIT
MARKET_FINGERPRINT_SQL=$(cat <<'SQL'
select 'view-acl ' || format('%I.%I', n.nspname, c.relname)
       || ' grantor=' || coalesce(grantor_role.rolname, 'PUBLIC')
       || ' grantee=' || coalesce(grantee_role.rolname, 'PUBLIC')
       || ' privilege=' || acl.privilege_type
       || ' grantable=' || acl.is_grantable::text as fp
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 cross join lateral pg_catalog.aclexplode(
   coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
 ) acl
  left join pg_catalog.pg_roles grantor_role on grantor_role.oid = acl.grantor
  left join pg_catalog.pg_roles grantee_role on grantee_role.oid = acl.grantee
 where n.nspname = 'public'
   and c.relname = any (array[
     'cargo_listings', 'vessel_availability', 'listing_ownership',
     'vessels', 'vessel_claims', 'vessel_contact_history', 'matches',
     'v_live_cargo', 'v_live_vessels',
     'v_cargo_match_counts', 'v_vessel_match_counts',
     'v_vessel_detail', 'v_vessel_flag_issues',
     'v_admin_queue', 'v_eligible_matches',
     'review_queue', 'v_admin_queue_detail'
   ])
union all
select 'column-acl ' || format('%I.%I.%I', n.nspname, c.relname, a.attname)
       || ' grantor=' || coalesce(grantor_role.rolname, 'PUBLIC')
       || ' grantee=' || coalesce(grantee_role.rolname, 'PUBLIC')
       || ' privilege=' || acl.privilege_type
       || ' grantable=' || acl.is_grantable::text
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 cross join lateral pg_catalog.aclexplode(a.attacl) acl
  left join pg_catalog.pg_roles grantor_role on grantor_role.oid = acl.grantor
  left join pg_catalog.pg_roles grantee_role on grantee_role.oid = acl.grantee
 where n.nspname = 'public'
   and a.attnum > 0
   and not a.attisdropped
   and a.attacl is not null
union all
select 'routine-acl ' || format(
         '%I.%I(%s)', n.nspname, p.proname,
         pg_catalog.oidvectortypes(p.proargtypes)
       )
       || ' grantor=' || coalesce(grantor_role.rolname, 'PUBLIC')
       || ' grantee=' || coalesce(grantee_role.rolname, 'PUBLIC')
       || ' privilege=' || acl.privilege_type
       || ' grantable=' || acl.is_grantable::text
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 cross join lateral pg_catalog.aclexplode(
   coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
 ) acl
  left join pg_catalog.pg_roles grantor_role on grantor_role.oid = acl.grantor
  left join pg_catalog.pg_roles grantee_role on grantee_role.oid = acl.grantee
 where n.nspname = 'public'
   and format(
         '%I.%I(%s)', n.nspname, p.proname,
         pg_catalog.oidvectortypes(p.proargtypes)
       ) = any (array[
         'public.fn_owns_cargo(uuid)',
         'public.fn_owns_vessel(uuid)',
         'public.fn_position_checkin(uuid, text, date, time without time zone, date)',
         'public.fn_vessel_contact_history_insert()',
         'public.get_matches_for_cargo(uuid)',
         'public.get_matches_for_availability(uuid)',
          'public.get_listing_posters(text, uuid[])',
          'public.count_live_matches(text, uuid[])',
          'public.create_vessel_availability(jsonb)',
          'public.create_vessel_position(jsonb)',
          'public.fn_refresh_matches()',
         'public.fn_refresh_matches_for_cargo(uuid)',
         'public.fn_refresh_matches_for_availability(uuid)',
         'public.list_my_review_statuses(integer)'
       ])
union all
select 'schema-comment ' || n.nspname || '='
       || coalesce(pg_catalog.obj_description(n.oid, 'pg_namespace'), '<NULL>')
  from pg_catalog.pg_namespace n
 where n.nspname in ('public', 'market_private')
union all
select 'relation-options ' || format('%I.%I', n.nspname, c.relname)
       || '=' || coalesce(array_to_string(c.reloptions, ','), '<NULL>')
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname = any (array[
     'v_live_cargo', 'v_live_vessels', 'v_cargo_match_counts',
     'v_vessel_match_counts', 'v_vessel_detail', 'v_vessel_flag_issues',
     'v_admin_queue', 'v_eligible_matches', 'v_admin_queue_detail'
   ])
union all
select 'view-definition ' || format('%I.%I', n.nspname, c.relname)
       || '=' || md5(pg_catalog.pg_get_viewdef(c.oid, false))
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'v'
   and c.relname = any (array[
     'v_live_cargo', 'v_live_vessels', 'v_cargo_match_counts',
     'v_vessel_match_counts', 'v_vessel_detail', 'v_vessel_flag_issues',
     'v_admin_queue', 'v_eligible_matches', 'v_admin_queue_detail'
   ])
union all
select 'policy ' || format('%I.%I.%I', n.nspname, c.relname, p.polname)
       || ' permissive=' || p.polpermissive::text
       || ' command=' || p.polcmd::text
       || ' roles=' || p.polroles::text
       || ' using=' || coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '<NULL>')
       || ' check=' || coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '<NULL>')
  from pg_catalog.pg_policy p
  join pg_catalog.pg_class c on c.oid = p.polrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname = any (array[
     'cargo_listings', 'vessel_availability', 'listing_ownership',
     'vessels', 'vessel_claims', 'vessel_contact_history', 'matches', 'review_queue'
   ])
union all
select 'private-snapshot-relation ' || c.relname || ' kind=' || c.relkind::text
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'market_private'
   and (
     c.relname like 'legacy\_%\_snapshot%' escape '\'
     or c.relname like 'review\_%\_snapshot%' escape '\'
   )
union all
select 'private-snapshot-routine ' || p.proname || '('
       || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'market_private'
   and (
     p.proname like 'legacy\_%\_snapshot%' escape '\'
     or p.proname like 'review\_%\_snapshot%' escape '\'
   )
order by 1
SQL
)
market_fingerprint() {
  $PSQL -At -v ON_ERROR_STOP=1 -c "$MARKET_FINGERPRINT_SQL"
}

if [ "$TARGET" = local ]; then
  applied=$($PSQL -At -v ON_ERROR_STOP=1 -c \
    "select to_regclass('market_private.listing_handles') is not null
         or to_regprocedure('public.list_market_vessels(date,date)') is not null" \
    2>/dev/null | tr -d '[:space:]')
  if [ "$applied" = t ]; then
    if [ "$FROM_APPLIED" = 1 ]; then
      echo "module present at baseline: applying DOWN chain first (--from-applied)"
      for f in "${DOWNS[@]}"; do apply_file "$f" >/dev/null || exit 1; done
    else
      echo "STOP: market privacy module is already applied on the target database." >&2
      echo "Use an isolated database, or --from-applied to restore the pre-module baseline first." >&2
      exit 2
    fi
  fi
fi

if [ "$TARGET" = local ] && [ "$DOWN" = 1 ]; then
  if market_fingerprint > "$MARKET_TMP/before.txt"; then
    echo "  ok   market ACL/comment baseline fingerprinted ($(wc -l < "$MARKET_TMP/before.txt") catalog lines)"
  else
    echo "FAIL: could not fingerprint the market ACL/comment baseline" >&2
    exit 1
  fi
fi

args=(--target "$TARGET" --chain "${CHAIN[@]}" --smokes "$T")
if [ "$DOWN" = 1 ]; then args+=(--downs "${DOWNS[@]}"); fi
bash scripts/migration-harness.sh "${args[@]}"
rc=$?

if [ "$TARGET" = local ] && [ "$DOWN" = 1 ]; then
  if market_fingerprint > "$MARKET_TMP/after.txt" \
     && diff "$MARKET_TMP/before.txt" "$MARKET_TMP/after.txt" > "$MARKET_TMP/diff.txt"; then
    echo "  ok   column/view/routine ACLs, grant options, schema comments and private snapshots match baseline"
  else
    echo "FAIL: market ACL/comment fingerprint differs after DOWN" >&2
    head -40 "$MARKET_TMP/diff.txt" >&2 2>/dev/null || true
    rc=1
  fi

  residue=$($PSQL -At -v ON_ERROR_STOP=1 -c \
    "select count(*)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'market_private'
     union all
     select count(*)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'market_private'" 2>/dev/null | tr '\n' ' ')
  if [ "$residue" != "0 0 " ] && [ "$residue" != "0 0" ]; then
    echo "FAIL: market_private objects remain after DOWN (counts: $residue)" >&2
    rc=1
  else
    echo "  ok   market_private has no table/function residue after DOWN"
  fi
fi

if [ "$TARGET" = local ] && [ "$REAPPLY" = 1 ] && [ "$DOWN" = 1 ] && [ "$rc" = 0 ]; then
  for f in "${CHAIN[@]}"; do
    if apply_file "$f" >/dev/null; then
      echo "  ok   re-applied $(basename "$f")"
    else
      echo "FAIL: re-apply $(basename "$f")" >&2
      rc=1
      break
    fi
  done
fi

# Shell races need the module to remain applied, so run them after a requested
# re-apply (the release-validation path) or a forward-only local run. They use
# fixed namespaced fixtures and clean them on every exit.
if [ "$TARGET" = local ] && [ "$rc" = 0 ] \
   && { [ "$DOWN" = 0 ] || [ "$REAPPLY" = 1 ]; }; then
  for f in "${RACES[@]}"; do
    if HARNESS_PSQL="$PSQL" bash "$f"; then
      echo "  ok   $(basename "$f")"
    else
      echo "FAIL: $(basename "$f")" >&2
      rc=1
      break
    fi
  done
fi

# The scale proof is opt-in because its SQL guard deliberately refuses the
# shared local database. Point HARNESS_PSQL at an empty disposable database
# named *market_perf* and leave the module applied.
if [ "$PERFORMANCE" = 1 ] && [ "$rc" = 0 ]; then
  if $PSQL -v ON_ERROR_STOP=1 -q -f - < "$P"; then
    echo "  ok   $(basename "$P")"
  else
    echo "FAIL: $(basename "$P")" >&2
    rc=1
  fi
fi

if [ "$rc" = 0 ]; then
  echo "MARKET PRIVACY HARNESS: OK"
else
  echo "MARKET PRIVACY HARNESS: FAILED" >&2
fi
exit "$rc"
