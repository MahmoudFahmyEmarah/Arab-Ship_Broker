# Shared by scripts/e2e/pda-agents-preflight.sh and scripts/e2e/pda-agents-run.sh (source, do not execute).
# Binds every call to the approved hosted STAGING project and refuses production anywhere. Secrets stay in files and
# the environment; nothing here prints them.
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
CERT="$(cygpath -w "$CA_FILE" 2>/dev/null || echo "$CA_FILE")"

# psqlq [psql args…]   — read-write (the runner, after its gates)
# psqlro [psql args…]  — every statement in a READ ONLY transaction (default_transaction_read_only=on)
psqlq(){ MSYS_NO_PATHCONV=1 docker run --rm -i -v "$CERT:/root/.postgresql/root.crt:ro" -e PGURL="$DBURL" --entrypoint sh "$IMG" \
           -c 'psql "$PGURL" -X -q -At -v ON_ERROR_STOP=1 "$@"' sh "$@"; }
psqlro(){ MSYS_NO_PATHCONV=1 docker run --rm -i -v "$CERT:/root/.postgresql/root.crt:ro" -e PGURL="$DBURL" -e PGOPTIONS="-c default_transaction_read_only=on" \
            --entrypoint sh "$IMG" -c 'psql "$PGURL" -X -q -At -v ON_ERROR_STOP=1 "$@"' sh "$@"; }
redact(){ sed 's/postgres[a-z]*:\/\/[^ ]*/<db-url>/g'; }

# measure <dir>: the four read-only measurements every gate compares (manifest, invariants, schema, data)
measure(){
  local out="$1"; mkdir -p "$out"
  psqlro -c "select version from supabase_migrations.schema_migrations order by version" > "$out/manifest.txt" 2> "$out/manifest.err" || return 1
  psqlro -f - < supabase/tests/e2e/pda-agents-preflight.sql > "$out/invariants.txt" 2> "$out/invariants.err" || return 1
  psqlro -f - < supabase/tests/e2e/schema-fingerprint.sql > "$out/schema.txt" 2> "$out/schema.err" || return 1
  psqlro -f - < supabase/tests/e2e/data-fingerprint.sql > "$out/data.txt" 2> "$out/data.err" || return 1
  [ -s "$out/schema.txt" ] && [ -s "$out/data.txt" ] || return 1
  SCHEMA_MD5=$(md5sum < "$out/schema.txt" | cut -c1-32); DATA_MD5=$(md5sum < "$out/data.txt" | cut -c1-32)
}
