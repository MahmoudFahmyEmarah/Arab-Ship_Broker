import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { MATCHING_RULES_V1_DEFAULT_PAYLOAD } from "../lib/matching-rules/defaults";
import {
  boundedAuthoritativeMatchSources,
  boundedAuthoritativeMatchSourcesForMode,
  buildAuthoritativeTopMatches,
  buildTopMatches,
  canUseClientMatchingMirror,
  fitLabel,
  loadBoundedAuthoritativeMatchBatches,
  matchingRuntimeFromSnapshot,
  pairEligible,
  selectCargoVesselMatches,
  selectUniqueAuthoritativeBatchPairs,
  LIVE_TOP_MATCH_CONCURRENCY_LIMIT,
  LIVE_TOP_MATCH_REQUEST_LIMIT,
} from "../lib/portal/matching";
import type { CargoView, VesselView } from "../lib/portal/types";

let passed = 0;
function check(value: unknown, message: string): asserts value {
  assert.ok(value, message);
  passed += 1;
}

const cargo = {
  id: "cargo-board-key",
  listingKey: "cargo-board-key",
  cargo: "Wheat",
  commodity: "Wheat",
  qtyMt: "100",
  route: {
    polName: "Load",
    polCode: "LOAD",
    polZone: "LOAD",
    podName: "Discharge",
    podCode: "DISCH",
    podZone: "DISCH",
  },
  laycanDays: 2,
  matchingFacts: {
    cargoId: "cargo-board-key",
    reviewStatus: "APPROVED",
    status: "IN",
    qtyMinMt: 80,
    qtyMaxMt: 100,
    cargoType: "Dry Bulk",
    isSpot: true,
    laycanFromDay: null,
    requiresGeared: false,
    isGrainCargo: false,
    isDgCargo: false,
    maxVesselAgeYr: null,
    maxDraftM: null,
    maxLoaM: null,
    loadZone: "LOAD",
    dischZone: "DISCH",
    freightIdeaUsdMt: 50,
  },
} as CargoView;

function vessel(id: string, dwt: number): VesselView {
  return {
    id,
    listingKey: id,
    name: id,
    dwt: String(dwt),
    type: "Bulk Carrier",
    openPortZone: "LOAD",
    matchingFacts: {
      availabilityId: id,
      availabilityStatus: "OPEN",
      availabilityReviewStatus: "APPROVED",
      isSanctioned: false,
      dwtGrainMt: dwt,
      vesselType: "Bulk Carrier",
      openZone: "LOAD",
      openDateDay: null,
      acceptsPartCargo: false,
      isGeared: true,
      grainCertified: true,
      dgCertified: true,
      buildYear: null,
      maxDraftM: null,
      maxLoaM: null,
      freightIdeaUsdMt: 50,
    },
  } as VesselView;
}

const first = vessel("vessel-board-first", 100);
const authorised = vessel("vessel-board-authorised", 105);
const rulesBase = {
  asOfYear: 2026,
  activeVersionId: "00000000-0000-4000-8000-000000000001",
  paramsSha256: "0".repeat(64),
  rules: MATCHING_RULES_V1_DEFAULT_PAYLOAD,
};
const sample = matchingRuntimeFromSnapshot({ ...rulesBase, source: "sample" });
const live = matchingRuntimeFromSnapshot({ ...rulesBase, source: "live" });
assert.ok(sample && live);

// Popover failure contract: a live rules document never authorises the local
// mirror as an RPC fallback.
check(canUseClientMatchingMirror(sample), "sample mode enables the mirror");
check(!canUseClientMatchingMirror(live), "live mode refuses the mirror after an RPC failure");
check(!pairEligible(cargo, first, live), "live eligibility cannot be evaluated locally");
check(fitLabel(cargo, first, live) === null, "live fit cannot be evaluated locally");

// Top Matches contract: the sample builder fails closed for live runtimes;
// already-authorised pairs retain RPC order and carry a neutral live badge.
check(buildTopMatches([cargo], [first], (v) => v.type, live).length === 0,
  "Top Matches does not run the mirror in live mode");
const governedTop = buildAuthoritativeTopMatches(
  [{ cargo, vessel: authorised }],
  (v) => v.type,
);
check(governedTop.length === 1 && governedTop[0]?.vesselId === authorised.id,
  "Top Matches formats only the authoritative pair");
check(governedTop[0]?.quality === "Matched", "live Top Matches uses a neutral governed badge");

