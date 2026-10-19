// PDA · Agents phase 3 contract: an accepted agency quote becomes a new estimate version (O2ALL-009 A4). Pure + static.
//   node --import tsx scripts/pda-quote-acceptance-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  compareQuoteWithEstimate, isAgencyQuoteLeg, parsePdaQuoteAcceptanceContext, pdaAgencyQuoteLegResult, type PdaAcceptableQuote,
} from "../lib/pda/quote-acceptance";
import { aggregatePdaRoutePreview, derivePdaRouteTimeline } from "../lib/pda/route-calculate";
import type { PdaCalculationResult, PdaRequest } from "../lib/pda/types";

let n = 0;
function ok(condition: unknown, label: string) {
  assert.ok(condition, label);
  n += 1;
  console.log(`  ok   ${label}`);
}
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

// 1 · the quoted leg
const quote: PdaAcceptableQuote = {
  quoteId: "00000000-0000-4000-8000-0000000000a1", agencyName: "Seaside Agency", port: "EGALY", currency: "USD", total: 2050.5,
  revision: 2, reference: "AQ-17", validUntil: "2026-11-30",
  lines: [{ label: "Agency fee", serviceCode: "agency", amount: 1250.5 }, { label: "Stevedoring", serviceCode: "cargo_handling", amount: 800 }],
};
const request: PdaRequest = {
  portLocode: "EGALY", callDate: "2026-11-01", vessel: { vesselName: "MV TEST" },
  call: { days: 3, cargoQuantityMt: 26000, cargoStatus: "laden", voyageScope: "international", location: "alongside", requestedServices: ["agency"] },
};
const usdLeg = pdaAgencyQuoteLegResult(quote, { ...request, convertedCurrency: null, fxRate: null }, "2026-10-19T00:00:00.000Z");
ok(usdLeg.coverage === "manual_required" && usdLeg.tariffVersionId === null && usdLeg.nativeCurrency === "USD" && usdLeg.totals.native === 2050.5
  && usdLeg.convertedCurrency === undefined && usdLeg.totals.converted === undefined,
  "a quote in the display currency: no tariff version, quote currency, total = the quote's");
ok(usdLeg.lines.every((l) => l.basis === "agency_quote" && l.manual && l.enteredBy === "Seaside Agency" && l.ruleId === null)
  && usdLeg.lines.map((l) => `${l.ruleCode}:${l.amount}`).join() === "agency:1250.5,cargo_handling:800",
  "every line is an attributed agency_quote line in the quote's order, keyed by its service");
ok(/Agency quote from Seaside Agency \(ref AQ-17\), revision 2, valid until 2026-11-30/.test(usdLeg.lines[0]!.explanation)
  && usdLeg.warnings.length === 1 && usdLeg.warnings[0]!.code === "AGENCY_QUOTE", "the citation names agency, reference, revision and validity");
ok(isAgencyQuoteLeg(usdLeg) && !isAgencyQuoteLeg({ lines: [] }) && !isAgencyQuoteLeg({ lines: [{ ...usdLeg.lines[0]!, basis: "manual" }] }),
  "a leg is an agency quote only when every line is (never an empty or mixed leg)");
const eurLeg = pdaAgencyQuoteLegResult({ ...quote, currency: "EUR" }, { ...request, convertedCurrency: "USD", fxRate: 1.08 });
ok(eurLeg.convertedCurrency === "USD" && eurLeg.lines[0]!.convertedAmount === 1350.54 && eurLeg.totals.converted === 2214.54,
  "another currency converts per line with the governed rate, in cents; the total is the sum of the converted lines");
const noRate = pdaAgencyQuoteLegResult({ ...quote, currency: "EUR" }, { ...request, convertedCurrency: "USD", fxRate: null });
ok(noRate.convertedCurrency === undefined && noRate.totals.converted === undefined, "no governed rate = no conversion (the route then says FX_RATE_REQUIRED)");

