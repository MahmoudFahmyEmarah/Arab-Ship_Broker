import { cache } from "react";

import {
  MATCHING_RULES_V1_DEFAULT_PAYLOAD,
  parseMatchingRulesV1,
} from "@/lib/matching-rules";
import { matchingRulesSha256 } from "@/lib/matching-rules/hash.server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { MatchingRulesSnapshot } from "./matching";

function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("placeholder"));
}

/** One governed read per server request. A configured/live environment never
 * falls back to defaults: an unavailable or invalid active document disables
 * client-side matching until the authoritative database path recovers. */
export const loadMatchingRulesSnapshot = cache(async (): Promise<MatchingRulesSnapshot | null> => {
  if (!isSupabaseConfigured()) {
    const rules = parseMatchingRulesV1(MATCHING_RULES_V1_DEFAULT_PAYLOAD);
    return Object.freeze({
      source: "sample",
      asOfYear: new Date().getUTCFullYear(),
      activeVersionId: null,
      paramsSha256: matchingRulesSha256(rules),
      rules,
    });
  }

  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_matching_rules_snapshot");
    if (error) throw error;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new TypeError("Matching rules snapshot must be an object");
    }
    const record = data as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const expected = ["activeVersionId", "asOfYear", "params", "paramsSha256", "schemaVersion"].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      throw new TypeError("Matching rules snapshot returned an unexpected shape");
    }
    if (record.schemaVersion !== 1) {
      throw new TypeError("Matching rules snapshot schemaVersion must be 1");
    }
    if (!Number.isSafeInteger(record.asOfYear) || (record.asOfYear as number) < 1900 || (record.asOfYear as number) > 3000) {
      throw new TypeError("Matching rules snapshot returned an invalid asOfYear");
    }
    if (typeof record.activeVersionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.activeVersionId)) {
      throw new TypeError("Matching rules snapshot returned an invalid version id");
    }
    if (typeof record.paramsSha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.paramsSha256)) {
      throw new TypeError("Matching rules snapshot returned an invalid params hash");
    }
    const rules = parseMatchingRulesV1(record.params);
    if (matchingRulesSha256(rules) !== record.paramsSha256) {
      throw new TypeError("Matching rules snapshot content hash does not match its params");
    }
    return Object.freeze({
      source: "live",
      asOfYear: record.asOfYear as number,
      activeVersionId: record.activeVersionId,
      paramsSha256: record.paramsSha256,
      rules,
    });
  } catch (error) {
    console.error("[portal] governed matching rules unavailable:", error);
    return null;
  }
});
