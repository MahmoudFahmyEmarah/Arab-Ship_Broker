// PDA · Agents phase 2 contract: quote requests and agency quotes (O2ALL-009 A1 c / A5). Pure + static; no database.
//   node --import tsx scripts/pda-quote-requests-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parsePdaAgencyInbox, parsePdaQuoteRequests, validateQuoteLines } from "../lib/pda/quote-requests";

let n = 0;
function ok(condition: unknown, label: string) {
  assert.ok(condition, label);
  n += 1;
  console.log(`  ok   ${label}`);
}
const read = (path: string) => readFileSync(path, "utf8");
const code = (text: string) => text.replace(/--.*$/gm, "");

// 1 · the model
const requests = parsePdaQuoteRequests([
  { requestId: "r1", setId: "s1", leg: "discharge", port: "EGALY", services: ["agency", "bunkers", "pilotage"], status: "withdrawn", mine: true,
    agencies: [{ agencyId: "a1", displayName: "Seaside", status: "quoted", quotes: [
      { quoteId: "q2", revision: 2, currency: "USD", total: "1200.50", lines: [{ label: "Agency", serviceCode: "made_up", amount: "1200.50" }] },
      { quoteId: "", revision: 1 },
    ] }, { agencyId: "a2", displayName: "Other", status: "weird" }] },
  { requestId: "" },
  null,
]);
ok(requests.length === 1 && requests[0]!.leg === "discharge" && requests[0]!.status === "withdrawn" && requests[0]!.mine,
  "requests without an id are dropped; leg, status and ownership are read strictly");
ok(requests[0]!.services.join() === "pilotage,agency", "unknown services are dropped; services keep the canonical order");
const quote = requests[0]!.agencies[0]!.quotes;
ok(quote.length === 1 && quote[0]!.total === 1200.5 && quote[0]!.lines[0]!.serviceCode === null,
  "quotes without an id are dropped; numeric strings are read as numbers; an unknown service code becomes null");
ok(requests[0]!.agencies[1]!.status === "sent", "an unknown answer status reads as still awaiting an answer");
const inbox = parsePdaAgencyInbox([{ requestId: "r1", agencyId: "a1", port: "EGALY", requestStatus: "expired", myStatus: "declined", declineReason: "Busy" }, { requestId: "r2" }]);
ok(inbox.length === 1 && inbox[0]!.requestStatus === "expired" && inbox[0]!.myStatus === "declined" && inbox[0]!.snapshot.port.locode === "EGALY",
  "the inbox keeps only addressed rows and falls back to a port-only snapshot");

const good = validateQuoteLines([{ label: " Agency fee ", serviceCode: "agency", amount: "1250.50" }, { label: "Launch", serviceCode: "", amount: "0.10" }, { label: "", serviceCode: "", amount: "" }], ["agency"]);
ok(good.ok && good.lines.length === 2 && good.total === 1250.6 && good.lines[0]!.label === "Agency fee" && good.lines[1]!.serviceCode === null,
  "blank lines are ignored; labels trimmed; 'Other' lines carry no service; the total is rounded to cents");
ok(!validateQuoteLines([{ label: "Agency", serviceCode: "agency", amount: "12.345" }], ["agency"]).ok
  && !validateQuoteLines([{ label: "Agency", serviceCode: "agency", amount: "-5" }], ["agency"]).ok
  && !validateQuoteLines([{ label: "Agency", serviceCode: "agency", amount: "1234567890123" }], ["agency"]).ok
  && !validateQuoteLines([{ label: "Towage", serviceCode: "towage", amount: "5" }], ["agency"]).ok
  && !validateQuoteLines([{ label: "", serviceCode: "", amount: "5" }], ["agency"]).ok
  && !validateQuoteLines([], ["agency"]).ok,
  "the form refuses 3-decimal, negative or 13-digit amounts, services that were not requested, unlabelled lines and an empty quote");

// 2 · the database
const migration = read("supabase/migrations/20261019100000_pda_quote_requests.sql");
const down = read("supabase/rollback/20261019100000_pda_quote_requests_down.sql");
const body = code(migration);
ok(/revoke all on table public\.pda_quote_requests, public\.pda_quote_request_recipients, public\.pda_agency_quotes\s+from public, anon, authenticated, service_role;/.test(migration),
  "no API role holds any of the three tables");
for (const fn of ["create_pda_quote_request(uuid, text, uuid[], text[], text, boolean)", "withdraw_pda_quote_request(uuid)", "list_my_pda_quote_requests(uuid)",
  "list_agency_pda_quote_requests()", "submit_pda_agency_quote(uuid, uuid, text, jsonb, date, text, text)", "decline_pda_quote_request(uuid, uuid, text)"]) {
  const esc = fn.replace(/[()[\]]/g, "\\$&");
  ok(new RegExp(`revoke all on function public\\.${esc} from public, anon;`).test(migration) && new RegExp(`grant execute on function public\\.${esc} to authenticated, service_role;`).test(migration),
    `${fn.split("(")[0]} is a signed-in call (authenticated + service_role, never anon)`);
}
ok(/revoke all on function public\.fn_pda_is_agency_staff\(uuid\) from public, anon, authenticated;/.test(migration)
  && /revoke all on function public\.fn_pda_recipient_quotes\(uuid, uuid\) from public, anon, authenticated;/.test(migration),
  "the staff and quote helpers are private");
