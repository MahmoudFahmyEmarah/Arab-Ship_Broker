import assert from "node:assert/strict";

import { daysFromNow, vesselAge } from "../lib/portal/adapters";

const checks: ReadonlyArray<readonly [string, Date, number]> = [
  ["2026-10-04", new Date("2026-10-04T00:01:00.000Z"), 0],
  ["2026-10-04", new Date("2026-10-04T11:59:59.999Z"), 0],
  ["2026-10-04", new Date("2026-10-04T12:00:00.000Z"), 0],
  ["2026-10-04", new Date("2026-10-04T23:59:59.999Z"), 0],
  ["2026-10-05", new Date("2026-10-04T23:59:59.999Z"), 1],
  ["2026-10-03", new Date("2026-10-04T00:00:00.000Z"), -1],
];

for (const [target, now, expected] of checks) {
  assert.equal(
    daysFromNow(target, now),
    expected,
    `${target} from ${now.toISOString()} must use UTC civil days`,
  );
}

assert.equal(daysFromNow("not-a-date", new Date("2026-10-04T12:00:00.000Z")), null);
assert.equal(daysFromNow(null, new Date("2026-10-04T12:00:00.000Z")), null);
assert.equal(vesselAge(2000, new Date("2026-12-31T23:59:59.999Z")), 26);
assert.equal(vesselAge(2000, new Date("2027-01-01T00:00:00.000Z")), 27);

console.log("portal advisory checks: 10 passed, 0 failed");
