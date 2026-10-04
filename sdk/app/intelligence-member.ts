import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseIntelligenceRuleSetEnvelope,
  type ValidatedIntelligenceRuleSetEnvelope,
} from "@/lib/intelligence";

/**
 * Read the member-effective rule set through the governed RPC and validate its
 * complete envelope (including the effective-document SHA-256) before use.
 */
export async function getEffectiveIntelligenceRuleSet(
  supabase: SupabaseClient,
): Promise<ValidatedIntelligenceRuleSetEnvelope> {
  const { data, error } = await supabase.rpc("get_intelligence_rules");
  if (error) throw new Error(error.message);
  return parseIntelligenceRuleSetEnvelope(data);
}
