import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("supabase/migrations/20260923100000_pda_tariff_schema.sql", "utf8");
const publication = await readFile("supabase/migrations/20260923101000_pda_tariff_publication.sql", "utf8");
const estimates = await readFile("supabase/migrations/20260923102000_pda_estimates_and_reads.sql", "utf8");
const ingestion = await readFile("supabase/migrations/20260923103000_pda_admin_ingestion.sql", "utf8");
const rollback = await readFile("supabase/rollback/20260923_pda_down.sql", "utf8");
const actions = await readFile("app/(dashboard)/dashboard/ports-da/actions.ts", "utf8");
// The live Ports DA page renders PdaRouteEstimator; the old single-port PdaEstimator was dead code (PR-09).
const estimator = await readFile("components/pda/PdaRouteEstimator.tsx", "utf8");

for (const table of [
  "port_terminals", "tariff_publishers", "tariff_sources", "tariff_import_batches", "tariff_staged_rules",
  "port_tariff_sets", "port_tariff_versions", "port_tariff_rules", "port_tariff_bands",
]) {
  assert.match(schema, new RegExp(`create table if not exists public\\.${table}\\b`, "i"), `missing ${table}`);
  assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`, "i"), `RLS missing for ${table}`);
  assert.match(rollback, new RegExp(`drop table if exists public\\.${table}\\b`, "i"), `rollback missing ${table}`);
}
for (const table of ["pda_estimates", "pda_estimate_lines"]) {
  assert.match(estimates, new RegExp(`create table if not exists public\\.${table}\\b`, "i"));
  assert.match(estimates, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  assert.match(rollback, new RegExp(`drop table if exists public\\.${table}\\b`, "i"));
}

assert.match(schema, /revoke all on table[\s\S]+from public, anon, authenticated/i);
assert.doesNotMatch(schema, /grant\s+(?:select|insert|update|delete|all)[\s\S]{0,200}\bto\s+(?:anon|authenticated)\b/i);
assert.match(schema, /create unique index if not exists port_tariff_sets_active_scope_uq[\s\S]{0,160}nulls not distinct[\s\S]{0,80}where is_active/i);
assert.match(publication, /create or replace function public\.pda_upsert_port_terminal\(p_actor uuid, p_payload jsonb\)/i);
assert.match(publication, /create or replace function public\.pda_verify_port_terminal\(p_actor uuid, p_terminal_id uuid\)/i);
assert.match(publication, /create or replace function public\.pda_return_tariff_version\(p_actor uuid, p_version_id uuid, p_note text\)/i);
assert.match(publication, /if v\.created_by = p_actor then raise exception 'PDA_CHECKER:/i);
assert.match(publication, /coalesce\(u\.admin_tier::text, 'super'\) = 'super'/i);
assert.match(publication, /v_source_authority not in \('official','agent','statutory'\)/i);
assert.match(publication, /PDA_OVERLAP: overlapping publication must explicitly supersede/i);
assert.match(publication, /PDA_IMMUTABLE: published tariff versions cannot be edited/i);
assert.match(publication, /PDA_IMMUTABLE: submitted or published tariff children cannot change/i);
assert.match(publication, /if tg_table_name = 'port_tariff_bands' then[\s\S]+case when tg_op = 'DELETE'/i);
assert.match(publication, /where id = p_version_id and created_by = p_actor for update/i);
assert.match(schema, /constraint port_tariff_rules_basis_value_ck/i);
assert.match(schema, /constraint port_tariff_rules_percentage_ck/i);
assert.match(publication, /bands must start at zero, be contiguous and end open/i);
assert.match(publication, /PDA_APPLICABILITY: % has unsupported applicability fields/i);
assert.match(publication, /PDA_UNIT: % requires a supported band unit/i);
assert.match(publication, /PDA_UNIT: % has an unsupported unit/i);
assert.match(publication, /PDA_APPLICABILITY: % has an inverted %\/% range/i);
assert.match(publication, /PDA_PERCENTAGE: % requires at least one base code/i);
assert.match(publication, /PDA_PERCENTAGE: every base code must be a lower-priority rule in the same version/i);
assert.match(publication, /v_overlap_count > 1/i);
assert.match(publication, /s\.authority not in \('official','agent','statutory'\)/i);
assert.match(estimates, /PDA_IMMUTABLE: estimate snapshots and lines cannot change/i);
assert.match(estimates, /to_jsonb\(u\)->>'is_market_partner'/i);
assert.match(estimates, /s\.port_locode = v_port[\s\S]{0,100}s\.terminal_id is null or s\.terminal_id = v_terminal/i);
assert.match(estimates, /order by \(s\.terminal_id is not null\) desc/i);
assert.match(estimates, /PDA_COVERAGE: zero-line estimates cannot be published coverage/i);
assert.match(estimates, /from public\.organization_members m[\s\S]{0,180}m\.status = 'active'/i);
assert.match(estimates, /select t\.name from public\.port_terminals t where t\.id = v_terminal/i);
assert.match(estimates, /PDA_LINE: rule and source evidence must belong to the saved tariff version/i);
assert.match(estimates, /PDA_TOTAL: converted total does not equal converted line sum/i);
assert.match(estimates, /grant execute on function public\.get_pda_calculation_context[\s\S]{0,100}authenticated, service_role/i);
assert.match(estimates, /grant execute on function public\.list_pda_terminals\(text\)[\s\S]{0,100}authenticated, service_role/i);
assert.doesNotMatch(estimates, /grant execute on function public\.pda_save_estimate[\s\S]{0,100}authenticated/i);
assert.doesNotMatch(estimates, /grant execute on function public\.fn_can_read_pda_estimate[\s\S]{0,100}authenticated/i);
assert.match(estimates, /create or replace function public\.fn_pda_estimate_header\(p_estimate_id uuid\)/i);
assert.doesNotMatch(estimates, /grant execute on function public\.fn_pda_estimate_header[\s\S]{0,100}authenticated/i);
assert.match(rollback, /drop function if exists public\.fn_pda_estimate_header\(uuid\)/i);
assert.match(ingestion, /Stages untrusted PDF\/spreadsheet extraction only/i);
assert.doesNotMatch(ingestion, /insert into public\.port_tariff_versions/i);
assert.doesNotMatch(ingestion, /update public\.port_tariff_versions/i);
assert.match(actions, /is_market_partner[\s\S]+appUser\.is_market_partner === true/i);
assert.match(estimator, /React\.useEffect\(\(\) => \{[\s\S]+setResult\(null\)[\s\S]+loadManualLines[\s\S]+dischargeManualLines|React\.useEffect\(\(\) => \{[\s\S]+setResult\(null\)[\s\S]+dischargeManualLines[\s\S]+loadManualLines/i);

console.log("PDA SQL CONTRACT: ALL ASSERTIONS PASSED");