// 2 · the route totals treat an agency-quoted port as sourced for the services it names
const timeline = derivePdaRouteTimeline(26000, { etaLoad: "2026-11-01T00:00:00.000Z", loadTurnDays: 1, loadProductivityMtPerDay: 13000, passageDistanceNm: 500, passageSpeedKnots: 12, dischargeTurnDays: 1, dischargeProductivityMtPerDay: 13000, dailyOpex: null });
const published = (native: number, services: string[]): PdaCalculationResult => ({
  coverage: "published", tariffVersionId: "00000000-0000-4000-8000-000000000021", nativeCurrency: "USD",
  lines: services.map((code) => ({ ruleId: "00000000-0000-4000-8000-000000000031", ruleCode: code, label: code, basis: "per_call" as const, quantity: 1, rate: native / services.length, amount: native / services.length, explanation: code, inputs: {}, serviceCodes: [code], manual: false, evidence: { sourceId: "00000000-0000-4000-8000-000000000032", title: "Tariff" } })),
  totals: { native }, warnings: [], generatedAt: "2026-10-19T00:00:00.000Z",
});
const canonical = { vesselAvailabilityId: "a", vesselId: null, cargoId: "c", quantityMt: 26000, loadRequest: request, dischargeRequest: { ...request, portLocode: "SAJED" } };
const route = (load: PdaCalculationResult, displayCurrency = "USD") => aggregatePdaRoutePreview({
  displayCurrency, allocation: "vessel", canonical, load, discharge: published(1000, ["agency", "cargo_handling"]), timeline,
  transitFacts: { measured: true, chokepoints: [], priced: [] },
});
const accepted = route(usdLeg);
ok(accepted.totals.loadPort === 2050.5 && accepted.totals.allInComplete === 3050.5 && !accepted.notSourced.some((i) => i.code === "load_port_total"),
  "a quote naming agency and cargo handling makes its port complete; no 'no published tariff' item");
const partial = route(pdaAgencyQuoteLegResult({ ...quote, lines: [quote.lines[0]!], total: 1250.5 }, request));
ok(partial.totals.loadPort === null && partial.totals.loadPortKnown === 1250.5 && partial.notSourced.some((i) => i.code === "load_cargo_handling"),
  "a quote that leaves out cargo handling is known but not complete, and says so");
const fx = route(noRate);
ok(fx.totals.loadPortKnown === null && fx.notSourced.find((i) => i.code === "load_port_total")?.reasonCode === "FX_RATE_REQUIRED",
  "a quote in another currency with no governed rate is NOT SOURCED for FX, never summed as if USD");
const plainManual = route({ ...usdLeg, lines: usdLeg.lines.map((l) => ({ ...l, basis: "manual" as const })) });
ok(plainManual.totals.loadPort === null, "member-typed manual lines without a tariff still do not count as complete (only an accepted agency quote does)");

// 3 · comparison and context
const cmp = compareQuoteWithEstimate({ currency: "USD", total: 2000 }, { currency: "USD", total: 2050.5 });
ok(cmp.comparable && cmp.difference === 50.5 && cmp.percent === 2.5, "same currency: the difference and its percentage");
ok(!compareQuoteWithEstimate({ currency: "EGP", total: 2000 }, { currency: "USD", total: 1 }).comparable
  && !compareQuoteWithEstimate({ currency: "USD", total: null }, { currency: "USD", total: 1 }).comparable,
  "another currency or an unknown estimate: no difference is claimed");
const ctx = parsePdaQuoteAcceptanceContext({ quoteId: "q", agencyName: "A", port: "EGALY", currency: "USD", total: "10", revision: 1, validUntil: "2026-12-01",
  lines: [{ label: "Agency", serviceCode: "agency", amount: "10" }], leg: "discharge", requestStatus: "open", setIsLatest: true, latestRevision: true, accepted: false, routeInput: { x: 1 } });
ok(ctx.leg === "discharge" && ctx.quote.total === 10 && ctx.setIsLatest && !ctx.accepted, "the service context is read strictly");
assert.throws(() => parsePdaQuoteAcceptanceContext({ quoteId: "q", agencyName: "A", currency: "usd", lines: [] }));
ok(true, "a context without lines or with a malformed currency is refused");

