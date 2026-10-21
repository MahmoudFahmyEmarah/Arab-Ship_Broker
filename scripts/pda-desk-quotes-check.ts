// PDA · Agents phase 4 contract: the desk records an agency's emailed quote (owner choice 19 Oct 2026). Pure + static.
//   node --import tsx scripts/pda-desk-quotes-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { deskQuoteLinesFromForm, parsePdaDeskQuoteRequests } from "../lib/pda/desk-quotes";
import { parsePdaQuoteRequests } from "../lib/pda/quote-requests";

let n = 0;
function ok(condition: unknown, label: string) {
  assert.ok(condition, label);
  n += 1;
  console.log(`  ok   ${label}`);
}
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

// 1 · the model
const waiting = parsePdaDeskQuoteRequests([{ requestId: "r1", agencyId: "a1", agencyName: "Email Agency", port: "EGALY", services: ["agency", "bunkers"], deskQuotes: "2" }, { requestId: "r2" }]);
ok(waiting.length === 1 && waiting[0]!.services.join() === "agency" && waiting[0]!.deskQuotes === 2 && waiting[0]!.snapshot.port.locode === "EGALY",
  "the waiting list keeps addressed rows only, known services only, and a port-only snapshot fallback");
const form = new FormData();
for (const [l, s, a] of [["Agency fee", "agency", "1,200.50"], ["", "", ""], ["Launch", "", "80"]]) { form.append("lineLabel", l!); form.append("lineService", s!); form.append("lineAmount", a!); }
const lines = deskQuoteLinesFromForm(form);
ok(lines.length === 2 && lines[0]!.amount === "1200.50" && lines[0]!.serviceCode === "agency" && lines[1]!.serviceCode === null,
  "form rows: empty rows skipped, thousands separators removed, 'Other' carries no service (the database validates the rest)");
const member = parsePdaQuoteRequests([{ requestId: "r", agencies: [{ agencyId: "a", displayName: "A", status: "quoted", quotes: [{ quoteId: "q", enteredVia: "desk" }, { quoteId: "q0" }] }] }]);
ok(member[0]!.agencies[0]!.quotes[0]!.enteredVia === "desk" && member[0]!.agencies[0]!.quotes[1]!.enteredVia === "agency",
  "the member model says how each quote was entered (portal by default)");

// 2 · the database
const migration = read("supabase/migrations/20261019120000_pda_desk_quotes.sql");
const down = read("supabase/rollback/20261019120000_pda_desk_quotes_down.sql");
const prior = read("supabase/migrations/20261019110000_pda_quote_acceptance.sql");
ok(/grant execute on function public\.pda_admin_list_quote_requests\(uuid\) to service_role;/.test(migration)
  && /grant execute on function public\.pda_admin_record_agency_quote\(uuid, uuid, uuid, text, jsonb, date, text, text, text\) to service_role;/.test(migration)
  && !/to authenticated/.test(migration) && /revoke all on function public\.fn_pda_agency_has_staff\(uuid\) from public, anon, authenticated;/.test(migration),
  "both desk functions are service-only; the staff helper is private");
const record = migration.slice(migration.indexOf("create or replace function public.pda_admin_record_agency_quote"));
ok((migration.match(/perform public\.fn_pda_assert_admin_actor\(p_actor\);/g) ?? []).length === 2 && /fn_pda_agency_has_staff\(p_agency_org_id\) then/.test(record)
  && /a\.status = 'active'/.test(record), "an owner-tier actor only; never for an agency with an account or a suspended one");
ok(/char_length\(btrim\(p_source\)\) not between 3 and 300/.test(record) && /'\^\[0-9\]\{1,12\}\(\\\.\[0-9\]\{1,2\}\)\?\$'/.test(record)
  && /v_line->>'serviceCode' <> all \(r\.services\)/.test(record) && /'desk', btrim\(p_source\)/.test(record),
  "the source is required; lines are validated like a portal quote; the quote is marked desk with its source");
ok(/\(entered_via = 'desk'\) = \(desk_source is not null\)/.test(migration), "the database itself ties the desk marker to a source");
ok(/'enteredVia', q\.entered_via/.test(migration) && !/'deskSource'|desk_source\s*\)/.test(migration.slice(migration.indexOf("create or replace function public.fn_pda_recipient_quotes"), migration.indexOf("revoke all on function public.fn_pda_recipient_quotes"))),
  "members and agencies see enteredVia, never the source text");
const restored = down.slice(down.indexOf("create or replace function public.fn_pda_recipient_quotes"), down.indexOf("revoke all on function public.fn_pda_recipient_quotes"));
const original = prior.slice(prior.indexOf("create or replace function public.fn_pda_recipient_quotes"), prior.indexOf("revoke all on function public.fn_pda_recipient_quotes"));
ok(restored.length > 100 && restored === original, "the DOWN restores fn_pda_recipient_quotes byte for byte");
ok(/PDA_DOWN_REFUSED/.test(down) && /history-exported:/.test(down) && /drop column if exists entered_via/.test(down) && !/\\(gset|if|echo|endif)\b/.test(migration + down),
  "the DOWN refuses while desk quotes exist, then drops the marker; plain SQL");

// 3 · the console and the pages
const actions = read("app/(admin)/admin/port-agents/actions.ts");
const page = read("app/(admin)/admin/port-agents/page.tsx");
ok(/requireAdmin\(\{ section: "portagents", edit: true \}\)/.test(actions) && /pdaAdminRecordAgencyQuote\(db, \{/.test(actions) && /dbMessage\(/.test(actions),
  "the console records through the service-only command as the signed-in owner-tier admin; database errors are mapped");
ok(/Quotes received by email/.test(page) && /name="source" required/.test(page) && !/requester\?\.email|vesselName|imo/.test(page),
  "the console form requires the source and shows only the masked snapshot");
ok(/recorded by Arab ShipBroker from the agency's email/.test(read("components/pda/PdaQuoteRequests.tsx"))
  && /recorded by Arab ShipBroker from your email/.test(read("components/pda/PdaAgencyInbox.tsx")),
  "members and agencies are told a quote was recorded by the desk");

console.log(`\nPDA desk quotes: ${n} checks passed`);
