import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildPdaEstimatorCatalog,
  markPdaEstimatorCatalogUnavailable,
  parsePdaEstimatorHandoff,
  resolvePdaEstimatorBootstrap,
  type PdaEstimatorPortOption,
} from "../lib/pda/estimator-contract";
import { isExactLoopbackUrl } from "../lib/pda/local-test-url";
import type { CargoView, VesselView } from "../lib/portal/types";

const ports: PdaEstimatorPortOption[] = [
  { locode: "EGALY", name: "Alexandria", country: "Egypt" },
  { locode: "SAJED", name: "Jeddah", country: "Saudi Arabia" },
];

const vessel = {
  id: "availability-1",
  vesselId: "vessel-1",
  name: "MV BALTIC STAR",
  imo: "9123456",
  type: "Bulk Carrier",
  flag: "PA",
  dwt: "28,500",
  grainCap: "",
  built: 2012,
  age: 14,
  geared: true,
  grainCertified: true,
  dgCertified: false,
  openPort: "Alexandria",
  openPortLocode: "EGALY",
  openPortZone: "E.MED",
  openDate: "2026-09-27",
  openDateUrgency: "green",
  openDateDays: 0,
  status: "open",
  matches: 1,
  fuel: { vlsfoSea: 0, vlsfoPort: 0, lsmgoSea: 0, lsmgoPort: 0 },
  gt: 17_000,
  scnrt: 11_000,
  loaM: 172,
  serviceSpeed: 12.5,
} satisfies VesselView;

const cargo = {
  id: "cargo-1",
  refId: "cargo-ref-1",
  cargo: "Wheat, Bulk",
  commodity: "Wheat",
  type: "Dry Bulk",
  scope: "in",
  route: {
    polName: "Alexandria",
    polCode: "EGALY",
    polZone: "E.MED",
    podName: "Jeddah",
    podCode: "SAJED",
    podZone: "R.SEA",
  },
  portScope: { polScope: "port", podScope: "port", polRef: "EGALY", podRef: "SAJED" },
  qty: { min: 25_000, max: 27_500 },
  qtyMt: "25,000-27,500 MT",
  vol: "",
  sf: null,
  imsbcGroup: "",
  laycanFrom: "2026-10-06",
  laycanTo: "2026-10-16",
  laycanDays: 10,
  loadTerms: "FIOST",
  loadRate: 1_200,
  dischRate: 1_200,
  freightIdea: null,
  commission: null,
  demurrage: null,
  matches: 1,
} satisfies CargoView;

const catalog = buildPdaEstimatorCatalog({ vessels: [vessel], cargos: [cargo], ports });
assert.equal(catalog.vessels[0]?.vesselId, "vessel-1");
assert.equal(catalog.cargos[0]?.loadPort.locode, "EGALY");

const parsed = parsePdaEstimatorHandoff({
  from: "fixture",
  ref: "room-1",
  cargoId: "cargo-1",
  vesselId: "vessel-1",
  vessel: "ignored because the id wins",
  load: "egaly",
  disch: "sajed",
  mt: "27,500",
});
assert.deepEqual(parsed, {
  from: "fixture",
  ref: "room-1",
  cargoId: "cargo-1",
  vesselId: "vessel-1",
  vesselName: "ignored because the id wins",
  loadPortLocode: "EGALY",
  dischargePortLocode: "SAJED",
  quantityMt: 27_500,
  supplied: true,
});

const resolved = resolvePdaEstimatorBootstrap(catalog, {
  from: "fixture",
  ref: "room-1",
  cargoId: "cargo-ref-1",
  vesselId: "vessel-1",
});
assert.equal(resolved.catalogState, "ready");
assert.deepEqual(resolved.initial, {
  vesselId: "availability-1",
  cargoId: "cargo-1",
  loadPortLocode: "EGALY",
  dischargePortLocode: "SAJED",
  quantityMt: 27_500,
  allocation: "vessel",
  density: "compact",
  from: "fixture",
  ref: "room-1",
});
assert.equal(resolved.notices.length, 0);

const unauthorized = resolvePdaEstimatorBootstrap(catalog, {
  from: "fixture",
  cargoId: "not-visible",
  vesselId: "not-visible",
  load: "XXXXX",
  disch: "USNYC",
  mt: "-1",
});
assert.equal(unauthorized.initial.cargoId, null);
assert.equal(unauthorized.initial.vesselId, null);
assert.equal(unauthorized.initial.loadPortLocode, null);
assert.equal(unauthorized.initial.dischargePortLocode, null);
assert.equal(unauthorized.initial.quantityMt, null);
assert.deepEqual(
  unauthorized.notices.map((notice) => notice.code),
  [
    "HANDOFF_CARGO_NOT_FOUND",
    "HANDOFF_VESSEL_NOT_FOUND",
    "HANDOFF_LOAD_PORT_NOT_FOUND",
    "HANDOFF_DISCHARGE_PORT_NOT_FOUND",
    "HANDOFF_QUANTITY_INVALID",
  ],
);