const manySources = Array.from({ length: LIVE_TOP_MATCH_REQUEST_LIMIT + 4 }, (_, index) => ({
  id: `source-${index}`,
  listingKey: index === 0 ? null : `listing-${index}`,
  matches: index === 1 ? 0 : 1,
}));
const boundedSources = boundedAuthoritativeMatchSources(manySources);
check(boundedSources.length === LIVE_TOP_MATCH_REQUEST_LIMIT,
  "live Top Matches caps authoritative requests independently of listing count");
check(boundedSources.every((source) => source.listingKey && source.matches > 0),
  "live Top Matches requests only governed sources that advertise matches");

const cargoSources = manySources.map((source) => ({ ...cargo, ...source })) as CargoView[];
const vesselSources = manySources.map((source) => ({ ...first, ...source })) as VesselView[];
const selectedCargoSources = boundedAuthoritativeMatchSourcesForMode("cargo", cargoSources, vesselSources);
check(selectedCargoSources.length > 0 && selectedCargoSources.every((source) => cargoSources.includes(source)),
"cargo mode selects no vessel sources");
const selectedVesselSources = boundedAuthoritativeMatchSourcesForMode("vessel", cargoSources, vesselSources);
check(selectedVesselSources.length > 0 && selectedVesselSources.every((source) => vesselSources.includes(source)),
"vessel mode selects no cargo sources");

const calls: string[] = [];
let concurrent = 0;
let maxConcurrent = 0;
const batchPromise = loadBoundedAuthoritativeMatchBatches(manySources, async (listingKey) => {
  calls.push(listingKey);
  concurrent += 1;
  maxConcurrent = Math.max(maxConcurrent, concurrent);
  const sourceIndex = Number(listingKey.split("-").at(-1));
  await new Promise((resolveDelay) => setTimeout(resolveDelay, (10 - sourceIndex) * 2));
  concurrent -= 1;
  return [`row-${listingKey}`];
});

const asynchronousChecks = batchPromise.then(async (batchResult) => {
  check(batchResult.status === "ready" && batchResult.batches.length === LIVE_TOP_MATCH_REQUEST_LIMIT,
    "the behavioral loader makes no more than the fixed number of RPC calls");
  check(calls.length === LIVE_TOP_MATCH_REQUEST_LIMIT
    && maxConcurrent === LIVE_TOP_MATCH_CONCURRENCY_LIMIT,
  "the fixed requests use the bounded authoritative RPC pool");
  check(batchResult.status === "ready"
    && batchResult.batches.map((batch) => batch.source.listingKey).join(",")
      === boundedSources.map((source) => source.listingKey).join(","),
  "out-of-order completions preserve governed source order");

  let rejectionCalls = 0;
  const rejected = await loadBoundedAuthoritativeMatchBatches(
    manySources,
    async (listingKey) => {
      rejectionCalls += 1;
      if (listingKey === boundedSources[0]?.listingKey) throw new Error("RPC unavailable");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
      return [];
    },
  );
  check(rejected.status === "unavailable" && rejected.batches.length === 0,
    "one rejected authoritative RPC fails the whole batch closed");
  check(rejectionCalls <= LIVE_TOP_MATCH_CONCURRENCY_LIMIT,
    "a rejected RPC prevents later authoritative work from being scheduled");

  let obsolete = false;
  let discardedCalls = 0;
  const discarded = await loadBoundedAuthoritativeMatchBatches(
    manySources,
    async () => {
      discardedCalls += 1;
      obsolete = true;
      return [];
    },
    () => obsolete,
  );
  check(discarded.status === "discarded" && discarded.batches.length === 0,
    "a mode or filter change discards the completed stale batch");
  check(discardedCalls <= LIVE_TOP_MATCH_CONCURRENCY_LIMIT,
    "a stale batch stops scheduling later authoritative requests");

  let emptyCalls = 0;
  const empty = await loadBoundedAuthoritativeMatchBatches(
    [],
    async () => {
      emptyCalls += 1;
      return [];
    },
  );
  check(empty.status === "ready" && empty.batches.length === 0 && emptyCalls === 0,
    "an empty governed source set is ready without an RPC");

  const uniquePairs = selectUniqueAuthoritativeBatchPairs(
    [
      { source: "cargo-1", rows: ["vessel-2", "vessel-1"] },
      { source: "cargo-2", rows: ["vessel-2", "vessel-3"] },
      { source: "cargo-3", rows: ["vessel-4"] },
      { source: "cargo-4", rows: ["vessel-5"] },
    ],
    (row) => row,
    (counterpart) => counterpart,
  );
  check(JSON.stringify(uniquePairs) === JSON.stringify([
    { source: "cargo-1", counterpart: "vessel-2" },
    { source: "cargo-2", counterpart: "vessel-3" },
    { source: "cargo-3", counterpart: "vessel-4" },
  ]), "authoritative source and row order survive counterpart deduplication");
});