// 4 · the database
const migration = read("supabase/migrations/20261019110000_pda_quote_acceptance.sql");
const down = read("supabase/rollback/20261019110000_pda_quote_acceptance_down.sql");
const prior = read("supabase/migrations/20261019100000_pda_quote_requests.sql");
ok(/revoke all on table public\.pda_quote_acceptances from public, anon, authenticated, service_role;/.test(migration)
  && /grant execute on function public\.pda_accept_agency_quote\(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb\) to service_role;/.test(migration)
  && /grant execute on function public\.pda_quote_acceptance_context\(uuid, uuid\) to service_role;/.test(migration)
  && (migration.match(/to authenticated/g) ?? []).length === 1 && /list_agency_pda_quote_requests\(\) to authenticated, service_role;/.test(migration)
  && /revoke all on function public\.fn_pda_leg_matches_quote\(jsonb, jsonb, uuid, text\) from public, anon, authenticated;/.test(migration),
  "no table grant; acceptance functions service-only (the saved route input never reaches a member's API); only the inbox read stays a member call");
ok(/'manual_quote','manual','agency_quote'/.test(migration) && /basis <> 'agency_quote' or \(is_manual and tariff_rule_id is null and source_id is null\)/.test(migration)
  && /'manual_quote','manual'\n  \)\);/.test(down) && /basis = 'agency_quote'/.test(down),
  "saved lines accept agency_quote only as manual lines with no tariff rule or source; the DOWN restores the old check and refuses while such lines exist");
ok(/request_id\s+uuid not null unique/.test(migration) && /set_id\s+uuid not null unique/.test(migration) && /before truncate on public\.pda_quote_acceptances/.test(migration),
  "one acceptance per request and per set; append-only, TRUNCATE refused");
const accept = migration.slice(migration.indexOf("create or replace function public.pda_accept_agency_quote"));
ok(/r\.requester_user_id is distinct from p_actor/.test(accept) && /q\.valid_until < current_date/.test(accept) && /x\.revision > q\.revision/.test(accept)
  && /r\.status <> 'open'/.test(accept), "only the requester, an open request, a valid quote and its latest revision");
const matches = migration.slice(migration.indexOf("create or replace function public.fn_pda_leg_matches_quote"), migration.indexOf("create or replace function public.pda_quote_acceptance_context"));
ok(/with ordinality/.test(matches) && /'agency_quote'/.test(matches) && /is distinct from q\.total/.test(matches) && /<> q\.currency/.test(matches)
  && /enteredBy' is distinct from v_agency/.test(matches) && /fn_pda_fx_rate\(q\.currency, v_conv/.test(matches) && /round\(\(l->>'amount'\)::numeric \* v_rate, 2\)/.test(matches),
  "a leg is the quote only line by line (amount, label, service, attribution), currency and total, with converted figures only at the governed rate");
ok(/fn_pda_leg_matches_quote\(v_req, v_res, q\.id, r\.port_locode\)/.test(accept) && /fn_pda_leg_matches_quote\(v_other_req, v_other, v_carried, v_carried_port\)/.test(accept)
  && /must keep it/.test(accept), "the other port carries agency lines only as the earlier accepted quote of the request's set, and must keep it (P1-2)");
ok(/a\.status = 'active'\) then\n    raise exception 'PDA_STATE: this agency is suspended/.test(accept) && /\(p_route->'routeInput'\) is distinct from \(select s\.route_input/.test(accept),
  "a suspended agency's quote is refused; the new version keeps the saved route input");
ok(/before insert on public\.pda_agency_quotes/.test(migration) && /before update on public\.pda_quote_request_recipients/.test(migration)
  && /before update on public\.pda_quote_requests/.test(migration) && /then 'accepted'/.test(migration),
  "a request with an accepted quote is closed (no new revision, decline or withdraw); the inbox says accepted (P1-1)");