const byName = resolvePdaEstimatorBootstrap(catalog, { from: "fixture", vessel: "mv baltic star" });
assert.equal(byName.initial.vesselId, "availability-1");

const missingSource = resolvePdaEstimatorBootstrap(catalog, {
  cargoId: "cargo-1",
  vesselId: "vessel-1",
  load: "EGALY",
  disch: "SAJED",
  mt: "27,500",
});
assert.deepEqual(missingSource.initial, {
  vesselId: null,
  cargoId: null,
  loadPortLocode: null,
  dischargePortLocode: null,
  quantityMt: null,
  allocation: "vessel",
  density: "compact",
  from: null,
  ref: null,
});
assert.deepEqual(missingSource.notices.map((notice) => notice.code), ["HANDOFF_SOURCE_IGNORED"]);

const unsupportedSource = resolvePdaEstimatorBootstrap(catalog, {
  from: "email",
  ref: "must-not-apply",
  cargoId: "cargo-1",
  vesselId: "vessel-1",
});
assert.equal(unsupportedSource.initial.cargoId, null);
assert.equal(unsupportedSource.initial.vesselId, null);
assert.equal(unsupportedSource.initial.ref, null);
assert.deepEqual(unsupportedSource.notices.map((notice) => notice.code), ["HANDOFF_SOURCE_IGNORED"]);

const rangedCatalog = buildPdaEstimatorCatalog({
  vessels: [vessel],
  cargos: [{
    ...cargo,
    portScope: { ...cargo.portScope, polScope: "options", podScope: "area" },
  }],
  ports,
});
const ranged = resolvePdaEstimatorBootstrap(rangedCatalog, { from: "fixture", cargoId: "cargo-1" });
assert.deepEqual(
  ranged.notices.map((notice) => notice.code),
  ["CARGO_LOAD_PORT_NEEDS_CHOICE", "CARGO_DISCHARGE_PORT_NEEDS_CHOICE"],
);
assert.equal(ranged.initial.loadPortLocode, null);
assert.equal(ranged.initial.dischargePortLocode, null);

const rangedWithExplicitPorts = resolvePdaEstimatorBootstrap(rangedCatalog, {
  from: "fixture",
  cargoId: "cargo-1",
  load: "EGALY",
  disch: "SAJED",
});
assert.equal(rangedWithExplicitPorts.initial.loadPortLocode, "EGALY");
assert.equal(rangedWithExplicitPorts.initial.dischargePortLocode, "SAJED");
assert.equal(rangedWithExplicitPorts.notices.length, 0);

const unavailable = markPdaEstimatorCatalogUnavailable(resolved);
assert.equal(unavailable.catalogState, "unavailable");
assert.equal(unavailable.catalog.vessels.length, 0);
assert.equal(unavailable.catalog.cargos.length, 0);
assert.equal(unavailable.initial.vesselId, null);
assert.equal(unavailable.initial.cargoId, null);
assert.deepEqual(unavailable.notices.map((notice) => notice.code), ["LIVE_CATALOG_UNAVAILABLE"]);

const vesselSdk = readFileSync(new URL("../sdk/app/vessels.ts", import.meta.url), "utf8");
assert.match(vesselSdk, /gross_tonnage, scnrt, max_loa_m/);
const portalAdapters = readFileSync(new URL("../lib/portal/adapters.ts", import.meta.url), "utf8");
assert.match(portalAdapters, /gt:\s*vv\.gross_tonnage\s*\?\?\s*null/);

assert.equal(isExactLoopbackUrl("http://localhost:54321"), true);
assert.equal(isExactLoopbackUrl("https://127.0.0.1/path"), true);
assert.equal(isExactLoopbackUrl("http://[::1]:54321"), true);
assert.equal(isExactLoopbackUrl("https://localhost.attacker.example"), false);
assert.equal(isExactLoopbackUrl("https://127.0.0.1.attacker.example"), false);
assert.equal(isExactLoopbackUrl("https://attacker.example/?next=http://localhost"), false);
assert.equal(isExactLoopbackUrl("not a URL mentioning localhost"), false);

console.log("PDA ESTIMATOR CONTRACT CHECK: ALL ASSERTIONS PASSED");
