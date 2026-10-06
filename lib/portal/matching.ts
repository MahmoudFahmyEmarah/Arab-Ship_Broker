// ONE governed matching reference for every client-side surface. The database
// remains authoritative; this module evaluates an already-loaded view only
// when the request supplied a validated active rules document and exact facts.
import {
  comparePairMatchRank,
  evaluatePairMatch,
  parseMatchingRulesV1,
  type MatchEvaluationContext,
  type MatchingRulesV1Payload,
  type PairMatchEvaluation,
  type ValidatedMatchingRulesV1,
} from "@/lib/matching-rules";
import type { CargoView, VesselView } from "./types";

export interface MatchingRulesSnapshot {
  readonly source: "live" | "sample";
  readonly asOfYear: number;
  readonly activeVersionId: string | null;
  readonly paramsSha256: string;
  readonly rules: MatchingRulesV1Payload;
}

/** Client-runtime form. The parser marker cannot cross the RSC boundary, so
 * the dashboard hydrates it once and passes the validated object downward. */
export interface MatchingRuntime {
  readonly source: MatchingRulesSnapshot["source"];
  readonly rules: ValidatedMatchingRulesV1;
  readonly context: MatchEvaluationContext;
}

export function matchingRuntimeFromSnapshot(
  snapshot: MatchingRulesSnapshot | null,
): MatchingRuntime | null {
  if (!snapshot || !Number.isSafeInteger(snapshot.asOfYear) || snapshot.asOfYear < 1900 || snapshot.asOfYear > 3000) {
    return null;
  }
  try {
    return Object.freeze({
      source: snapshot.source,
      rules: parseMatchingRulesV1(snapshot.rules),
      context: Object.freeze({ asOfYear: snapshot.asOfYear }),
    });
  } catch {
    return null;
  }
}

export function dwtNum(vessel: VesselView): number {
  const exact = vessel.matchingFacts?.dwtGrainMt;
  if (typeof exact === "number" && Number.isFinite(exact)) return exact;
  return Number.parseInt(String(vessel.dwt || "").replace(/[,\s]/g, ""), 10) || 0;
}

export function cargoQtyMax(cargo: CargoView): number {
  const exact = cargo.matchingFacts?.qtyMaxMt;
  if (typeof exact === "number" && Number.isFinite(exact)) return exact;
  if (cargo.qty?.max != null) return cargo.qty.max;
  return Number.parseInt(String(cargo.qtyMt || "").replace(/[^\d]/g, ""), 10) || 0;
}

function evaluateViewPair(
  cargo: CargoView,
  vessel: VesselView,
  runtime: MatchingRuntime | null | undefined,
): PairMatchEvaluation | null {
  // The TypeScript evaluator is a sample-data mirror, not an authority for
  // live listings. Live eligibility and ordering come from
  // list_market_matches; refusing live runtimes here makes every caller fail
  // closed even if a future UI accidentally tries to use the mirror.
  if (runtime?.source !== "sample" || !cargo.matchingFacts || !vessel.matchingFacts) return null;
  try {
    return evaluatePairMatch(
      cargo.matchingFacts,
      vessel.matchingFacts,
      runtime.rules,
      runtime.context,
    );
  } catch {
    // A malformed or incomplete projection must never broaden eligibility.
    return null;
  }
}

/** Compare two sample-data view pairs with the canonical mirror. Live pairs
 * are ordered by the authoritative RPC and therefore compare as equal here. */
export function compareViewPairRank(
  leftCargo: CargoView,
  leftVessel: VesselView,
  rightCargo: CargoView,
  rightVessel: VesselView,
  runtime: MatchingRuntime | null | undefined,
): number {
  const left = evaluateViewPair(leftCargo, leftVessel, runtime);
  const right = evaluateViewPair(rightCargo, rightVessel, runtime);
  if (!left || !right || !runtime) return left ? -1 : right ? 1 : 0;
  return comparePairMatchRank(left, right);
}

export function pairEligible(
  cargo: CargoView,
  vessel: VesselView,
  runtime: MatchingRuntime | null | undefined,
): boolean {
  return evaluateViewPair(cargo, vessel, runtime)?.eligible === true;
}

export type FitBand = "Strong" | "Good" | "Possible" | "Weak";

/** The client evaluator is deliberately available only for the explicit
 * sample-data experience. */
export function canUseClientMatchingMirror(
  runtime: MatchingRuntime | null | undefined,
): runtime is MatchingRuntime & { readonly source: "sample" } {
  return runtime?.source === "sample";
}

/** Qualitative label from the same governed evaluator as eligibility. */
export function fitLabel(
  cargo: CargoView,
  vessel: VesselView,
  runtime: MatchingRuntime | null | undefined,
): FitBand | null {
  return evaluateViewPair(cargo, vessel, runtime)?.displayLabel ?? null;
}

