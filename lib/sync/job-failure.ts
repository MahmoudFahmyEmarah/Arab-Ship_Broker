export interface JobFailureExplanation {
  summary: string;
  action: string | null;
}

/** Convert provider/runtime exceptions stored in job_runs into an operator-facing
 * reason. The raw error remains in the database for diagnostics; this text is
 * deliberately short enough for status tiles and avoids exposing provider URLs. */
export function explainJobFailure(error?: string | null, job?: string | null): JobFailureExplanation {
  const raw = (error ?? "").trim();

  if (/prepay(?:ment)? credits?.*(?:depleted|exhausted)|credits?.*(?:depleted|exhausted)/i.test(raw)) {
    return {
      summary: "Gemini credits are depleted.",
      action: "Add provider credits or update the active LLM key in Connections, then run the sync again.",
    };
  }
  if (/\b429\b|too many requests|rate.?limit|resource[_ -]?exhausted/i.test(raw)) {
    return {
      summary: "The AI provider temporarily refused classification requests.",
      action: "Check the provider quota and billing, wait briefly, then run the sync again.",
    };
  }
  if (/invalid.*(?:api )?key|api key.*invalid|unauthori[sz]ed|\b401\b|\b403\b/i.test(raw)) {
    return {
      summary: "The active AI provider key was rejected.",
      action: "Update the active LLM key in Connections, then run the sync again.",
    };
  }
  if (/timed? out|timeout|etimedout/i.test(raw)) {
    return {
      summary: "The classification request timed out.",
      action: "Check the provider connection and run the sync again.",
    };
  }
  if (/fetch failed|econnreset|enotfound|network|socket/i.test(raw)) {
    return {
      summary: "The classifier could not reach the AI provider.",
      action: "Check the connection and run the sync again.",
    };
  }

  const withoutProviderPrefix = raw
    .replace(/^\[[^\]]+\]\s*:?\s*/u, "")
    .replace(/https?:\/\/\S+/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const fallback = withoutProviderPrefix || `${job || "Background job"} failed without a recorded reason.`;
  return {
    summary: fallback.length > 150 ? `${fallback.slice(0, 147).trimEnd()}…` : fallback,
    action: "Open History for the full technical error before retrying.",
  };
}
