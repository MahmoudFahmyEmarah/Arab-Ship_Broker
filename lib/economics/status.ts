// One status vocabulary for every economics surface (program review PR-13).
//
// Each engine keeps its own precise status (Suez lines: trusted|placeholder|manual|
// unavailable|invalid; Voyage components: trusted|fallback|manual|unavailable|invalid;
// estimates: trusted|partial|unavailable|invalid; PDA legs: complete / known / none).
// Members see exactly one word for all of them:
//   Live        — every figure comes from governed, current data
//   Partial     — some figures are governed, others are missing or undecided
//   Fallback    — a platform default or placeholder stands in for governed data
//   Manual      — a broker-entered figure (with who, why and when)
//   Unavailable — no figure can be given; never shown as zero
import type { EstimateStatus, LineStatus } from "@/lib/suez/types";
import type { ComponentStatus } from "@/lib/voyage/types";

export type DisplayStatus = "live" | "partial" | "fallback" | "manual" | "unavailable";

export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  live: "Live",
  partial: "Partial",
  fallback: "Fallback",
  manual: "Manual",
  unavailable: "Unavailable",
};

/** Suez lines and layers. "invalid" is malformed tariff data: shown as Unavailable, never as a figure. */
export function fromSuezLineStatus(status: LineStatus): DisplayStatus {
  switch (status) {
    case "trusted": return "live";
    case "placeholder": return "fallback";
    case "manual": return "manual";
    default: return "unavailable";
  }
}

/** Voyage components (fuel, canal, opex, port cost …). */
export function fromComponentStatus(status: ComponentStatus): DisplayStatus {
  switch (status) {
    case "trusted": return "live";
    case "fallback": return "fallback";
    case "manual": return "manual";
    default: return "unavailable";
  }
}

/** Whole estimates (Suez, Voyage). */
export function fromEstimateStatus(status: EstimateStatus): DisplayStatus {
  switch (status) {
    case "trusted": return "live";
    case "partial": return "partial";
    default: return "unavailable";
  }
}

/**
 * A PDA leg: complete from governed lines only = Live; complete with a broker quotation = Manual; some governed lines
 * but not all = Partial; only broker quotations = Manual; nothing priced = Unavailable.
 */
export function fromPdaLeg(input: { completeAmount: number | null; knownAmount: number | null; governedLines: number; manualLines: number }): DisplayStatus {
  if (input.completeAmount != null) return input.manualLines > 0 ? "manual" : "live";
  if (input.governedLines > 0 && input.knownAmount != null) return "partial";
  if (input.manualLines > 0) return "manual";
  return "unavailable";
}

export function displayStatusLabel(status: DisplayStatus): string {
  return DISPLAY_STATUS_LABEL[status];
}
