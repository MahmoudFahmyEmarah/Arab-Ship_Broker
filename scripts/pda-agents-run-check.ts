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
ok(has(runner, 'diff "$LOG/before/schema.txt" "$LOG/after/schema.txt"', 'diff "$LOG/before/data.txt" "$LOG/after/data.txt"', "invariants hold again", "migration history = pinned manifest"),
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
ok(runner.includes("--peer-mail-read-at=") && runner.includes("opus-to-codex.md opusb-to-all.md codex-to-opus.md") && runner.includes("changed after your read")
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
  && invariants.includes("bad := bad + ((r.n <> 0 and not r.informational) or (r.informational and r.n > r.pinned))::int") && has(invariants, "pinned 36)", "pinned 45)", "true as informational, 36 as pinned", "true, 45"),
  "O2B-057: an Auth orphan created on/after 2026-10-08 (or with no date) is residue and fails; the 5-7 Oct leftovers are reported, never counted as a pass of anything");
ok(runner.includes("for f in opus-to-codex.md opusb-to-all.md codex-to-opus.md; do") && !/Codex mints/.test(runner) && runner.includes("ALL THREE live mailboxes IN FULL"),
  "P2-6 / B2O-067: all three live mailboxes are watched (Codex is back, 21 Oct); the minter is the non-author peer auditor");
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

// 21 Oct 2026 (pdaag-071e362f5fba, B2O-061) · the runner's logs live where nothing in the run cleans, the trap's database
// steps never depend on a log being writable, and the recovery of a run whose trap could not finish is checked in
const pwConfig = read("playwright.pda.config.ts");
const recover = read("scripts/e2e/pda-agents-recover.sh");
const helpers = read("scripts/e2e/run-log-helpers.sh");
const helpersTest = read("scripts/e2e/run-log-helpers-test.sh");
const pkg = read("package.json");
// comments never satisfy or defeat a pin: the shell files are matched on their code lines only
const code = (text: string) => text.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
const runnerCode = code(runner);
const recoverCode = code(recover);
const trap = runnerCode.slice(runnerCode.indexOf("finish(){"), runnerCode.indexOf("trap finish EXIT"));
const outputDir = /outputDir:\s*"([^"]+)"/.exec(pwConfig)?.[1] ?? "";
ok(runnerCode.includes('LOG="tmp/pda-agents-run/$RUN"') && !/LOG="?test-results\//.test(runnerCode) && outputDir === "test-results/pda-agents" && !"tmp/pda-agents-run".startsWith(outputDir)
  && !"tmp/pda-agents-recover".startsWith(outputDir),
  "the runner logs under tmp/pda-agents-run/<run>; Playwright has its own explicit outputDir (test-results/pda-agents), which it empties, and no log lives under it");
ok(has(trap, 'LOG=$(logdir "$LOG" "pda-agents-run-$RUN")') && before(runnerCode, ". scripts/e2e/run-log-helpers.sh", "finish(){") && runnerCode.includes('. scripts/e2e/run-log-helpers.sh || { echo "REFUSED')
  && before(trap, 'LOG=$(logdir', 'measure "$LOG/after"')
  && has(code(helpers), 'mkdir -p "$1" 2>/dev/null && [ -w "$1" ] && { echo "$1"; return; }', "mktemp -d", '[ -n "$d" ] && [ -w "$d" ]', 'echo "."; }', 'keep(){ { printf', '; } 2>/dev/null || true; }')
  && has(helpersTest, ". scripts/e2e/run-log-helpers.sh", "2>&1 1>&3 3>&- | sed 's/^/STDERR /'; } 3>&1 )", "logdir re-created the removed directory", "keep on an unwritable path", 'TMPDIR=/proc/nonexistent logdir')
  && /"test:pda":\s*"[^"]*bash scripts\/e2e\/run-log-helpers-test\.sh/.test(pkg),
  "the trap first takes a writable log directory (the run's, or a fresh temporary one); keep/logdir are shared, sourced and behaviour-tested");
// every redirect target inside the trap, whatever the variable is called: only the null device and file descriptors are allowed
const redirectTargets = (text: string) => (text.match(/(?:^|\s)\d?>{1,2}\s*(?:"[^"]*"|\S+)/gm) ?? []).map((r) => r.replace(/^\s*\d?>{1,2}\s*/, "").replace(/[;)]+$/, ""));
const allowedTarget = (t: string) => ["/dev/null", '"/dev/null"', "&1", "&2", "&3", "&-"].includes(t);
const trapTargets = redirectTargets(trap);
ok(trapTargets.length >= 6 && trapTargets.every(allowedTarget) && !/\btee\b/.test(trap)
  && has(trap, "2>&1 1>&3 3>&- | sed 's/^/STDERR /'; } 3>&1 )", '[ "$tdok" = "TEARDOWN OK $RUN" ]', 'keep "$LOG/teardown.log" "$td"', "last line '${tdok:-<none>}'",
    'dn=$({ echo "$marker"; cat "supabase/rollback/${m}_down.sql"; } 2>&1 | psqlq -1 -f - 2>&1)', 'keep "$LOG/down-$m.log" "$dn"', "grep -m1 -i error ||")
  && !/\|\| printf '%s\\n' "\$(dn|ap)" \| head -1 \| redact/.test(runnerCode) && (runnerCode.match(/head -1; } \| redact\)/g) ?? []).length === 2,
  `no step in the trap runs through a file redirect (targets: ${[...new Set(trapTargets)].join(" ")}); teardown and DOWN output are captured in memory, then kept if they can be`);
