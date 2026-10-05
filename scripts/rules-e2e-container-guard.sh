#!/usr/bin/env bash
set -euo pipefail

container="${1:-}"
expected="supabase_db_asb-rules-e2e"
if [ "$container" != "$expected" ]; then
  echo "refusing unexpected database container: $container" >&2
  exit 2
fi

actual="$(docker inspect --format '{{.Name}}' "$container")"
if [ "$actual" != "/$expected" ]; then
  echo "database container identity mismatch: $actual" >&2
  exit 2
fi

project="$(docker inspect --format '{{ index .Config.Labels "com.supabase.cli.project" }}' "$container")"
if [ "$project" != "asb-rules-e2e" ]; then
  echo "database container project mismatch: $project" >&2
  exit 2
fi

echo "disposable container guard: OK"
