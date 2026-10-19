// PDA · the hosted browser run's lifecycle contract (Codex C2O-158/159 P0). Static; never runs the browser or a database.
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
const runner = read("scripts/e2e/pda-agents-run.sh");
const teardown = read("supabase/tests/e2e/pda-agents-teardown.sql");
const spec = read("e2e/pda-agents.spec.ts");

// the runner
ok(/--i-hold-the-staging-window/.test(runner) && /REFUSED: production database/.test(runner) && /REFUSED: production in the env file/.test(runner)
  && /REFUSED: the database is not the staging project/.test(runner) && /REFUSED: the env file's API is not the staging project/.test(runner),
  "the runner needs the window flag and refuses production and any non-staging database or API");
ok(/RUN="pdaag-\$\(od -An -N6 -tx1 \/dev\/urandom/.test(runner) && /export .*E2E_RUN_ID="\$RUN"/.test(runner),
  "one collision-proof run id (48 random bits) per run, handed to the spec");
ok(/trap finish EXIT/.test(runner) && runner.indexOf("trap finish EXIT") < runner.indexOf("# 2 · PDA migrations"),
  "the teardown, rollback and verification trap is armed before anything is written");
ok(/supabase\/tests\/e2e\/pda-agents-teardown\.sql/.test(runner) && /"TEARDOWN OK \$RUN"/.test(runner),
  "the trap runs the checked-in teardown for the run id and requires its OK line");
ok(/for \(\( i=\$\{#APPLIED\[@\]\}-1; i>=0; i-- \)\)/.test(runner) && /APPLIED\+=\("\$m"\)/.test(runner),
  "only migrations this run applied are rolled back, newest first");
ok(/already recorded on staging/.test(runner), "a migration already recorded on staging is never applied or rolled back by the run");
ok(/schema fingerprint = baseline/.test(runner) && /data fingerprint = baseline/.test(runner) && /tg\.tgenabled/.test(runner),
  "schema (incl. trigger enabled state) and data (every table's row count) are compared with the baseline");
ok(/fail\(\)\{ echo "  FAIL \$\*"; FAILED=1; \}/.test(runner) && /RUN \$RUN FAILED/.test(runner) && !/WARN/.test(runner),
  "any teardown, rollback or fingerprint difference fails the run; there is no warning path");
ok(/dispatch_url is null/.test(runner), "the run refuses a staging with an email dispatch URL");
ok(!/echo .*\$DBURL|echo .*SERVICE_ROLE_KEY/.test(runner) && /sed 's\/postgres\[a-z\]\*:\\\/\\\/\[\^ \]\*\/<db-url>\/g'/.test(runner),
  "secrets are never echoed; database errors are redacted");

// the teardown
ok(/v_run !~ '\^pdaag-\[0-9a-f\]\{12\}\$'/.test(teardown) && /TEARDOWN_REFUSED/.test(teardown), "the teardown refuses a malformed run id");
ok(/^begin;$/m.test(teardown) && /^commit;$/m.test(teardown) && /TEARDOWN_RESIDUE/.test(teardown) && /TEARDOWN_TRIGGERS/.test(teardown),
  "one transaction that proves zero residue and re-enabled guards before it commits");
const order = ["pda_quote_acceptances", "pda_agency_quotes", "pda_quote_request_recipients", "delete from public.pda_quote_requests", "delete from public.pda_estimate_sets",
  "delete from public.pda_estimate_lines", "delete from public.pda_estimates", "delete from public.notifications", "delete from public.users", "delete from auth.users"];
ok(order.every((t, i) => i === 0 || teardown.indexOf(t) > teardown.indexOf(order[i - 1]!)), "children are removed before their parents, Auth accounts last");
ok((teardown.match(/ disable trigger /g) ?? []).length > 0 && (teardown.match(/ disable trigger /g) ?? []).length === (teardown.match(/ enable trigger /g) ?? []).length,
  "every guard the teardown disables it re-enables in the same transaction");

// the spec
ok(/E2E_RUN_ID missing: run this spec only through scripts\/e2e\/pda-agents-run\.sh/.test(spec), "the spec refuses to seed without the runner's run id");
ok(!/\.upsert\(/.test(spec) && /XX\$\{/.test(spec), "ports are inserted under the user-assigned XX prefix, never upserted");
const unchecked = spec.split("\n").filter((l) => /await db\.(from|rpc)\(/.test(l) && !/must\(/.test(l));
ok(unchecked.length === 0, `every seed write and read is checked (unchecked: ${unchecked.length})`);
ok(/`e2e-\$\{run\}-m@arabshipbroker\.test`/.test(spec) && /`E2E \$\{run\} Charterers`/.test(spec) && /`E2E-\$\{run\}`/.test(spec) && /`E2E \$\{RUN\} VESSEL`/.test(spec),
  "every seeded identity carries the run id in the shape the teardown matches");

console.log(`\nPDA agents run lifecycle: ${n} checks passed`);
