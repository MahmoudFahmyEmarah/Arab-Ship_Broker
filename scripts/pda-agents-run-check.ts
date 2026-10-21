// PDA · the hosted browser run's lifecycle contract (Codex C2O-158/159/162 P0, C2O-161/162 P1). Static; never runs the
// browser or a database.
//   node --import tsx scripts/pda-agents-run-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let n = 0;
function ok(condition: unknown, label: string) {
  assert.ok(condition, label);
  n += 1;
  console.log(`  ok   ${label}`);
}
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const has = (text: string, ...needles: string[]) => needles.every((needle) => text.includes(needle));
const before = (text: string, a: string, b: string) => text.includes(a) && text.includes(b) && text.indexOf(a) < text.indexOf(b);
const runner = read("scripts/e2e/pda-agents-run.sh");
const teardown = read("supabase/tests/e2e/pda-agents-teardown.sql");
const spec = read("e2e/pda-agents.spec.ts");
const target = read("scripts/e2e/staging-target.sh");
const preflight = read("scripts/e2e/pda-agents-preflight.sh");
const invariants = read("supabase/tests/e2e/pda-agents-preflight.sql");
const schemaFp = read("supabase/tests/e2e/schema-fingerprint.sql");
const dataFp = read("supabase/tests/e2e/data-fingerprint.sql");
const manifest = read("supabase/tests/e2e/staging-released-manifest.txt").trim().split("\n");
const race = read("scripts/db/pda-quote-race.sh");
const acceptance = read("supabase/tests/pda/quote_acceptance.sql");

// the staging binding (shared by the preflight and the runner)
ok(has(runner, "--i-hold-the-staging-window", ". scripts/e2e/staging-target.sh") && preflight.includes(". scripts/e2e/staging-target.sh")
  && has(target, "REFUSED: production database", "REFUSED: production in the env file", "REFUSED: the database is not the staging project",
    "REFUSED: the env file's API is not the staging project"),
  "runner and preflight share one staging binding that refuses production and any non-staging database or API");
ok(!/echo .*\$DBURL|echo .*SERVICE_ROLE_KEY|cat "\$DB_FILE" *$/m.test(runner + preflight) && target.includes("redact(){ sed 's/postgres[a-z]*:\\/\\/[^ ]*/<db-url>/g'; }")
  && runner.includes("| redact"), "secrets are never echoed; database errors are redacted");

// C2O-162 P0-1 · the read-only preflight, before any write
ok(target.includes('PGOPTIONS="-c default_transaction_read_only=on"') && target.includes("measure(){") && !/\bpsqlq /.test(preflight)
  && /^begin transaction read only;$/m.test(invariants), "the preflight and every gate measurement run read-only");
ok(manifest.length > 100 && manifest.every((v) => /^\d{14}$/.test(v) && v < "20261018100000") && manifest[manifest.length - 1] === "20261017100000"
  && preflight.includes("staging-released-manifest.txt") && runner.includes("staging-released-manifest.txt"),
  "the recorded migration history must equal the pinned released manifest (every version before Wave 8, ending at Wave 7)");
ok(has(invariants, "e2e-pda-ag-%@arabshipbroker.test", "E2E Agents Charterers %", "E2E Portal Agency %", "E2E Email Agency %", "E2E AGENTS PORT %",
    "E2E AGENTS VESSEL %", "E2EPDAAG-%", "E2E AGENTS WHEAT %", "auth.sessions", "auth.refresh_tokens", "auth.mfa_factors",
    "notification_deliveries", "notification_digest_batches", "market_private.listing_handles"),
  "the invariants check every 15:27-run identity shape and orphaned Auth, notification and listing descendants");
ok(has(invariants, "I3 Wave 8 / Agents objects present", "notifications_snapshot_guard", "trg_pda_estimates_immutable", "dispatch_url is not null", "value <> 'true'::jsonb")
  && invariants.includes("PREFLIGHT INVARIANTS OK"), "the invariants pin the post-Wave-7 target: no Wave 8/Agents object, guards enabled, email off, beta true");
