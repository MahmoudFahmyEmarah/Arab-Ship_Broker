#!/usr/bin/env python3
"""Is one migration version recorded as APPLIED on the linked project?

    supabase migration list --linked 2>&1 | python scripts/migration-applied.py <version>

Exit 0 when the version appears as a remote entry, 1 when it does not, 2 when
the output could not be parsed at all. The last case matters: "I could not
read the list" must never be mistaken for "it is not applied" — or for "it is".

The CLI prints a JSON object (notices may follow it), a backtick table or a
plain table depending on version and flags, so all three are parsed (the same two shapes scripts/release-check.sh
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

    # the JSON object is one line; notices may follow it (an "update available" line, 3 Nov 2026)
    doc = None
    for line in raw.splitlines():
        s = line.strip()
        if s.startswith("{") and '"migrations"' in s:
            try:
                doc = json.loads(s)
                break
            except Exception:
                doc = None
    if doc is not None:
        try:
            for r in doc.get("migrations", []):
                rows += 1
                if r.get("remote"):
                    remote.add(str(r["remote"]))
        except Exception:
            rows, remote = 0, set()

    if rows == 0:
        # table form, backtick (older CLI) or plain (CLI 2.105):  local | remote | time
        for line in raw.splitlines():
            t = (re.match(r"\s*`([0-9]{14})?\s*`\s*\|\s*`([0-9]{14})?\s*`", line)
                 or re.match(r"\s*([0-9]{14})?\s*\|\s*([0-9]{14})?\s*\|", line))
            if not t or not (t.group(1) or t.group(2)):
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
