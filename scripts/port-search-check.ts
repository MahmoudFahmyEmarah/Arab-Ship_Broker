// The shared port search (lib/ports/port-search.ts) and where it must be used instead of a typed LOCODE or an
// unsearchable list (owner, 19 Oct 2026). Pure + static checks. Run: node --import tsx scripts/port-search-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { exactPortMatch, filterPorts, findPort, foldPortText, normLocode, portLabel, type PortChoice } from "../lib/ports/port-search";

let n = 0;
const ok = (c: boolean, m: string) => { assert.ok(c, m); n++; };

const ports: PortChoice[] = [
  { locode: "EGALY", name: "Alexandria", country: "Egypt" },
  { locode: "EGDAM", name: "Damietta", country: "Egypt" },
  { locode: "EGPSD", name: "Port Said", country: "Egypt" },
  { locode: "ROCND", name: "Constanța", country: "Romania" },
  { locode: "TRMER", name: "Mersin", country: "Türkiye" },
  { locode: "DZMOS", name: "Mostaganem", country: "Algeria" },
  { locode: "GRPIR", name: "Piraeus", country: "Greece" },
  { locode: "USALX", name: "Alexandria (VA)", country: "United States" },
];

// folding and codes
ok(foldPortText("Constanța") === "constanta", "accents fold");
ok(normLocode(" eg aly ") === "EGALY", "LOCODE normalised");
ok(portLabel(ports[0]) === "Alexandria · Egypt · EGALY", "label format");

// ranking
ok(filterPorts(ports, "EGALY")[0].locode === "EGALY", "exact LOCODE first");
ok(filterPorts(ports, "eg aly")[0].locode === "EGALY", "LOCODE with a space");
ok(filterPorts(ports, "EG").every((p) => p.locode.startsWith("EG")), "LOCODE prefix");
ok(filterPorts(ports, "constanta")[0].locode === "ROCND", "accent-insensitive name");
ok(filterPorts(ports, "said")[0].locode === "EGPSD", "word prefix inside a name");
ok(filterPorts(ports, "alex").map((p) => p.locode).join() === "EGALY,USALX", "name prefix, alphabetical tie");
ok(filterPorts(ports, "turkiye")[0].locode === "TRMER", "country match");
ok(filterPorts(ports, "zzzz").length === 0, "no match → empty");
ok(filterPorts(ports, "", 3).length === 3, "empty query → first N");
ok(filterPorts(ports, "e", 2).length === 2, "limit honoured");

// lookups
ok(findPort(ports, "grpir")?.name === "Piraeus", "findPort by code, case-insensitive");
ok(findPort(ports, "XXXXX") === null && findPort(ports, null) === null, "findPort misses");
ok(exactPortMatch(ports, "mostaganem")?.locode === "DZMOS", "exact name match");
ok(exactPortMatch(ports, "DZMOS")?.name === "Mostaganem", "exact code match");
ok(exactPortMatch(ports, "Alex") === null, "partial text never guessed");
ok(exactPortMatch([...ports, { locode: "XXALY", name: "Alexandria", country: "Elsewhere" }], "Alexandria") === null, "ambiguous name → no match");

// every form named in the owner's request uses the shared field — no hand-typed LOCODE inputs remain
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const tariffs = src("app/(admin)/admin/port-tariffs/page.tsx");
ok(!/name="portLocode"[^>]*maxLength=\{5\}/.test(tariffs) && (tariffs.match(/<PortSearchField name="portLocode"/g) ?? []).length === 2, "port tariffs: terminal + draft use the port search");
ok(!/placeholder="[^"]*UUID/.test(tariffs), "port tariffs: no pasted tariff-set / terminal / superseded-version UUIDs");
const prices = src("components/admin/bunker/PricesTab.tsx");
ok(!/name="portLocode"/.test(prices) && /<SupplierPortFields/.test(prices), "bunker price: supplier-scoped port search");
const suppliers = src("components/admin/bunker/SuppliersTab.tsx");
ok(!/name="ports" placeholder/.test(suppliers) && /<PortMultiField name="ports"/.test(suppliers), "bunker suppliers: multi-port search");
const dq = src("components/admin/data-quality/PortsView.tsx");
ok(!/placeholder="SARAR"/.test(dq) && /<PortSearchField/.test(dq), "data quality exception: port search");
const review = src("components/admin/data-sync/ManualReviewView.tsx");
ok(/exactPortMatch\(portOptions, openPort\)/.test(review) && /dsq-open-port-status/.test(review), "data sync review: live port-match status");
const pda = src("components/pda/PdaRouteEstimator.tsx");
ok(!/<option value="">Choose (load|discharge) port<\/option>/.test(pda) && (pda.match(/<PortSearchField /g) ?? []).length === 2, "PDA estimator: searchable load + discharge ports");

console.log(`PORT SEARCH: ALL ASSERTIONS PASSED (${n})`);