// DealCard and map lines share this selector. Loading/unavailable states draw
// and display nothing; ready accepts only ordered RPC handles, even when an
// omitted local candidate would have passed the mirror.
check(selectCargoVesselMatches(cargo, [first, authorised], live, { status: "loading", sourceId: cargo.id }).length === 0,
  "DealCard stays empty while governed matches load");
check(selectCargoVesselMatches(cargo, [first, authorised], live, { status: "unavailable", sourceId: cargo.id }).length === 0,
  "map lines stay empty when governed matches are unavailable");
const governedSurface = selectCargoVesselMatches(
  cargo,
  [first, authorised],
  live,
  { status: "ready", sourceId: cargo.id, ids: [authorised.id] },
);
check(governedSurface.length === 1 && governedSurface[0]?.vessel.id === authorised.id,
  "DealCard and map lines use only authoritative board handles");
check(governedSurface[0]?.fit === null, "live surfaces do not invent a mirror fit label");
check(selectCargoVesselMatches(cargo, [first], sample, { status: "sample", sourceId: cargo.id }).length === 1,
  "sample surfaces retain the local mirror experience");
check(selectCargoVesselMatches(
  cargo,
  [authorised],
  live,
  { status: "ready", sourceId: "previous-cargo", ids: [authorised.id] },
).length === 0, "stale governed results cannot cross into a newly opened cargo");

// Keep the component wiring under regression coverage without a browser or a
// database: each surface must consume the central fail-closed contracts.
const popover = readFileSync(resolve("components/portal/MatchesPopover.tsx"), "utf8");
const boards = readFileSync(resolve("components/portal/boards.tsx"), "utf8");
const map = readFileSync(resolve("components/portal/MarketMap.tsx"), "utf8");
const matchingSource = readFileSync(resolve("lib/portal/matching.ts"), "utf8");
const dealCard = map.slice(map.indexOf("function DealCard"));
const mapLines = map.slice(map.indexOf("// Match lines (P4)"), map.indexOf("// Trade-lane flows (P5)"));

check(/catch \{[\s\S]*?!canUseClientMatchingMirror\(matching\)/.test(popover),
  "MatchesPopover live RPC failures use the fail-closed gate");
check(/matching\?\.source === "sample"[\s\S]*?\? buildTopMatches/.test(boards),
  "Top Matches invokes the mirror only behind the sample gate");
check(/listMarketMatches/.test(boards) && /buildAuthoritativeTopMatches/.test(boards),
  "live Top Matches uses authoritative RPC rows");
check(/boundedAuthoritativeMatchSourcesForMode/.test(boards)
  && /loadBoundedAuthoritativeMatchBatches/.test(boards),
"live Top Matches uses the behaviorally tested active-mode batch coordinator");
check(!/for \(const (?:cargo|vessel) of filtered(?:Cargos|Vessels)\)[\s\S]{0,180}await listMarketMatches/.test(boards),
  "live Top Matches has no unbounded serial RPC loop");
check(!/calcVoyage|\btce\b/i.test(matchingSource) && !/fmtTce|>TCE\b/.test(boards),
  "match cards contain no legacy voyage or TCE calculation");
check(/Open Voyage Estimator/.test(boards)
  && /voyage-estimator\?cargo=\$\{encodeURIComponent\(m\.cargoId\)\}&vessel=\$\{encodeURIComponent\(m\.vesselId\)\}/.test(boards),
"match cards link visible cargo and vessel handles to the governed estimator");
check(/liveTopMatchesAreCurrent[\s\S]*?: "loading"/.test(boards),
  "Top Matches hides stale results while a changed filter query reloads");
check(!/pairEligible|buildTopMatches/.test(dealCard) && /matches: readonly SurfaceVesselMatch\[\]/.test(dealCard),
  "DealCard consumes resolved governed matches without local evaluation");
check(!/pairEligible|buildTopMatches/.test(mapLines) && /popupVesselMatches/.test(mapLines),
  "map lines consume the same governed matches without local evaluation");

void asynchronousChecks
  .then(() => console.log(`matching live surfaces checks: ${passed} passed, 0 failed`))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