ok(before(runnerCode, "BASE_MANIFEST=$(tr -d '\\r' < supabase/tests/e2e/staging-released-manifest.txt)", "trap finish EXIT")
  && has(trap, `diff -q <(printf '%s\\n' "$BASE_MANIFEST") "$LOG/after/manifest.txt"`, '[ "$SCHEMA_MD5" = "$BASE_SCHEMA" ]', '[ "$DATA_MD5" = "$BASE_DATA" ]', '[ -f "$LOG/before/schema.txt" ] &&', '[ -f "$LOG/before/data.txt" ] &&')
  && !trap.includes("staging-released-manifest.txt") && !trap.includes('diff -q "$LOG/before/manifest.txt"'),
  "the trap's baseline (manifest and both fingerprints) is held in memory since the gate; neither a lost before/ directory nor a changed file on disk can pass or fail it");
ok(has(runnerCode, 'ap=$(psqlq -1 -f - < "supabase/migrations/$m.sql" 2>&1) ||', 'keep "$LOG/apply-$m.log" "$ap"', 'bl=$(npx next build --webpack 2>&1) ||', 'keep "$LOG/build.log" "$bl"',
    'pl=$(npx playwright test --config=playwright.pda.config.ts e2e/pda-agents.spec.ts 2>&1); PW=$?', 'keep "$LOG/playwright.log" "$pl"'),
  "apply, build and browser output are captured in memory and kept best effort; a lost log never stops a step the trap would then have to undo");
ok(has(recoverCode, "--i-hold-the-staging-window", "^pdaag-[0-9a-f]{12}$", ". scripts/e2e/staging-target.sh", 'LOG="tmp/pda-agents-recover/$RUN-', "REFUSED: the receipt lacks SHA, SCHEMA or DATA",
    'case "$R_STATUS" in GO|HOLD) ;; *)', 'git diff --quiet "$R_SHA" -- supabase/ && [ -z "$(git status --porcelain --untracked-files=no -- supabase/ scripts/e2e/)" ]')
  && has(recoverCode, "pda-agents-teardown.sql", '"TEARDOWN OK $RUN"') && before(recover, "# 0 · the state as found", "# 1 · teardown") && before(recoverCode, 'measure "$LOG/before"', '"TEARDOWN OK $RUN"')
  && before(recover, '"TEARDOWN OK $RUN"', "# 2 · DOWNs") && recoverCode.includes('redact | cut -c1-300)"; exit 1; fi'),
  "recovery runs only inside a window, for one run id, with a GO/HOLD receipt whose SHA's supabase/ tree is the checkout's; it measures the state as found, then tears down first and stops at the first failure");
ok((recoverCode.match(/marker="\$\(\[ \$DISCARD = 1 \] && echo "set local asb\./g) ?? []).length === 6 && !/marker="set local/.test(recoverCode)
  && has(recoverCode, 'DISCARD=0; case "${3:-}" in "") ;; --discard-remaining) DISCARD=1;;', "re-run with --discard-remaining only if they are declared exported"),
  "recovery DOWNs carry no history-export marker unless --discard-remaining is given, so remaining non-run rows make them refuse and stop");
ok(has(recoverCode, "20261019120000_pda_desk_quotes 20261019110000_pda_quote_acceptance 20261019100000_pda_quote_requests 20261018140000_pda_estimate_set_org_lineage",
    "20261018130000_pda_agencies 20261018120000_pda_estimate_sets 20261018110000_pda_member_preferences 20261018100000_pda_ports_workspace",
    "column_name = 'entered_via'", "to_regclass('public.pda_quote_acceptances')", "to_regclass('public.pda_quote_requests')", "to_regclass('public.pda_agencies')",
    "to_regclass('public.pda_estimate_sets')", "to_regclass('public.pda_member_preferences')", "list_pda_ports_workspace(date)", "not present; nothing to roll back",
    "history-exported:$RUN", "registry-exported:$RUN", "discard-preferences") && recoverCode.includes('present=$(psqlro -c "$probe"'),
  "recovery rolls back newest-first with the same markers as the trap, each DOWN only where a read-only probe finds the migration's objects");