export interface DashMatch {
  cargoId: string;
  vesselId: string;
  commodity: string;
  qtyMt: string;
  pol: string;
  pod: string;
  polZone: string;
  podZone: string;
  vessel: string;
  vClass: string;
  dwt: string;
  vOpen: string;
  laycan: number | null;
  quality: Exclude<FitBand, "Weak"> | "Matched";
}

export type GovernedMatchSelection =
  | { readonly status: "idle" }
  | { readonly status: "loading" | "sample" | "unavailable"; readonly sourceId: string }
  | { readonly status: "ready"; readonly sourceId: string; readonly ids: readonly string[] };

export interface SurfaceVesselMatch {
  readonly vessel: VesselView;
  readonly fit: FitBand | null;
}

/** Select the vessels shown by the cargo deal card and its map lines.
 *
 * Live mode consumes only ordered board handles returned by the governed RPC.
 * Loading/unavailable states return nothing. Sample mode alone evaluates the
 * local mirror. */
export function selectCargoVesselMatches(
  cargo: CargoView,
  vessels: readonly VesselView[],
  runtime: MatchingRuntime | null | undefined,
  selection: GovernedMatchSelection,
  limit = 3,
): SurfaceVesselMatch[] {
  if (selection.status !== "idle" && selection.sourceId !== cargo.id) return [];
  if (selection.status === "sample" && canUseClientMatchingMirror(runtime)) {
    return vessels
      .filter((vessel) => pairEligible(cargo, vessel, runtime))
      .sort((left, right) => compareViewPairRank(cargo, left, cargo, right, runtime))
      .map((vessel) => ({ vessel, fit: fitLabel(cargo, vessel, runtime) }))
      .slice(0, limit);
  }
  if (selection.status !== "ready") return [];

  const byId = new Map(vessels.map((vessel) => [vessel.id, vessel]));
  return selection.ids
    .map((id) => byId.get(id) ?? null)
    .filter((vessel): vessel is VesselView => vessel !== null)
    .slice(0, limit)
    .map((vessel) => ({ vessel, fit: null }));
}

export interface AuthoritativeViewPair {
  readonly cargo: CargoView;
  readonly vessel: VesselView;
}

/** Keep the live dashboard read cost independent of the number of listings in
 * the current filter. The database remains authoritative for every selected
 * source; this merely caps the number of source-listing RPCs made per mode. */
export const LIVE_TOP_MATCH_REQUEST_LIMIT = 6;

/** Keep the authoritative read below the database's practical burst limit.
 * Six source listings are still evaluated, but only two RPCs may be in flight
 * at once. Results are written into source-indexed slots so completion order
 * can never change governed Top Matches priority. */
export const LIVE_TOP_MATCH_CONCURRENCY_LIMIT = 2;

export function boundedAuthoritativeMatchSources<
  T extends { readonly listingKey?: string | null; readonly matches: number },
>(sources: readonly T[]): T[] {
  return sources
    .filter((source) => Boolean(source.listingKey) && source.matches > 0)
    .slice(0, LIVE_TOP_MATCH_REQUEST_LIMIT);
}

export function boundedAuthoritativeMatchSourcesForMode(
  mode: "cargo",
  cargos: readonly CargoView[],
  vessels: readonly VesselView[],
): CargoView[];
export function boundedAuthoritativeMatchSourcesForMode(
  mode: "vessel",
  cargos: readonly CargoView[],
  vessels: readonly VesselView[],
): VesselView[];
export function boundedAuthoritativeMatchSourcesForMode(
  mode: "cargo" | "vessel",
  cargos: readonly CargoView[],
  vessels: readonly VesselView[],
): Array<CargoView | VesselView> {
  return mode === "cargo"
    ? boundedAuthoritativeMatchSources(cargos)
    : boundedAuthoritativeMatchSources(vessels);
}

export interface AuthoritativeMatchBatch<TSource, TRow> {
  readonly source: TSource;
  readonly rows: readonly TRow[];
}

export type AuthoritativeMatchBatchResult<TSource, TRow> =
  | { readonly status: "ready"; readonly batches: readonly AuthoritativeMatchBatch<TSource, TRow>[] }
  | { readonly status: "discarded" | "unavailable"; readonly batches: readonly [] };

/** Run one fixed-size RPC batch through a small worker pool. A rejected request
 * invalidates the whole authoritative view; cancellation or failure stops new
 * work from being scheduled while already-started reads settle. */
export async function loadBoundedAuthoritativeMatchBatches<
  TSource extends { readonly listingKey?: string | null; readonly matches: number },
  TRow,
