import { createHash } from "node:crypto";

import { canonicalJson, canonicalMatchingRulesV1 } from "./canonical";
import type { ValidatedMatchingRulesV1 } from "./types";

/** Lower-case 64-character SHA-256 hex for a canonical JSON value. */
export function sha256CanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** Publication identity for the exact effective matching-rules payload. */
export function matchingRulesSha256(rules: ValidatedMatchingRulesV1): string {
  return createHash("sha256").update(canonicalMatchingRulesV1(rules), "utf8").digest("hex");
}