ok(before(recoverCode, ". scripts/e2e/run-log-helpers.sh || { echo \"REFUSED", "td=$(") && recoverCode.includes('mkdir -p "$LOG" || { echo "REFUSED')
  && has(recoverCode, "2>&1 1>&3 3>&- | sed 's/^/STDERR /'; } 3>&1 )", 'keep "$LOG/teardown.log" "$td"', "last line '${tdok:-<none>}'", 'keep "$LOG/down-$m.log" "$dn"', "grep -m1 -i error ||", "head -1; } | redact)")
  && redirectTargets(recoverCode.slice(recoverCode.indexOf("td=$("))).every(allowedTarget)
  && has(recoverCode, 'present=$(psqlro -c "$probe" 2>&1) ||', "probe for $m failed", "probe for $m answered neither t nor f", 'f) echo "  ..   $m not present')
  && recoverCode.includes("like '%v_org uuid := p_owner_org_id%', false)"),
  "recovery captures teardown and DOWN output in memory (no file redirect after its gates); a probe that errors or answers oddly is a FAIL, never \"not present\"; the lineage probe reads the function body");
ok((target.match(/-e PGCONNECT_TIMEOUT=30 /g) ?? []).length === 2, "both staging psql wrappers carry a connect timeout, so a dead host cannot hang a trap");
ok(has(recoverCode, "set value = 'true'::jsonb where key = 'beta_mode'", 'measure "$LOG/after"', "staging-released-manifest.txt", "PREFLIGHT INVARIANTS OK",
    '[ "$SCHEMA_MD5" = "$R_SCHEMA" ]', '[ "$DATA_MD5" = "$R_DATA" ]', "RECOVERY OK", "RECOVERY INCOMPLETE"),
  "recovery restores beta and proves the pinned manifest, the invariants and the receipt's exact schema and data fingerprints");

// 21 Oct 2026 (pdaag-c0fb88d1aeea) · the browser spec's seed once used an enum label that no database has ("broker" for
// profile_type). Every value the seed writes into an enum-typed column must be a label the repo's own SQL declares
// (CREATE TYPE … AS ENUM / ALTER TYPE … ADD VALUE), so a seed can never fail for a label again.
import { readdirSync } from "node:fs";
const enumLabels = new Map<string, Set<string>>();
const sqlDirs = ["supabase/baseline", "supabase/migrations", "supabase/migrations/_archive_pre_baseline"];
const sqlFiles = sqlDirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".sql")).map((f) => `${d}/${f}`));
for (const file of sqlFiles) {
  const sql = read(file);
  for (const m of sql.matchAll(/create\s+type\s+(?:"?public"?\.)?"?([a-z_]+_enum)"?\s+as\s+enum\s*\(([^)]*)\)/gi)) {
    const set = enumLabels.get(m[1]!) ?? new Set<string>();
    for (const v of m[2]!.matchAll(/'((?:[^']|'')*)'/g)) set.add(v[1]!.replace(/''/g, "'"));
    enumLabels.set(m[1]!, set);
  }
  for (const m of sql.matchAll(/alter\s+type\s+(?:"?public"?\.)?"?([a-z_]+_enum)"?\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'((?:[^']|'')*)'/gi)) {
    const set = enumLabels.get(m[1]!) ?? new Set<string>();
    set.add(m[2]!.replace(/''/g, "'"));
    enumLabels.set(m[1]!, set);
  }
}
const seededEnumColumns: Record<string, string[]> = {
  profile_type: ["profile_type_enum"], cargo_type: ["cargo_type_enum"], port_type: ["port_type_enum"], listing_type: ["listing_type_enum"],
  load_terms: ["load_terms_enum"], load_zone: ["zone_enum"], disch_zone: ["zone_enum"], open_zone: ["zone_enum"], zone: ["zone_enum"],
  vessel_type: ["vessel_type_enum"], review_status: ["review_status_enum"], subscription_tier: ["subscription_tier_enum"],
  status: ["cargo_status_enum", "vessel_status_enum", "__text__"], role: ["ownership_role_enum", "__text__"],
};
const textAllowed: Record<string, string[]> = { status: ["active"], role: ["admin", "broker"] }; // organization_members.status, users.role are text
const seeded = [...spec.matchAll(/\b(profile_type|cargo_type|port_type|listing_type|load_terms|load_zone|disch_zone|open_zone|zone|vessel_type|review_status|subscription_tier|status|role):\s*"([^"]*)"/g)]
  .map((m) => ({ column: m[1]!, value: m[2]! }));
const badSeeds = seeded.filter(({ column, value }) => {
  const types = seededEnumColumns[column] ?? [];
  if (types.includes("__text__") && (textAllowed[column] ?? []).includes(value)) return false;
  return !types.some((t) => enumLabels.get(t)?.has(value));
});
ok(enumLabels.has("profile_type_enum") && enumLabels.get("profile_type_enum")!.has("cargo") && !enumLabels.get("profile_type_enum")!.has("broker") && enumLabels.has("zone_enum") && enumLabels.has("vessel_status_enum"),
  `the repo's SQL declares the enums the seed writes to (${enumLabels.size} enum types parsed)`);
ok(seeded.length >= 20 && badSeeds.length === 0 && spec.includes('profile_type: "cargo"') && !spec.includes('profile_type: "broker"'),
  `every enum-typed value the spec seeds is a declared label (${seeded.length} seeds checked${badSeeds.length ? `; bad: ${badSeeds.map((b) => `${b.column}=${b.value}`).join(", ")}` : ""})`);

console.log(`\nPDA agents run lifecycle: ${n} checks passed`);
