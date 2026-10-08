import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const actions = readFileSync(
  new URL("../app/(dashboard)/dashboard/ports-da/actions.ts", import.meta.url),
  "utf8",
);
const bootstrap = readFileSync(
  new URL("../app/(dashboard)/dashboard/ports-da/bootstrap.server.ts", import.meta.url),
  "utf8",
);
const routeUi = readFileSync(
  new URL("../components/pda/PdaRouteEstimator.tsx", import.meta.url),
  "utf8",
);
const routeSchema = readFileSync(
  new URL("../lib/pda/route-schema.ts", import.meta.url),
  "utf8",
);

for (const source of [actions, bootstrap]) {
  assert.match(source, /loadVesselViews\(\{ mine: true \}\)/);
  assert.match(source, /loadCargoViews\(\{ mine: true \}\)/);
}
assert.match(actions, /export async function previewPdaRoute/);
assert.match(actions, /pdaRoutePreviewSchema\.safeParse\(raw\)/);
assert.match(actions, /validationErrorMessage\(parsed\.error\.issues, "Invalid route PDA request"\)/);
assert.match(actions, /error instanceof UserFacingActionError/);
assert.match(actions, /messages\.join\("; "\)/);
assert.match(actions, /actionErrorMessage\(error, "Unable to calculate route PDA"\)/);
assert.doesNotMatch(actions, /error instanceof Error \? error\.message/);
assert.match(actions, /requireRouteSelections\(input\.selection\)/);
assert.match(actions, /requireVerifiedPorts\(supabase/);
assert.match(actions, /authoritativeVesselFacts/);
assert.match(actions, /derivePdaRouteTimeline/);
assert.match(actions, /aggregatePdaRoutePreview/);
assert.match(actions, /callDate:\s*input\.leg\.callDate/);
assert.doesNotMatch(actions, /derivedDate|timeline\.(?:etaLoad|etaDischarge)\.slice/);
// Wave 2 (B2C-035): vessel facts stay authoritative; the flag state is resolved on the server
// from the governed flag registry, never taken from the browser request.
assert.match(actions, /vessel:\s*authoritativeVesselFacts\(input\.vessel,\s*input\.flagState\)/);
// C2O-090 B2C-035: one canonical resolver (lib/pda/flag.ts) for the route, the owned standalone vessel and a
// declared standalone ISO; the registered maximum draft is never the call draft.
assert.match(actions, /const flagState = resolveFlagName\(await flagRegistry\(supabase\), vessel\.flag\)/);
assert.match(actions, /authoritativeVesselFacts\(vessel, resolveFlagName\(registry, vessel\.flag\)\)/);
assert.match(actions, /flagState: resolveDeclaredFlag\(registry, request\.vessel\.flagState\)/);
assert.match(actions, /\.from\("flag_states"\)/);
assert.match(actions, /registeredMaxDraftM: vessel\.draftM \?\? null/);
assert.doesNotMatch(actions, /\bdraftM: vessel\.draftM\b/);
assert.doesNotMatch(actions, /flagState:\s*input\.(?:load|discharge|selection|vessel)\b/);
assert.match(actions, /enteredBy:\s*input\.manualActorLabel/);
assert.doesNotMatch(actions, /input\.request\.callDate/);
assert.doesNotMatch(actions, /service_role/i);

assert.doesNotMatch(routeUi, /const today\s*=/);
assert.doesNotMatch(routeUi, /positiveOr/);
assert.doesNotMatch(routeUi, /\?\?\s*1200|\?\?\s*1_200/);
assert.doesNotMatch(routeUi, /days:\s*1[,\n]/);
assert.doesNotMatch(routeUi, /REQUESTED_SERVICES/);
assert.match(routeUi, /Tariff-driving values are never defaulted/);
assert.match(routeUi, /loadRequestedServices/);
assert.match(routeUi, /dischargeRequestedServices/);
assert.doesNotMatch(routeUi, /const \[requestedServices,/);
assert.match(routeUi, /loadCallDate/);
assert.match(routeUi, /dischargeCallDate/);
assert.match(routeUi, /Load-port local call date/);
assert.match(routeUi, /Discharge-port local call date/);
assert.match(routeUi, /dateTimeLocalUtcIso\(etaLoad\)/);
assert.match(routeUi, /ETA \(UTC\)/);
assert.match(routeUi, /formatUtcTimelineInstant/);
assert.doesNotMatch(routeUi, /new Date\(value\)/);
assert.match(routeUi, /ManualQuotesEditor/);
assert.match(routeUi, /Rule code <span>optional<\/span>/);
assert.match(routeUi, /Quote label/);
assert.match(routeUi, /Quote reason \/ reference/);
assert.match(routeUi, /Add quote/);
assert.match(routeUi, /Remove \$\{legLabel\.toLowerCase\(\)\} quote/);
assert.match(routeUi, /role="alert"/);
assert.match(routeUi, /applied only within an effective published tariff and currency/);
assert.match(routeUi, /aria-activedescendant=\{activeItem \?/);
assert.doesNotMatch(routeUi, /filtered\[activeIndex\]\?\.id/);
assert.match(routeUi, /line\.explanation/);
assert.match(routeUi, /line\.enteredBy/);
assert.match(routeUi, /line\.manualReason/);
assert.match(routeUi, /line\.evidence\.sourceId/);
assert.match(routeUi, /try\s*\{[\s\S]*await previewPdaRoute\(input\)/);
assert.match(routeUi, /catch \(cause\)[\s\S]*requestSequence\.current === sequence/);
assert.match(routeUi, /finally\s*\{[\s\S]*requestSequence\.current === sequence[\s\S]*setBusy\(false\)/);
assert.match(routeSchema, /Duplicate manual quotation rule code/);
assert.match(routeSchema, /seen\.has\(line\.ruleCode\)/);

console.log("PDA ROUTE ACTION CONTRACT: ALL ASSERTIONS PASSED");