ok(before(runner, 'measure "$LOG/before"', "trap finish EXIT") && before(runner, '[ "$SCHEMA_MD5" = "$R_SCHEMA" ]', "trap finish EXIT")
  && before(runner, '[ "$DATA_MD5" = "$R_DATA" ]', "trap finish EXIT") && before(runner, "PREFLIGHT INVARIANTS OK", "trap finish EXIT"),
  "the runner re-measures and must match the reviewed baseline before its trap and before any write");

// C2O-162 P0-2 · the exact schema fingerprint
const classes = ["'schema '", "'rel '", "'col '", "'view '", "'func '", "'index '", "'constraint '", "'policy '", "'trigger '", "'enum '", "'domain '", "'composite '", "'sequence '", "'extension '"];
ok(classes.every((c) => schemaFp.includes(c)), `the schema fingerprint covers ${classes.length} catalog classes`);
ok(has(schemaFp, "relrowsecurity", "relforcerowsecurity", "relacl", "attacl", "proacl", "nspacl", "attidentity", "attgenerated", "pg_get_expr(d.adbin",
    "tgenabled", "pg_get_viewdef", "format_type(a.atttypid, a.atttypmod)", "'public', 'market_private', 'fixture_private'"),
  "…with RLS flags, schema/table/column/function ACLs, identity, generated, defaults, exact types, trigger state, view definitions");
ok(has(runner, 'diff "$LOG/before/schema.txt" "$LOG/after/schema.txt"', 'diff "$LOG/before/data.txt" "$LOG/after/data.txt"', "invariants hold again", "migration history unchanged"),
  "after the run the manifest, invariants, schema and data are compared line by line with the baseline");

// C2O-162 P0-3 · the exact data fingerprint and Auth
ok(has(dataFp, "md5(t::text)", "order by h", "'auth'", "'storage'", "'vault'", "'supabase_migrations'", "not (n.nspname = 'auth' and c.relname = 'audit_log_entries')"),
  "the data fingerprint digests every row of every covered table; the only table excluded is the Auth audit log");
ok(runner.includes("exceptions: Auth audit log, sequence positions") && dataFp.includes("Declared exceptions"), "the declared exceptions are named, never called exact restoration");
ok(has(teardown, "delete from auth.sessions where user_id = any ($1)", "delete from auth.refresh_tokens where user_id = any", "delete from auth.mfa_factors where user_id = any ($1)",
    "to_regclass('auth.sessions')", "to_regclass('auth.refresh_tokens')", "to_regclass('auth.mfa_factors')", "(select count(*) from auth.sessions where user_id = any ($2))",
    "(select count(*) from auth.refresh_tokens where user_id = any", "to_regclass('auth.identities')", "(select count(*) from auth.identities where user_id = any ($2))")
  && before(teardown, "into v_auth from auth.users", "delete from public.users"),
  "the teardown finds the run's Auth accounts first, deletes their sessions, refresh tokens, MFA and identities, and proves them zero");

// C2O-162 P0-4 · bound to the audited source by a one-use receipt; a machine-readable HOLD
ok(runner.includes("STATUS=[A-Z]+|SHA=[0-9a-f]{40}|SCHEMA=[0-9a-f]{32}|DATA=[0-9a-f]{32}|NONCE=[0-9a-f]{32}|ISSUED_AT=[0-9]{10}")
  && runner.includes('the receipt says $R_STATUS, not GO'), "a strict receipt file; anything but STATUS=GO (HOLD, REVOKED, …) refuses");
ok(runner.includes('[ "$(git rev-parse HEAD)" = "$R_SHA" ]') && runner.includes("git status --porcelain --untracked-files=no"),
  "the checkout must be exactly the audited SHA with no tracked change");
ok(runner.includes('grep -qx "$R_NONCE" "$LEDGER"') && before(runner, 'echo "$R_NONCE" >> "$LEDGER"', "trap finish EXIT"),
  "the receipt is one-use: spent before the first write, refused if seen again");
ok(runner.includes("--peer-mail-read-at=") && runner.includes("opus-to-codex.md opusb-to-all.md") && runner.includes("changed after your read")
  && before(runner, "sleep 60", 'peer_mail "during the grace period"') && before(runner, 'peer_mail "during the grace period"', "trap finish EXIT"),
  "every peer mailbox must be unchanged since the operator's full read, before and after the 60 s grace");
