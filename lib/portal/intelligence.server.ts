import { cache } from "react";

import {
  evaluateIntelligence,
  parseIntelligenceFacts,
  type IntelligenceSignal,
  type ValidatedIntelligenceRuleSetEnvelope,
} from "@/lib/intelligence";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getEffectiveIntelligenceRuleSet } from "@/sdk/app/intelligence-member";
import type {
  CargoView,
  IntelligenceSignalView,
  IntelligenceSignalsView,
  VesselView,
} from "./types";

function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("placeholder"));
}

type ActiveEnvelopeLoad =
  | { status: "disabled" }
  | { status: "unavailable" }
  | { status: "available"; envelope: ValidatedIntelligenceRuleSetEnvelope };

const INTELLIGENCE_UNAVAILABLE: IntelligenceSignalsView = Object.freeze({
  status: "unavailable",
  version: null,
  effectiveContentHash: null,
  signals: Object.freeze([]) as readonly [],
});

/** Request-scoped by React on the server, so dashboard cargo/vessel loaders
 * share one governed RPC read without introducing a process-wide stale cache. */
const loadActiveEnvelope = cache(async (): Promise<ActiveEnvelopeLoad> => {
  if (!isSupabaseConfigured()) return { status: "disabled" };
  try {
    const supabase = await getSupabaseServerClient();
    return {
      status: "available",
      envelope: await getEffectiveIntelligenceRuleSet(supabase),
    };
  } catch (error) {
    // Intelligence is advisory. A missing/invalid rule set must never alter
    // listing availability, ranking, filtering or map presentation.
    console.error("[portal] governed intelligence rules unavailable:", error);
    return { status: "unavailable" };
  }
});

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function signalView(signal: IntelligenceSignal): IntelligenceSignalView {
  return Object.freeze({
    ruleCode: signal.ruleCode,
    field: signal.field,
    severity: signal.severity,
    tag: signal.tag,
    message: signal.message,
    value: signal.value ?? null,
  });
}

function evaluateCargo(
  cargo: CargoView,
  envelope: ValidatedIntelligenceRuleSetEnvelope,
): IntelligenceSignalsView {
  const facts = parseIntelligenceFacts({
    entity: "cargo",
    values: {
      stowage_sf: finiteOrNull(cargo.sf),
      load_rate_mt_day: finiteOrNull(cargo.loadRate),
      laycan_days_remaining: finiteOrNull(cargo.laycanDays),
      freight_idea_usd_mt: finiteOrNull(cargo.freightIdea),
      commission_pct: finiteOrNull(cargo.commission),
    },
  });
  const result = evaluateIntelligence(envelope.document, facts);
  return Object.freeze({
    status: "available",
    version: envelope.version,
    effectiveContentHash: envelope.effectiveContentHash,
    signals: Object.freeze(result.signals.map(signalView)),
  });
}

function evaluateVessel(
  vessel: VesselView,
  envelope: ValidatedIntelligenceRuleSetEnvelope,
): IntelligenceSignalsView {
  const facts = parseIntelligenceFacts({
    entity: "vessel",
    values: {
      age_years: finiteOrNull(vessel.age),
      vlsfo_sea_mt_day: finiteOrNull(vessel.fuel.vlsfoSea),
      lsmgo_sea_mt_day: finiteOrNull(vessel.fuel.lsmgoSea),
      open_days_delta: finiteOrNull(vessel.openDateDays),
    },
  });
  const result = evaluateIntelligence(envelope.document, facts);
  return Object.freeze({
    status: "available",
    version: envelope.version,
    effectiveContentHash: envelope.effectiveContentHash,
    signals: Object.freeze(result.signals.map(signalView)),
  });
}

export async function decorateCargoViewsWithIntelligence(
  views: readonly CargoView[],
): Promise<CargoView[]> {
  const loaded = await loadActiveEnvelope();
  if (loaded.status === "disabled") return [...views];
  if (loaded.status === "unavailable") {
    return views.map((view) => ({ ...view, intelligence: INTELLIGENCE_UNAVAILABLE }));
  }
  return views.map((view) => {
    try {
      return { ...view, intelligence: evaluateCargo(view, loaded.envelope) };
    } catch (error) {
      // A malformed fact on one advisory evaluation must not erase this or
      // any other governed listing from the market board.
      console.error("[portal] cargo intelligence evaluation unavailable:", error);
      return { ...view, intelligence: INTELLIGENCE_UNAVAILABLE };
    }
  });
}

export async function decorateVesselViewsWithIntelligence(
  views: readonly VesselView[],
): Promise<VesselView[]> {
  const loaded = await loadActiveEnvelope();
  if (loaded.status === "disabled") return [...views];
  if (loaded.status === "unavailable") {
    return views.map((view) => ({ ...view, intelligence: INTELLIGENCE_UNAVAILABLE }));
  }
  return views.map((view) => {
    try {
      return { ...view, intelligence: evaluateVessel(view, loaded.envelope) };
    } catch (error) {
      console.error("[portal] vessel intelligence evaluation unavailable:", error);
      return { ...view, intelligence: INTELLIGENCE_UNAVAILABLE };
    }
  });
}