ok(/pda_save_estimate_set\(p_actor, p_owner_org_id,[\s\S]*r\.set_id\)/.test(accept) && /'pda\.quote_accepted'/.test(accept),
  "the new version supersedes the set the request came from, through the governed save; the agency is notified");
const restored = down.slice(down.indexOf("create or replace function public.fn_pda_recipient_quotes"), down.indexOf("revoke all on function public.fn_pda_recipient_quotes"));
const original = prior.slice(prior.indexOf("create or replace function public.fn_pda_recipient_quotes"), prior.indexOf("revoke all on function public.fn_pda_recipient_quotes"));
ok(restored.length > 100 && restored === original, "the DOWN restores fn_pda_recipient_quotes byte for byte");
const inboxOf = (t: string) => t.slice(t.indexOf("create or replace function public.list_agency_pda_quote_requests"), t.indexOf("grant execute on function public.list_agency_pda_quote_requests"));
ok(inboxOf(down).length > 100 && inboxOf(down) === inboxOf(prior), "the DOWN restores list_agency_pda_quote_requests byte for byte");
ok(/PDA_DOWN_REFUSED/.test(down) && /history-exported:/.test(down) && !/\\(gset|if|echo|endif)\b/.test(migration + down), "the DOWN refuses while acceptances exist; plain SQL");

// 5 · the server and the page
const actions = read("app/(dashboard)/dashboard/ports-da/actions.ts");
const build = actions.slice(actions.indexOf("async function buildQuoteAcceptance"), actions.indexOf("export interface PdaQuoteAcceptancePreview"));
ok(/getPdaQuoteAcceptanceContext\(getSupabaseAdminClient\(\), appUser\.id, quoteId\)/.test(build) && /prepareRoutePreview\(context\.routeInput/.test(build)
  && /computeRouteFrame\(route\)/.test(build), "the route is rebuilt on the server from the saved set's own input, re-validated like any preview");
const preview = actions.slice(actions.indexOf("export async function previewPdaQuoteAcceptance"), actions.indexOf("export async function acceptPdaQuote"));
ok(!/routeInput|context,|quoteId:|setId/.test(preview.slice(preview.indexOf("return { ok: true"))), "the preview returns figures only: no route input, quote or set id");
const acceptAction = actions.slice(actions.indexOf("export async function acceptPdaQuote"));
ok(/context\.carried\?\.leg === side \? computeQuotedLeg\(route, side, context\.carried\.quote\)/.test(build) && /!context\.agencyActive/.test(build),
  "the server re-prices an earlier accepted port from its quote and refuses a suspended agency");
ok(/sameFigure\(expected\.allInKnown, result\.totals\.allInKnown\)/.test(acceptAction) && /acceptPdaAgencyQuote\(getSupabaseAdminClient\(\)/.test(acceptAction),
  "accepting refuses if the figures moved since the member's confirmation, then uses the service-only command");
const quotedLeg = actions.slice(actions.indexOf("async function computeQuotedLeg"), actions.indexOf("async function buildQuoteAcceptance"));
ok(/manualLines: undefined/.test(quotedLeg) && /forDisplayCurrency\(route\.supabase, canonical, quote\.currency/.test(quotedLeg),
  "the quoted port drops the member's own manual lines and converts the quote only with a governed rate");
const ui = read("components/pda/PdaQuoteRequests.tsx");
ok(/Accept as new version/.test(ui) && /Save the new version/.test(ui) && /The current version stays in your history/.test(ui),
  "the member confirms a new version and is told the old one stays");
ok(/acceptPdaQuote\(confirm\.quoteId, confirm\.preview\.totals\)/.test(ui), "the page sends the figures it showed, so a moved figure is refused");
const pdf = read("lib/pda/estimate-set-pdf.ts");
ok(/Priced from an accepted agency quote \(not a published tariff\)/.test(pdf), "the PDF says a port is priced from an accepted agency quote");

console.log(`\nPDA quote acceptance: ${n} checks passed`);