ok(before(runner, "sleep 60", "receipt; peer_mail") && runner.includes("staging changed during the grace period") && runner.includes("the checkout changed during the grace period"),
  "after the grace the receipt, the checkout and both fingerprints are checked again");

// B2O-048 corrections
ok(runner.includes("STAGED=0") && runner.includes('cp "$ENV_FILE" .env.local; STAGED=1') && runner.includes('if [ "$STAGED" = 1 ]; then rm -f .env.local;') && !/^\s*\[ -f \.env\.local \] && rm -f \.env\.local/m.test(runner),
  "P1: the operator's own .env.local is removed and restored only after step 3 replaced it (STAGED flag)");
ok(target.includes('export PGURL="$DBURL"') && (target.match(/-e PGURL(?= )/g) ?? []).length === 2 && !/-e PGURL=/.test(target), "P2-1: the database URL reaches docker through the environment, never the argv");
ok(target.includes('*"postgres.$STAGING_REF:"*'), "P2-2: the pooler form with an inline password is recognised");
ok(race.includes("pg_stat_activity") && race.includes("query like 'select pg_sleep(3)%'") && !/^sleep 1$/m.test(race), "P2-3: the race waits for session A to hold its lock instead of sleeping 1 s");
ok(!/'\{carried,leg\}' <> 'discharge'/.test(acceptance) && /'\{carried,leg\}' is distinct from 'discharge'/.test(acceptance) && /coalesce\(\(select sum\(l\.amount\)/.test(acceptance),
  "P2-4: A12 compares with IS DISTINCT FROM / COALESCE so a missing key cannot pass it");
ok(invariants.includes("'I1.orphans ' || r.what") && (invariants.match(/union all select '[^']+ without /g) ?? []).length >= 13, "P2-5: the preflight prints each orphan class on its own line");
ok((invariants.match(/created_at < '2026-10-08'/g) ?? []).length === 3 && (invariants.match(/coalesce\([a-z]\.created_at >= '2026-10-08', true\)/g) ?? []).length === 3
  && invariants.includes("bad := bad + (r.n <> 0 and not r.informational)::int") && invariants.includes("when r.informational then '..   '"),
  "O2B-057: an Auth orphan created on/after 2026-10-08 (or with no date) is residue and fails; the 5-7 Oct leftovers are reported, never counted as a pass of anything");
ok(runner.includes("for f in opus-to-codex.md opusb-to-all.md") && !/codex-to-opus\.md/.test(runner) && !/Codex mints/.test(runner), "P2-6: the live mailboxes are watched; the minter is the peer auditor");
ok(preflight.includes("cron_jobs | sed") && target.includes("cron_jobs(){") && target.includes("to_regclass('cron.job')"), "the preflight lists the target's scheduled jobs (unstamped writers)");

// the lifecycle after the gates
ok(runner.includes('RUN="pdaag-$(od -An -N6 -tx1 /dev/urandom') && /export .*E2E_RUN_ID="\$RUN"/.test(runner),
  "one collision-proof run id (48 random bits) per run, handed to the spec");
ok(before(runner, "trap finish EXIT", "# ── 1 · PDA migrations"), "the teardown, rollback and verification trap is armed before anything is written");
ok(runner.includes("supabase/tests/e2e/pda-agents-teardown.sql") && runner.includes('"TEARDOWN OK $RUN"'), "the trap runs the checked-in teardown for the run id and requires its OK line");
ok(runner.includes("for (( i=${#APPLIED[@]}-1; i>=0; i-- ))") && runner.includes('APPLIED+=("$m")'), "only migrations this run applied are rolled back, newest first");
ok(runner.includes("already recorded on staging"), "a migration already recorded on staging is never applied or rolled back by the run");
ok(runner.includes('fail(){ echo "  FAIL $*"; FAILED=1; }') && runner.includes("RUN $RUN FAILED") && !/WARN/.test(runner),
  "any teardown, rollback or measurement difference fails the run; there is no warning path");
ok(runner.includes("dispatch_url is null"), "the run refuses a staging with an email dispatch URL");

// the teardown
ok(teardown.includes("v_run !~ '^pdaag-[0-9a-f]{12}$'") && teardown.includes("TEARDOWN_REFUSED"), "the teardown refuses a malformed run id");
ok(/^begin;$/m.test(teardown) && /^commit;$/m.test(teardown) && has(teardown, "TEARDOWN_RESIDUE", "TEARDOWN_TRIGGERS"),
  "one transaction that proves zero residue and re-enabled guards before it commits");
const order = ["pda_quote_acceptances", "pda_agency_quotes", "pda_quote_request_recipients", "delete from public.pda_quote_requests", "delete from public.pda_estimate_sets",
  "delete from public.pda_estimate_lines", "delete from public.pda_estimates", "delete from public.notifications", "delete from public.users", "delete from auth.sessions", "delete from auth.identities", "delete from auth.users"];
ok(order.every((t, i) => i === 0 || before(teardown, order[i - 1]!, t)), "children are removed before their parents, Auth accounts last");
ok((teardown.match(/ disable trigger /g) ?? []).length > 0 && (teardown.match(/ disable trigger /g) ?? []).length === (teardown.match(/ enable trigger /g) ?? []).length,
  "every guard the teardown disables it re-enables in the same transaction");

// the spec
ok(spec.includes("E2E_RUN_ID missing: run this spec only through scripts/e2e/pda-agents-run.sh"), "the spec refuses to seed without the runner's run id");
ok(!/\.upsert\(/.test(spec) && spec.includes("XX${"), "ports are inserted under the user-assigned XX prefix, never upserted");
const unchecked = spec.split("\n").filter((l) => /await db\.(from|rpc)\(/.test(l) && !/must\(/.test(l));
ok(unchecked.length === 0, `every seed write and read is checked (unchecked: ${unchecked.length})`);
ok(has(spec, "`e2e-${run}-m@arabshipbroker.test`", "`E2E ${run} Charterers`", "`E2E-${run}`", "`E2E ${RUN} VESSEL`"),
  "every seeded identity carries the run id in the shape the teardown matches");

// C2O-161/162 P1 · the race fixture reaches the race and leaves nothing
ok(has(race, "select token from asb_disposable.marker", "ASB_SCRATCH_TOKEN", "^[0-9a-f]{32}$") && !race.includes('case "$DBNAME" in postgres'),
  "the race binds to the disposable database's private marker, not a name denylist");
const raceCode = race.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
ok(!/create schema asb_disposable|insert into asb_disposable|create table asb_disposable/.test(raceCode) && race.includes('REFUSED: $DBNAME is not reachable or carries no disposable marker'),
  "the race only READS the marker; only the proof harness creates it, inside the fresh TEMPLATE clone it just made");
ok(has(race, "insert into public.cargo_listings", "insert into public.vessels", "insert into public.vessel_availability", "insert into public.listing_ownership",
    "'vesselAvailabilityId',avail,'vesselId',vessel,'cargoId',cargo") && !/'cargoId',gen_random_uuid|'vesselAvailabilityId',gen_random_uuid/.test(race),
  "the race seeds a real owned cargo, vessel and availability and saves the estimate for them (no random listing ids)");
ok(race.includes('$PSQL -1 -v run=') && before(race, "trap cleanup EXIT", "# ── setup") && race.includes("pda-agents-teardown.sql")
  && race.includes("race residue: zero run-stamped rows") && !race.includes("race_fixture"),
  "setup is one transaction; the trap (armed first) runs the checked-in teardown and proves zero residue");
ok(has(race, 'RUN="pdaag-$(od -An -N6 -tx1 /dev/urandom', "'e2e-' || v_run || '-m@arabshipbroker.test'", "'E2E ' || v_run || ' Charterers'", "'E2E-' || v_run", "'E2E ' || up || ' VESSEL'"),
  "the race fixture is stamped in exactly the shapes the teardown removes");
ok(has(race, "withdrawn/sent", "PDA_STATE", "pg_sleep(3)"), "the race still holds A's lock and asserts the single terminal outcome");
ok(has(acceptance, "-- A12 · the symmetric lineage", "'{carried,leg}' is distinct from 'discharge'", "A12 ok"), "nb: the symmetric discharge → load → replacement-load lineage case");

console.log(`\nPDA agents run lifecycle: ${n} checks passed`);