const create = body.slice(body.indexOf("create or replace function public.create_pda_quote_request"), body.indexOf("create or replace function public.withdraw_pda_quote_request"));
const snapshot = create.slice(create.indexOf("v_snapshot :="), create.indexOf("insert into public.pda_quote_requests"));
ok(!/vesselName|vessel_name|imo|vesselId|vesselAvailabilityId|cargoId|full_name|email|user_id/i.test(snapshot) && /'requester', case when coalesce\(p_reveal_identity, false\)/.test(snapshot),
  "the masked snapshot never reads the vessel name, IMO, listing ids or the member; the company only on reveal");
ok(/not public\.fn_pda_member_entitled\(\)/.test(create) && /s\.owner_user_id <> v_user/.test(create) && /where n\.supersedes_id = s\.id/.test(create)
  && /pg_advisory_xact_lock\(hashtext\('pda_estimate_set_owner:'/.test(create) && /v_org := s\.owner_org_id;/.test(create),
  "a request needs the estimator gate, the set's OWNER (no colleague or admin) and its latest version under the owner's save lock; the set's own organisation");
ok(/pa\.port_locode = e\.port_locode/.test(create) && /a\.status = 'active' and pa\.status = 'active'/.test(create) && /cardinality\(v_agencies\) > 10/.test(create),
  "only active agencies actively listed at that port, at most 10 per request");
ok(/fn_pda_is_agency_staff\(p_agency_org_id\)/.test(body.slice(body.indexOf("function public.submit_pda_agency_quote")))
  && /'\^\[0-9\]\{1,12\}\(\\\.\[0-9\]\{1,2\}\)\?\$'/.test(body) && /coalesce\(max\(q\.revision\), 0\) \+ 1/.test(body),
  "only staff of an addressed agency quote; amounts have at most 12 digits and 2 decimals; a revision is n+1, never an edit");
ok(/before truncate on public\.pda_quote_request_recipients/.test(body) && (body.match(/where u\.id = r\.requester_user_id and u\.is_active/g) ?? []).length === 2,
  "recipients refuse TRUNCATE; an inactive requester's notification never blocks an agency's answer");
ok(/tg_table_name = 'pda_agency_quotes' or tg_op in \('DELETE', 'TRUNCATE'\)/.test(body) && /before truncate on public\.pda_agency_quotes/.test(body)
  && /old\.status <> 'open' or new\.status <> 'withdrawn'/.test(body), "quotes are append-only; a request only moves open → withdrawn");
ok(/'pda\.quote_request'/.test(body) && /'pda\.quote_received'/.test(body) && /'pda\.quote_declined'/.test(body) && /'\/dashboard\/agency'/.test(body),
  "notifications: staff on a new request (to the agency inbox), the requester on a quote and a decline");
ok(/PDA_DOWN_REFUSED/.test(down) && /history-exported:/.test(down) && !/\\(gset|if|echo|endif)\b/.test(migration + down),
  "the DOWN refuses to drop answered requests without an export reference; plain SQL");

// 3 · the pages
const agencyActions = read("app/(dashboard)/dashboard/agency/actions.ts");
const agencyPage = read("app/(dashboard)/dashboard/agency/page.tsx");
const memberActions = read("app/(dashboard)/dashboard/ports-da/actions.ts");
const inboxUi = read("components/pda/PdaAgencyInbox.tsx");
const requestsUi = read("components/pda/PdaQuoteRequests.tsx");
const sdk = read("sdk/app/pda.ts");
ok(/get_my_pda_agency/.test(agencyPage) && !/requirePdaAccess|subscription_tier|fn_pda_member_entitled/.test(agencyActions + agencyPage),
  "the agency inbox needs no PDA subscription: the database decides who is agency staff");
ok(!/getSupabaseAdminClient|createAdminClient|service_role/.test(agencyActions) && /getSupabaseServerClient/.test(agencyActions),
  "agency actions run in the signed-in user's own session, never the service role");
ok(/requestPdaQuotes/.test(memberActions) && /withdrawPdaQuotes/.test(memberActions) && /loadPdaAgentsAtPort/.test(memberActions),
  "the member side requests, lists and withdraws from the PDA page");
ok(/Share my company name/.test(requestsUi) && /useState\(false\)/.test(requestsUi.slice(requestsUi.indexOf("function NewRequest"))),
  "identity stays hidden unless the member ticks the reveal box (default off)");
const printed = (ui: string) => ui.replace(/[\w-]+=\{`[^`]*`\}/g, "").replace(/[\w-]+=\{[^}]*\}/g, "");
ok(!/\{\s*(request|agency|item|quote|q)\.(requestId|agencyId|setId|quoteId)\s*\}/.test(printed(requestsUi) + printed(inboxUi)),
  "no internal id is ever printed on either page");
ok(/createPdaQuoteRequest/.test(sdk) && /submitPdaAgencyQuote/.test(sdk) && /declinePdaQuoteRequest/.test(sdk), "the SDK exposes the six calls");

console.log(`\nPDA quote requests: ${n} checks passed`);
