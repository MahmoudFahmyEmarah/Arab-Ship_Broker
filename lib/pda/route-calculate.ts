import type {
  PdaRouteNotSourcedItem,
  PdaRoutePreviewResult,
  PdaRouteTimelineInput,
  PdaRouteTimelineResult,
} from "./route-types";
import type { PdaCalculationResult } from "./types";

const DAY_MS = 86_400_000;

function round(value: number, places = 4): number {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

export function derivePdaRouteTimeline(
  quantityMt: number,
  input: PdaRouteTimelineInput,
): PdaRouteTimelineResult {
  const loadWorkingDays = round(quantityMt / input.loadProductivityMtPerDay);
  const dischargeWorkingDays = round(quantityMt / input.dischargeProductivityMtPerDay);
  const loadPortDays = round(input.loadTurnDays + loadWorkingDays);
  const dischargePortDays = round(input.dischargeTurnDays + dischargeWorkingDays);
  const passageDays = input.passageDistanceNm != null && input.passageSpeedKnots != null
    ? round(input.passageDistanceNm / (input.passageSpeedKnots * 24))
    : null;

  const etdLoad = input.etaLoad ? addDays(input.etaLoad, loadPortDays) : null;
  const etaDischarge = etdLoad && passageDays != null ? addDays(etdLoad, passageDays) : null;
  const etdDischarge = etaDischarge ? addDays(etaDischarge, dischargePortDays) : null;
  const totalKnownDays = round(loadPortDays + dischargePortDays + (passageDays ?? 0));
  const voyageOpex = input.dailyOpex == null
    ? null
    : round(input.dailyOpex * totalKnownDays, 2);

  return {
    etaLoad: input.etaLoad,
    etdLoad,
    etaDischarge,
    etdDischarge,
    loadTurnDays: input.loadTurnDays,
    loadWorkingDays,
    loadPortDays,
    passageDays,
    dischargeTurnDays: input.dischargeTurnDays,
    dischargeWorkingDays,
    dischargePortDays,
    totalKnownDays,
    voyageOpex,
  };
}

function displayedTotal(
  result: PdaCalculationResult,
  displayCurrency: string,
): { amount: number | null; reason: "NO_PUBLISHED_TARIFF" | "FX_RATE_REQUIRED" | null } {
  if (result.coverage === "manual_required" && result.tariffVersionId == null) {
    return { amount: null, reason: "NO_PUBLISHED_TARIFF" };
  }
  if (result.nativeCurrency === displayCurrency) {
    return { amount: result.totals.native, reason: null };
  }
  if (result.convertedCurrency === displayCurrency && result.totals.converted != null) {
    return { amount: result.totals.converted, reason: null };
  }
  return { amount: null, reason: "FX_RATE_REQUIRED" };
}

function legNotSourced(
  leg: "load" | "discharge",
  reason: "NO_PUBLISHED_TARIFF" | "FX_RATE_REQUIRED",
): PdaRouteNotSourcedItem {
  const label = leg === "load" ? "Load port total" : "Discharge port total";
  return {
    code: `${leg}_port_total`,
    label,
    amount: null,
    reasonCode: reason,
    message: reason === "NO_PUBLISHED_TARIFF"
      ? `${label} is not sourced because no effective published tariff is available.`
      : `${label} needs an authorised FX rate for the selected display currency.`,
  };
}

export function aggregatePdaRoutePreview(input: {
  displayCurrency: string;
  allocation: PdaRoutePreviewResult["allocation"];
  canonical: PdaRoutePreviewResult["canonical"];
  load: PdaCalculationResult;
  discharge: PdaCalculationResult;
  timeline: PdaRouteTimelineResult;
  generatedAt?: string;
}): PdaRoutePreviewResult {
  const load = displayedTotal(input.load, input.displayCurrency);
  const discharge = displayedTotal(input.discharge, input.displayCurrency);
  const bothPortsKnown = load.amount != null && discharge.amount != null
    ? round(load.amount + discharge.amount, 2)
    : null;
  const notSourced: PdaRouteNotSourcedItem[] = [];

  if (load.reason) notSourced.push(legNotSourced("load", load.reason));
  if (discharge.reason) notSourced.push(legNotSourced("discharge", discharge.reason));
  notSourced.push({
    code: "canal_and_strait_transits",
    label: "Canal and strait transits",
    amount: null,
    reasonCode: "NO_GOVERNED_SOURCE",
    message: "Transit cost is not sourced until an approved governed tariff is available.",
  });
  if (input.timeline.passageDays == null) {
    notSourced.push({
      code: "passage_duration",
      label: "Passage duration",
      amount: null,
      reasonCode: "PASSAGE_INPUT_REQUIRED",
      message: "Passage distance and speed are required to derive the sea leg.",
    });
  }

  return {
    displayCurrency: input.displayCurrency,
    allocation: input.allocation,
    canonical: input.canonical,
    legs: { load: input.load, discharge: input.discharge },
    timeline: input.timeline,
    totals: {
      loadPort: load.amount,
      dischargePort: discharge.amount,
      bothPortsKnown,
      transit: null,
      allInKnown: bothPortsKnown,
      allInComplete: null,
      voyageOpex: input.timeline.voyageOpex,
    },
    notSourced,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}
