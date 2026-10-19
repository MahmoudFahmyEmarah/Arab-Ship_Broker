// PDA · per-leg route preview (owner ruling O2ALL-008, increment B; design contract delivery states "Loading: each leg
// reports independently" and "Partial failure: one leg succeeds and the other fails").
//
// The route preview is computed in three independent parts — the load leg, the discharge leg and the frame (timeline,
// canonical selection, transits) — so each can load, fail and be retried on its own. composePdaRoutePreview is the ONE
// way the parts become a route result: the server's combined previewPdaRoute and the page both call it, so the two
// paths cannot drift. A preview is never persisted; the save path recomputes everything on the server.
import { aggregatePdaRoutePreview } from "./route-calculate";
import type {
  PdaRouteFxRate,
  PdaRoutePreviewInput,
  PdaRoutePreviewResult,
  PdaRouteTimelineResult,
  PdaRouteTransitsInput,
} from "./route-types";
import type { PdaCalculationResult, PdaRequest } from "./types";

export type PdaRouteSide = "load" | "discharge";

export interface PdaRouteLegPreview {
  side: PdaRouteSide;
  /** the canonical, server-built request for this leg (after FX) */
  request: PdaRequest;
  result: PdaCalculationResult;
  fx: PdaRouteFxRate | null;
}

export interface PdaRouteFramePreview {
  canonical: Omit<PdaRoutePreviewResult["canonical"], "loadRequest" | "dischargeRequest">;
  timeline: PdaRouteTimelineResult;
  transitFacts: PdaRouteTransitsInput;
}

export type PdaPartState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "failed"; error: string };

export const PDA_PART_IDLE = { status: "idle" } as const;
export const PDA_PART_LOADING = { status: "loading" } as const;

/** The full route result, from the three parts. */
export function composePdaRoutePreview(input: {
  displayCurrency: PdaRoutePreviewInput["displayCurrency"];
  allocation: PdaRoutePreviewInput["allocation"];
  frame: PdaRouteFramePreview;
  load: PdaRouteLegPreview;
  discharge: PdaRouteLegPreview;
  generatedAt?: string;
}): PdaRoutePreviewResult {
  if (input.load.side !== "load" || input.discharge.side !== "discharge") {
    throw new Error("composePdaRoutePreview: legs passed on the wrong side");
  }
  return aggregatePdaRoutePreview({
    displayCurrency: input.displayCurrency,
    allocation: input.allocation,
    canonical: { ...input.frame.canonical, loadRequest: input.load.request, dischargeRequest: input.discharge.request },
    load: input.load.result,
    discharge: input.discharge.result,
    timeline: input.frame.timeline,
    transitFacts: input.frame.transitFacts,
    fxRates: [
      ...(input.load.fx ? [{ ...input.load.fx, leg: "load" as const }] : []),
      ...(input.discharge.fx ? [{ ...input.discharge.fx, leg: "discharge" as const }] : []),
    ],
    ...(input.generatedAt ? { generatedAt: input.generatedAt } : {}),
  });
}

/** The route result when every part is ready; otherwise null (the page then shows each part's own state). */
export function composeWhenReady(input: {
  displayCurrency: PdaRoutePreviewInput["displayCurrency"];
  allocation: PdaRoutePreviewInput["allocation"];
  frame: PdaPartState<PdaRouteFramePreview>;
  load: PdaPartState<PdaRouteLegPreview>;
  discharge: PdaPartState<PdaRouteLegPreview>;
}): PdaRoutePreviewResult | null {
  if (input.frame.status !== "ok" || input.load.status !== "ok" || input.discharge.status !== "ok") return null;
  return composePdaRoutePreview({
    displayCurrency: input.displayCurrency,
    allocation: input.allocation,
    frame: input.frame.data,
    load: input.load.data,
    discharge: input.discharge.data,
  });
}

/** One sentence for the summary when parts failed (the cards carry each leg's own message and Retry). */
export function partFailureSummary(parts: {
  frame: PdaPartState<unknown>;
  load: PdaPartState<unknown>;
  discharge: PdaPartState<unknown>;
}): string {
  const failed = [
    parts.load.status === "failed" ? "the load port" : null,
    parts.discharge.status === "failed" ? "the discharge port" : null,
    parts.frame.status === "failed" ? "the voyage timeline and transits" : null,
  ].filter((item): item is string => item != null);
  if (!failed.length) return "";
  const list = failed.length === 1 ? failed[0]! : `${failed.slice(0, -1).join(", ")} and ${failed[failed.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} could not be calculated. Totals appear once every part is calculated; retry from the part that failed.`;
}
