#!/usr/bin/env bash
# Replaced on 20 Sep 2026 by scripts/migration-harness.sh.
#
# This script used to apply a list of migrations and smoke suites inside one
# transaction and roll back. It hid failures: a `|| true` swallowed psql exit
# codes, warnings were not inspected, a missing "ALL ASSERTIONS PASSED" was
# not an error, and it never exercised the DOWN files or compared the schema
# before and after. The harness does all of that and fails loudly:
#
#   scripts/migration-harness.sh --target local|linked \
#     --chain  <migration files in order> \
#     --smokes <smoke suites, each must print "ALL ASSERTIONS PASSED"> \
#     --downs  <DOWN files, newest first> \
#     [--allow-residue <regex for backup tables a DOWN keeps>]
#
# The exact invocation for the Data Quality release is in
# docs/data-quality-hardening.md.
echo "scripts/sql-dryrun.sh is retired — use scripts/migration-harness.sh (see the header of this file)." >&2
exit 2
