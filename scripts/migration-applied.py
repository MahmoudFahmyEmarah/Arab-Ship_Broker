#!/usr/bin/env python3
"""Is one migration version recorded as APPLIED on the linked project?

    npx supabase migration list --linked 2>&1 | python scripts/migration-applied.py <version>

Exit 0 when the version appears as a remote entry, 1 when it does not, 2 when
the output could not be parsed at all. The last case matters: "I could not
read the list" must never be mistaken for "it is not applied" — or for "it is".

The CLI prints either a JSON object or a backtick table depending on version
and flags, so both are parsed (the same two shapes scripts/release-check.sh
handles).
"""
import json
import re
import sys


def main() -> int:
    if len(sys.argv) != 2 or not re.fullmatch(r"[0-9]{14}", sys.argv[1]):
        print("usage: migration-applied.py <14-digit version>", file=sys.stderr)
        return 2
    want = sys.argv[1]
    raw = sys.stdin.read()

    rows = 0
    remote: set[str] = set()

    m = re.search(r'\{.*"migrations".*\}\s*$', raw, re.S)
    if m:
        try:
            for r in json.loads(m.group(0)).get("migrations", []):
                rows += 1
                if r.get("remote"):
                    remote.add(str(r["remote"]))
        except Exception:
            rows, remote = 0, set()

    if rows == 0:
        # table form:  ` local ` | ` remote ` | ` time `
        for line in raw.splitlines():
            t = re.match(r"\s*`([0-9]{14})?\s*`\s*\|\s*`([0-9]{14})?\s*`", line)
            if not t:
                continue
            rows += 1
            if t.group(2):
                remote.add(t.group(2))

    if rows == 0:
        print(f"could not parse the migration list — refusing to answer for {want}", file=sys.stderr)
        return 2
    return 0 if want in remote else 1


if __name__ == "__main__":
    sys.exit(main())
