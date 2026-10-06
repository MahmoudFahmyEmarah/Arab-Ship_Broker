import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const database = process.env.MATCHING_TEST_DB ?? "asb_rules";
const container = process.env.MATCHING_DB_CONTAINER ?? "supabase_db_arab-ship-broker";
if (process.env.DOCKER_HOST && !/^(?:npipe|unix):/i.test(process.env.DOCKER_HOST)) {
  throw new Error(`Refusing non-local Docker host ${process.env.DOCKER_HOST}`);
}
if (!/^asb_rules(?:[_-][a-z0-9_-]+)?$/i.test(database)) {
  throw new Error(`Refusing concurrency proof outside a disposable asb_rules* database (received ${database})`);
}

const ids = {
  actor: randomUUID(), cargo: randomUUID(), vessel: randomUUID(), availability: randomUUID(),
  failRequest: randomUUID(), successRequest: randomUUID(),
};
const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const psqlArgs = ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-At"];

function psql(sql: string, allowFailure = false) {
  const result = spawnSync("docker", psqlArgs, { input: sql, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result;
}

const setup = psql(`
begin;
set local session_replication_role = replica;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000', ${quote(ids.actor)}::uuid, 'authenticated', 'authenticated',
  ${quote(`matching-concurrency-${ids.actor}@example.test`)}, '', now(), now());
insert into public.users(id,supabase_user_id,email,full_name,role,is_active,admin_tier,subscription_tier)
values (${quote(ids.actor)}::uuid, ${quote(ids.actor)}::uuid, ${quote(`matching-concurrency-${ids.actor}@example.test`)},
  'Matching concurrency proof', 'admin', true, 'super', 'T4');
insert into public.cargo_listings(
  id,ref,status,cargo_type,commodity_name,qty_min_mt,qty_max_mt,
  load_port_locode,disch_port_locode,load_zone,disch_zone,is_spot,review_status
)
values (${quote(ids.cargo)}::uuid, ${quote(`MATCH-CONC-${ids.cargo.slice(0, 8)}`)}, 'IN', 'Dry Bulk', 'Concurrency proof',
  900, 1000, 'GRPIR', 'SAJED', 'E.MED', 'R.SEA', true, 'APPROVED');
insert into public.vessels(id,vessel_name,imo_number,vessel_type,dwt_grain,build_year,is_geared,grain_certified,dg_certified,is_sanctioned)
values (${quote(ids.vessel)}::uuid, 'MATCH CONCURRENCY', '9600009', 'Bulk Carrier', 1000, 2020, true, true, true, false);
insert into public.vessel_availability(id,vessel_id,open_zone,open_date,accepts_part_cargo,status,review_status)
values (${quote(ids.availability)}::uuid, ${quote(ids.vessel)}::uuid, 'E.MED', current_date, false, 'OPEN', 'APPROVED');
with active as (
  select s.active_version_id, v.params
  from public.matching_rule_state s join public.matching_rule_versions v on v.id=s.active_version_id
  where s.singleton
), inserted as (
  insert into public.matching_rule_versions(schema_version,evaluator_version,params,params_sha256,note,created_by)
  select 1, 'matching-v1', changed.params, public.fn_matching_params_sha256(changed.params), 'Concurrency proof draft', ${quote(ids.actor)}::uuid
  from active a
  cross join lateral (
    select jsonb_set(a.params, '{rateAlignmentUsd}', to_jsonb(
      case when (a.params->>'rateAlignmentUsd')::numeric < 1000
        then (a.params->>'rateAlignmentUsd')::numeric + 0.01
        else (a.params->>'rateAlignmentUsd')::numeric - 0.01 end
    )) as params
  ) changed
  returning id, version_no
)
select jsonb_build_object(
  'active', (select active_version_id from public.matching_rule_state where singleton),
  'target', (select id from inserted),
  'targetVersionNo', (select version_no from inserted)
)::text;
commit;
`);
const setupData = JSON.parse(setup.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "null") as {
  active: string; target: string; targetVersionNo: number;
};
assert.equal(Number.isSafeInteger(setupData.targetVersionNo), true, "setup omitted a numeric target version");

async function holdConflictingLock(): Promise<ReturnType<typeof spawn>> {
  const child = spawn("docker", psqlArgs, { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end("begin; lock table public.vessels in row exclusive mode; select 'LOCK_READY'; select pg_sleep(8); rollback;\n");
  await new Promise<void>((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error("Timed out waiting for conflicting source lock")), 5_000);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.includes("LOCK_READY")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!stdout.includes("LOCK_READY")) reject(new Error(`Lock session exited early (${code})`));
    });
  });
  return child;
}

async function main(): Promise<void> {
  let lockSession: ReturnType<typeof spawn> | undefined;
  try {
    lockSession = await holdConflictingLock();
    const started = Date.now();
    const blocked = psql(`set role service_role; select public.matching_activate_rule_version(
      ${quote(ids.actor)}::uuid, ${quote(ids.failRequest)}::uuid, ${quote(setupData.target)}::uuid,
      ${quote(setupData.active)}::uuid, ${quote(`ACTIVATE v${setupData.targetVersionNo}`)});`, true);
    const elapsedMs = Date.now() - started;
    assert.notEqual(blocked.status, 0, "activation unexpectedly waited through the conflicting writer");
    assert.match(blocked.stderr, /MATCHING_BUSY:/);
    assert.ok(elapsedMs < 4_000, `MATCHING_BUSY was not fail-fast (${elapsedMs} ms)`);

    const residue = psql(`select jsonb_build_object(
      'active', (select active_version_id from public.matching_rule_state where singleton),
      'candidates', (select count(*) from public.matching_candidates where version_id=${quote(setupData.target)}::uuid),
      'snapshots', (select count(*) from public.matching_candidate_snapshots where version_id=${quote(setupData.target)}::uuid),
      'requests', (select count(*) from public.matching_rule_requests where request_id=${quote(ids.failRequest)}::uuid)
    )::text;`);
    assert.deepEqual(JSON.parse(residue.stdout.trim()), {
      active: setupData.active, candidates: 0, snapshots: 0, requests: 0,
    }, "failed publication left governed residue");

    await new Promise<void>((resolve, reject) => {
      lockSession!.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Lock session failed (${code})`)));
    });
    lockSession = undefined;

    const success = psql(`begin; set local role service_role;
      select (public.matching_activate_rule_version(
        ${quote(ids.actor)}::uuid, ${quote(ids.successRequest)}::uuid, ${quote(setupData.target)}::uuid,
        ${quote(setupData.active)}::uuid, ${quote(`ACTIVATE v${setupData.targetVersionNo}`)}
      )->>'versionId')::uuid;
      rollback;`);
    assert.match(success.stdout, new RegExp(setupData.target, "i"));
    console.log("MATCHING CONCURRENCY: fail-fast refusal, zero residue and retry success passed");
  } finally {
    if (lockSession && lockSession.exitCode === null) lockSession.kill();
    psql(`begin; set local session_replication_role = replica;
      delete from public.matching_rule_versions where id=${quote(setupData.target)}::uuid;
      delete from public.vessel_availability where id=${quote(ids.availability)}::uuid;
      delete from public.vessels where id=${quote(ids.vessel)}::uuid;
      delete from public.cargo_listings where id=${quote(ids.cargo)}::uuid;
      delete from public.users where id=${quote(ids.actor)}::uuid;
      delete from auth.users where id=${quote(ids.actor)}::uuid;
      commit;`, true);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
