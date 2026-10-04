import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

import {
  evaluatePairMatch,
  MATCHING_SQL_GOLDEN_V1,
  pairEligible,
  parseMatchingRulesV1,
  rankEligibleMatches,
} from "../lib/matching-rules";
import type { CargoMatchFacts, VesselMatchFacts } from "../lib/matching-rules";

const database = process.env.MATCHING_TEST_DB ?? "asb_rules";
const container = process.env.MATCHING_DB_CONTAINER ?? "supabase_db_arab-ship-broker";
if (process.env.DOCKER_HOST && !/^(?:npipe|unix):/i.test(process.env.DOCKER_HOST)) {
  throw new Error(`Refusing non-local Docker host ${process.env.DOCKER_HOST}`);
}
if (!/^asb_rules(?:[_-][a-z0-9_-]+)?$/i.test(database)) {
  throw new Error(`Refusing SQL parity outside a disposable asb_rules* database (received ${database})`);
}

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const sqlValue = (value: string | number | boolean | null): string => {
  if (value === null) return "null";
  if (typeof value === "string") return quote(value);
  return String(value);
};
const sqlBool = (value: boolean | null): string => value === null ? "null" : value ? "true" : "false";
const isoDay = (day: number | null): string | null => {
  if (day === null) return null;
  return new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
};
const uuidFactory = () => {
  const prefix = randomBytes(12).toString("hex");
  let counter = 0;
  return (): string => {
    counter += 1;
    const hex = `${prefix}${counter.toString(16).padStart(8, "0")}`;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
};

interface Seed {
  readonly name: string;
  readonly cargoId: string;
  readonly vesselId: string;
  readonly availabilityId: string;
  readonly cargo: CargoMatchFacts;
  readonly vessel: VesselMatchFacts;
}

const nextUuid = uuidFactory();
const seeds: Seed[] = MATCHING_SQL_GOLDEN_V1.pairs.map((fixture) => ({
  name: fixture.name,
  cargoId: nextUuid(),
  vesselId: nextUuid(),
  availabilityId: nextUuid(),
  cargo: fixture.cargo,
  vessel: fixture.vessel,
}));
const rankingCargoId = nextUuid();
const rankingSeeds: Seed[] = MATCHING_SQL_GOLDEN_V1.ranking.vessels.map((vessel) => ({
  name: vessel.availabilityId,
  cargoId: rankingCargoId,
  vesselId: nextUuid(),
  availabilityId: nextUuid(),
  cargo: MATCHING_SQL_GOLDEN_V1.ranking.cargo,
  vessel,
}));
const decimalSeed: Seed = {
  name: "decimal-rate-boundary",
  cargoId: nextUuid(),
  vesselId: nextUuid(),
  availabilityId: nextUuid(),
  cargo: { ...MATCHING_SQL_GOLDEN_V1.pairs[0].cargo, freightIdeaUsdMt: 20.8 },
  vessel: { ...MATCHING_SQL_GOLDEN_V1.pairs[0].vessel, freightIdeaUsdMt: 20.7 },
};

function cargoInsert(seed: Seed): string {
  const c = seed.cargo;
  return `(${quote(seed.cargoId)}::uuid, ${quote(`SQL-PARITY-${seed.name}`)}, ${sqlValue(c.status)}::public.cargo_status_enum, ${sqlValue(c.cargoType)}::public.cargo_type_enum, ${quote(seed.name)}, ${sqlValue(c.qtyMinMt)}, ${sqlValue(c.qtyMaxMt)}, 'GRPIR', 'KWSWK', ${sqlValue(c.loadZone)}::public.zone_enum, ${sqlValue(c.dischZone)}::public.zone_enum, ${sqlValue(isoDay(c.laycanFromDay))}::date, ${sqlBool(c.isSpot)}, ${sqlValue(c.freightIdeaUsdMt)}, ${sqlBool(c.requiresGeared)}, ${sqlBool(c.isGrainCargo)}, ${sqlBool(c.isDgCargo)}, ${sqlValue(c.maxVesselAgeYr)}, ${sqlValue(c.maxDraftM)}, ${sqlValue(c.maxLoaM)}, ${sqlValue(c.reviewStatus)}::public.review_status_enum)`;
}

function vesselInsert(seed: Seed): string {
  const v = seed.vessel;
  const vesselType = v.vesselType === "Bulk Carrier" || v.vesselType === "General Cargo" ? v.vesselType : "Other";
  return `(${quote(seed.vesselId)}::uuid, ${quote(`SQL PARITY ${seed.name}`)}, ${quote(vesselType)}::public.vessel_type_enum, ${sqlValue(v.dwtGrainMt)}, ${sqlValue(v.buildYear)}, ${sqlBool(v.isGeared)}, ${sqlBool(v.grainCertified)}, ${sqlBool(v.dgCertified)}, ${sqlValue(v.maxLoaM)}, ${sqlValue(v.maxDraftM)}, ${sqlBool(v.isSanctioned)})`;
}

function availabilityInsert(seed: Seed): string {
  const v = seed.vessel;
  return `(${quote(seed.availabilityId)}::uuid, ${quote(seed.vesselId)}::uuid, ${quote(`SQL PARITY ${seed.name}`)}, ${sqlValue(v.openZone)}::public.zone_enum, ${sqlValue(isoDay(v.openDateDay))}::date, ${sqlValue(v.freightIdeaUsdMt)}, ${sqlBool(v.acceptsPartCargo)}, ${sqlValue(v.availabilityStatus)}::public.vessel_status_enum, ${sqlValue(v.availabilityReviewStatus)}::public.review_status_enum)`;
}

const allSeeds = [...seeds, ...rankingSeeds, decimalSeed];
const cargoSeeds = [...seeds, rankingSeeds[0], decimalSeed];
const pairValues = seeds.map((seed) =>
  `(${quote(seed.name)}, ${quote(seed.cargoId)}::uuid, ${quote(seed.availabilityId)}::uuid)`).join(",\n");
const rankingIds = rankingSeeds.map((seed) => `${quote(seed.availabilityId)}::uuid`).join(",");
const rulesJson = JSON.stringify(MATCHING_SQL_GOLDEN_V1.rules);
const decimalRulesJson = JSON.stringify({ ...MATCHING_SQL_GOLDEN_V1.rules, rateAlignmentUsd: 0.1 });

const sql = `
begin;
set local session_replication_role = replica;
insert into public.cargo_listings(
  id, ref, status, cargo_type, commodity_name, qty_min_mt, qty_max_mt,
  load_port_locode, disch_port_locode, load_zone, disch_zone,
  laycan_from, is_spot, freight_idea_usd_mt,
  requires_geared, is_grain_cargo, is_dg_cargo, max_vessel_age_yr,
  max_draft_m, max_loa_m, review_status
) values ${cargoSeeds.map(cargoInsert).join(",\n")};
insert into public.vessels(
  id, vessel_name, vessel_type, dwt_grain, build_year, is_geared,
  grain_certified, dg_certified, max_loa_m, max_draft_m, is_sanctioned
) values ${allSeeds.map(vesselInsert).join(",\n")};
insert into public.vessel_availability(
  id, vessel_id, open_port_name, open_zone, open_date, freight_idea_usd_mt,
  accepts_part_cargo, status, review_status
) values ${allSeeds.map(availabilityInsert).join(",\n")};
with fixtures(name, cargo_id, availability_id) as (values ${pairValues}),
pair_results as (
  select f.name, e.*
  from fixtures f
  left join lateral public.fn_matching_evaluate(
    ${quote(rulesJson)}::jsonb, ${MATCHING_SQL_GOLDEN_V1.asOfYear},
    f.cargo_id, f.availability_id
  ) e on true
), decimal_result as (
  select e.* from public.fn_matching_evaluate(
    ${quote(decimalRulesJson)}::jsonb, ${MATCHING_SQL_GOLDEN_V1.asOfYear},
    ${quote(decimalSeed.cargoId)}::uuid, ${quote(decimalSeed.availabilityId)}::uuid
  ) e
)
select jsonb_build_object(
  'pairs', (select jsonb_agg(jsonb_build_object(
    'name', name, 'eligible', cargo_id is not null, 'scorePoints', score,
    'scoreLabel', score_label, 'displayLabel', case when cargo_id is null then 'Weak' else score_label end,
    'rateAligned', is_rate_aligned, 'dwtDeltaMt', dwt_delta
  ) order by name) from pair_results),
  'ranking', (select jsonb_agg(vessel_avail_id order by is_rate_aligned desc, dwt_delta, vessel_avail_id)
    from public.fn_matching_evaluate(${quote(rulesJson)}::jsonb, ${MATCHING_SQL_GOLDEN_V1.asOfYear}, ${quote(rankingCargoId)}::uuid, null)
    where vessel_avail_id = any(array[${rankingIds}])),
  'decimalBoundary', (select coalesce(bool_or(is_rate_aligned), false) from decimal_result)
)::text;
rollback;
`;

const execution = spawnSync(
  "docker",
  ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-At"],
  { input: sql, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
if (execution.status !== 0) {
  throw new Error(`SQL parity driver failed:\n${execution.stderr || execution.stdout}`);
}
const payload = JSON.parse(execution.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "null") as {
  pairs: Array<Record<string, unknown>>;
  ranking: string[];
  decimalBoundary: boolean;
};

const rules = parseMatchingRulesV1(MATCHING_SQL_GOLDEN_V1.rules);
const expectedPairs = MATCHING_SQL_GOLDEN_V1.pairs.map((fixture) => {
  const result = evaluatePairMatch(fixture.cargo, fixture.vessel, rules, fixture.context);
  assert.equal(
    pairEligible(fixture.cargo, fixture.vessel, rules, fixture.context),
    result.eligible,
    `${fixture.name}: pairEligible disagrees with evaluatePairMatch`,
  );
  return {
    name: fixture.name,
    eligible: result.eligible,
    scorePoints: result.eligible ? result.score.points : null,
    scoreLabel: result.eligible ? result.score.label : null,
    displayLabel: result.displayLabel,
    rateAligned: result.eligible ? result.rank.rateAligned : null,
    dwtDeltaMt: result.eligible ? result.rank.dwtDeltaMt : null,
  };
}).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
payload.pairs.sort((left, right) => {
  const leftName = String(left.name);
  const rightName = String(right.name);
  return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
});
assert.deepEqual(payload.pairs, expectedPairs, "real SQL pair evaluation differs from TypeScript");

const expectedRankIds = rankEligibleMatches(
  MATCHING_SQL_GOLDEN_V1.ranking.cargo,
  rankingSeeds.map((seed) => ({ ...seed.vessel, availabilityId: seed.availabilityId })),
  rules,
  MATCHING_SQL_GOLDEN_V1.ranking.context,
).map((result) => result.availabilityId);
assert.deepEqual(payload.ranking, expectedRankIds, "real SQL ranking differs from TypeScript for the same identifiers");
assert.equal(payload.decimalBoundary, true, "SQL rejected the inclusive 20.8 - 20.7 <= 0.1 boundary");
assert.equal(
  evaluatePairMatch(decimalSeed.cargo, decimalSeed.vessel, parseMatchingRulesV1({
    ...MATCHING_SQL_GOLDEN_V1.rules,
    rateAlignmentUsd: 0.1,
  }), MATCHING_SQL_GOLDEN_V1.pairs[0].context).rank.rateAligned,
  true,
  "TypeScript rejected the inclusive decimal boundary",
);

console.log(`MATCHING SQL PARITY: ${expectedPairs.length} pairs, ranking and decimal boundary passed`);
