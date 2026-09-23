import assert from "node:assert/strict";
import { explainJobFailure } from "../lib/sync/job-failure";

const depleted = explainJobFailure(
  "3 classification batches failed ([GoogleGenerativeAI Error]: 429 Too Many Requests: Your prepayment credits are depleted. Learn more at https://example.com/very/long/provider/path).",
  "email-sync",
);
assert.equal(depleted.summary, "Gemini credits are depleted.");
assert.match(depleted.action ?? "", /Connections/);

const limited = explainJobFailure("429 RESOURCE_EXHAUSTED", "email-sync");
assert.match(limited.summary, /temporarily refused/);

const unknown = explainJobFailure("[Provider Error]: Unexpected failure https://example.com/details", "email-sync");
assert.ok(unknown.summary.length <= 150);
assert.doesNotMatch(unknown.summary, /https?:\/\//);

console.log("job failure message checks passed");
