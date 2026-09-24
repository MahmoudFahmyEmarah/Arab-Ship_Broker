import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("supabase/migrations/20260923100000_pda_tariff_schema.sql", "utf8");
const publication = await readFile("supabase/migrations/20260923101000_pda_tariff_publication.sql", "utf8");
const estimates = await readFile("supabase/migrations/20260923102000_pda_estimates_and_reads.sql", "utf8");
const ingestion = await readFile("supabase/migrations/20260923103000_pda_admin_ingestion.sql", "utf8");
const rollback = await readFile("supabase/rollback/20260923_pda_down.sql", "utf8");

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
assert.match(estimates, /PDA_IMMUTABLE: estimate snapshots and lines cannot change/i);
assert.match(estimates, /s\.port_locode = v_port[\s\S]{0,100}s\.terminal_id is null or s\.terminal_id = v_terminal/i);
assert.match(estimates, /PDA_LINE: rule and source evidence must belong to the saved tariff version/i);
assert.match(estimates, /PDA_TOTAL: converted total does not equal converted line sum/i);
assert.match(estimates, /grant execute on function public\.get_pda_calculation_context[\s\S]{0,100}authenticated, service_role/i);
assert.match(estimates, /grant execute on function public\.list_pda_terminals\(text\)[\s\S]{0,100}authenticated, service_role/i);
assert.doesNotMatch(estimates, /grant execute on function public\.pda_save_estimate[\s\S]{0,100}authenticated/i);
assert.doesNotMatch(estimates, /grant execute on function public\.fn_can_read_pda_estimate[\s\S]{0,100}authenticated/i);
assert.match(ingestion, /Stages untrusted PDF\/spreadsheet extraction only/i);
assert.doesNotMatch(ingestion, /insert into public\.port_tariff_versions/i);
assert.doesNotMatch(ingestion, /update public\.port_tariff_versions/i);

console.log("PDA SQL CONTRACT: ALL ASSERTIONS PASSED");
