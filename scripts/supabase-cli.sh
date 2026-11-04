# Sourced by every release script: the ONE Supabase CLI a release may use (Codex C2ALL-191, 3 Nov 2026).
# `npx supabase` resolved the npm latest; when CLI 3.0.0 shipped it rejected the repository's config.toml and stopped
# Wave 11 mid-run. A release now uses the binary on PATH (or $SUPABASE_BIN), never a network resolution, and refuses
# unless it reports exactly the version pinned in scripts/supabase-cli.version. A CLI major or config migration is a
# separate, reviewed change to that file.
SUPABASE_BIN="${SUPABASE_BIN:-supabase}"
SUPABASE_CLI_PIN="$(tr -d '\r\n' < "$(dirname "${BASH_SOURCE[0]}")/supabase-cli.version")"
supabase_cli_check() {
  local got
  command -v "$SUPABASE_BIN" > /dev/null 2>&1 || { echo "STOP: no Supabase CLI '$SUPABASE_BIN' on PATH (pinned $SUPABASE_CLI_PIN)" >&2; return 2; }
  got="$("$SUPABASE_BIN" --version 2>/dev/null | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+$' | head -1)"
  [ "$got" = "$SUPABASE_CLI_PIN" ] || { echo "STOP: Supabase CLI '$SUPABASE_BIN' reports '${got:-nothing}', the release pins $SUPABASE_CLI_PIN (scripts/supabase-cli.version)" >&2; return 2; }
}
sb() { "$SUPABASE_BIN" "$@"; }
