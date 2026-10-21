# Best-effort logging for runners whose EXIT trap must finish whatever happened to their log directory (21 Oct 2026,
# pdaag-071e362f5fba: Playwright emptied the directory the runner's logs lived under; the trap's redirects then failed
# and its teardown and DOWNs never ran). Source it; nothing here binds to a database or prints a secret.
#   keep <file> <text>      writes the text if it can; never fails, never prints
#   logdir <dir> [<stem>]   prints a writable directory: the one asked for (re-created if it was removed) or, failing
#                           that, a fresh temporary one named after the stem
# A command whose output must be judged is run as out=$(cmd 2>&1) or, where stdout and stderr must stay apart,
#   out=$( { cmd 2>&1 1>&3 3>&- | sed 's/^/STDERR /'; } 3>&1 )
# and the text is kept afterwards: the command never waits on a redirect that may fail (see run-log-helpers-test.sh).
keep(){ { printf '%s\n' "$2" > "$1"; } 2>/dev/null || true; }
logdir(){ mkdir -p "$1" 2>/dev/null && [ -w "$1" ] && { echo "$1"; return; }; mktemp -d "${TMPDIR:-/tmp}/${2:-run-log}.XXXXXX"; }