>(
  sources: readonly TSource[],
  load: (listingKey: string) => Promise<readonly TRow[]>,
  shouldDiscard: () => boolean = () => false,
): Promise<AuthoritativeMatchBatchResult<TSource, TRow>> {
  const selected = boundedAuthoritativeMatchSources(sources);
  if (selected.length === 0) return { status: "ready", batches: [] };

  const batches = new Array<AuthoritativeMatchBatch<TSource, TRow> | undefined>(selected.length);
  let nextIndex = 0;
  let completed = 0;
  let failed = false;

  const worker = async () => {
    while (!failed && !shouldDiscard()) {
      const index = nextIndex;
      if (index >= selected.length) return;
      nextIndex += 1;

      const source = selected[index]!;
      try {
        const rows = await load(source.listingKey!);
        batches[index] = { source, rows };
        completed += 1;
      } catch {
        failed = true;
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(LIVE_TOP_MATCH_CONCURRENCY_LIMIT, selected.length) },
      () => worker(),
    ),
  );

  if (shouldDiscard()) return { status: "discarded", batches: [] };
  if (failed || completed !== selected.length) return { status: "unavailable", batches: [] };
  return {
    status: "ready",
    batches: batches as AuthoritativeMatchBatch<TSource, TRow>[],
  };
}

export interface AuthoritativeBatchPair<TSource, TCounterpart> {
  readonly source: TSource;
  readonly counterpart: TCounterpart;
}

/** Preserve source and RPC row order while preventing the same counterpart
 * from occupying more than one Top Matches card. */
export function selectUniqueAuthoritativeBatchPairs<TSource, TRow, TCounterpart>(
  batches: readonly AuthoritativeMatchBatch<TSource, TRow>[],
  counterpartForRow: (row: TRow) => TCounterpart | null,
  counterpartKey: (counterpart: TCounterpart) => string,
  limit = 3,
): AuthoritativeBatchPair<TSource, TCounterpart>[] {
  const used = new Set<string>();
  const pairs: AuthoritativeBatchPair<TSource, TCounterpart>[] = [];
  for (const { source, rows } of batches) {
    if (pairs.length >= limit) break;
    const counterpart = rows
      .map(counterpartForRow)
      .find((candidate) => candidate !== null && !used.has(counterpartKey(candidate)));
    if (!counterpart) continue;
    used.add(counterpartKey(counterpart));
    pairs.push({ source, counterpart });
  }
  return pairs;
}

function dashMatchFromPair(
  cargo: CargoView,
  vessel: VesselView,
  vClassOf: (vessel: VesselView) => string,
  quality: DashMatch["quality"],
): DashMatch {
  return {
    cargoId: cargo.id,
    vesselId: vessel.id,
    commodity: cargo.commodity || cargo.cargo,
    qtyMt: cargo.qtyMt,
    pol: cargo.route?.polName || cargo.route?.polCode || "—",
    pod: cargo.route?.podName || cargo.route?.podCode || "—",
    polZone: cargo.route?.polZone || "",
    podZone: cargo.route?.podZone || "",
    vessel: vessel.name,
    vClass: vClassOf(vessel),
    dwt: vessel.dwt,
    vOpen: vessel.openPortZone || "—",
    laycan: cargo.laycanDays ?? null,
    quality,
  };
}

/** Format already-authorised, already-ordered RPC pairs for Top Matches.
 * This function never evaluates eligibility or changes the RPC order. */
export function buildAuthoritativeTopMatches(
  pairs: readonly AuthoritativeViewPair[],
  vClassOf: (vessel: VesselView) => string,
  limit = 3,
): DashMatch[] {
  return pairs.slice(0, limit).map(({ cargo, vessel }) =>
    dashMatchFromPair(cargo, vessel, vClassOf, "Matched"));
}

/** Sample Top Matches uses the canonical mirror. Live Top Matches must use
 * buildAuthoritativeTopMatches with pairs returned by list_market_matches. */
export function buildTopMatches(
  cargos: CargoView[],
  vessels: VesselView[],
  vClassOf: (vessel: VesselView) => string,
  runtime: MatchingRuntime | null | undefined,
  limit = 3,
): DashMatch[] {
  if (!canUseClientMatchingMirror(runtime)) return [];
  const used = new Set<string>();
  const out: DashMatch[] = [];

  for (const cargo of cargos) {
    if (out.length >= limit) break;
    if (!cargo.matchingFacts) continue;
    const ranked = vessels
      .filter((vessel) => !used.has(vessel.id))
      .map((vessel) => ({ vessel, evaluation: evaluateViewPair(cargo, vessel, runtime) }))
      .filter(
        (entry): entry is { vessel: VesselView; evaluation: PairMatchEvaluation } =>
          entry.evaluation?.eligible === true,
      )
      .sort((left, right) => compareViewPairRank(
        cargo,
        left.vessel,
        cargo,
        right.vessel,
        runtime,
      ));

    const best = ranked[0];
    if (!best) continue;
    const quality = best.evaluation.displayLabel;
    if (quality === "Weak") continue;
    used.add(best.vessel.id);

    out.push(dashMatchFromPair(cargo, best.vessel, vClassOf, quality));
  }
  return out;
}
