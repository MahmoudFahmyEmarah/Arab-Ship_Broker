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

for (const source of [actions, bootstrap]) {
  assert.match(source, /loadVesselViews\(\{ mine: true \}\)/);
  assert.match(source, /loadCargoViews\(\{ mine: true \}\)/);
}
assert.match(actions, /export async function previewPdaRoute/);
assert.match(actions, /requireRouteSelections\(input\.selection\)/);
assert.match(actions, /requireVerifiedPorts\(supabase/);
assert.match(actions, /authoritativeVesselFacts/);
assert.match(actions, /derivePdaRouteTimeline/);
assert.match(actions, /aggregatePdaRoutePreview/);
assert.doesNotMatch(actions, /service_role/i);

console.log("PDA ROUTE ACTION CONTRACT: ALL ASSERTIONS PASSED");
