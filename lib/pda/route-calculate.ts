import type {
  PdaRouteNotSourcedItem,
  PdaRouteNotSourcedReason,
  PdaRoutePreviewResult,
  PdaRouteServiceCode,
  PdaRouteTimelineInput,
  PdaRouteTimelineResult,
} from "./route-types";
import { PDA_ROUTE_SERVICE_OPTIONS } from "./route-types";
import type { PdaCalculationResult, PdaRequest, PdaWarning } from "./types";

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
  const passageDays = round(input.passageDistanceNm / (input.passageSpeedKnots * 24));

  const etdLoad = addDays(input.etaLoad, loadPortDays);
  const etaDischarge = addDays(etdLoad, passageDays);
  const etdDischarge = addDays(etaDischarge, dischargePortDays);
  const totalKnownDays = round(loadPortDays + dischargePortDays + passageDays);
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
  missingServices: PdaRouteServiceCode[],
): {
  completeAmount: number | null;
  knownAmount: number | null;
  reason: PdaRouteNotSourcedReason | null;
  warning: PdaWarning | null;
} {
  const warning = result.warnings.find((item) => item.code === "MANUAL_QUOTE_DUPLICATE")
    ?? result.warnings.find((item) => item.code === "MANUAL_QUOTE_UNMATCHED")
    ?? result.warnings.find((item) => item.code === "MANUAL_QUOTE_NOT_APPLIED")
    ?? result.warnings.find((item) => item.code === "MANUAL_QUOTE_REQUIRED")
    ?? result.warnings.find((item) => item.code === "TARIFF_GAP")
    ?? result.warnings.find((item) => item.code === "MISSING_INPUT")
    ?? result.warnings.find((item) => item.code === "NO_APPLICABLE_RULES")
    ?? result.warnings.find((item) => item.code === "NO_PUBLISHED_TARIFF")
    ?? result.warnings[0]
    ?? null;
  let reason: PdaRouteNotSourcedReason | null = null;
  if (warning?.code === "MANUAL_QUOTE_DUPLICATE") reason = "MANUAL_QUOTE_DUPLICATE";
  else if (warning?.code === "MANUAL_QUOTE_UNMATCHED") reason = "MANUAL_QUOTE_UNMATCHED";
  else if (warning?.code === "MANUAL_QUOTE_NOT_APPLIED") reason = "MANUAL_QUOTE_NOT_APPLIED";
  else if (warning?.code === "MANUAL_QUOTE_REQUIRED") reason = "MANUAL_QUOTE_REQUIRED";
  else if (warning?.code === "TARIFF_GAP") reason = "TARIFF_GAP";
  else if (warning?.code === "MISSING_INPUT") reason = "MISSING_TARIFF_INPUT";
  else if (warning?.code === "NO_APPLICABLE_RULES") reason = "NO_APPLICABLE_RULES";
  else if (result.coverage === "manual_required" || result.tariffVersionId == null || !result.lines.length) {
    reason = result.tariffVersionId ? "NO_GOVERNED_SOURCE" : "NO_PUBLISHED_TARIFF";
  } else if (missingServices.length) {
    reason = "REQUESTED_SERVICE_NOT_SOURCED";
  }

  let knownAmount: number | null = null;
  if (result.lines.length) {
    if (result.nativeCurrency === displayCurrency) knownAmount = result.totals.native;
    else if (result.convertedCurrency === displayCurrency && result.totals.converted != null) {
      knownAmount = result.totals.converted;
    } else {
      reason = "FX_RATE_REQUIRED";
    }
  }

  return {
    completeAmount: reason == null ? knownAmount : null,
    knownAmount,
    reason,
    warning,
  };
}

function legNotSourced(
  leg: "load" | "discharge",
  reason: PdaRouteNotSourcedReason,
  result: PdaCalculationResult,
  warning: PdaWarning | null,
): PdaRouteNotSourcedItem {
  const label = leg === "load" ? "Load port total" : "Discharge port total";
  const messages: Record<PdaRouteNotSourcedReason, string> = {
    NO_GOVERNED_SOURCE: `${label} is not sourced because the tariff returned no governed priced lines.`,
    NO_PUBLISHED_TARIFF: `${label} is not sourced because no effective published tariff is available.`,
    NO_APPLICABLE_RULES: `${label} is not sourced because no published tariff rule applies to the supplied call facts.`,
    MISSING_TARIFF_INPUT: `${label} is incomplete because a published tariff line still needs an explicit input.`,
    TARIFF_GAP: `${label} is incomplete because a published tariff has no band for this vessel or call.`,
    MANUAL_QUOTE_REQUIRED: `${label} is incomplete until the required attributed manual quotation is supplied.`,
    MANUAL_QUOTE_DUPLICATE: `${label} is incomplete because duplicate quotations target the same tariff rule and none was applied.`,
    MANUAL_QUOTE_UNMATCHED: `${label} is incomplete because a rule-coded quotation did not match an applicable manual-quote rule.`,
    MANUAL_QUOTE_NOT_APPLIED: `${label} is incomplete because a supplied quotation could not be applied under an effective governed tariff and currency.`,
    REQUESTED_SERVICE_NOT_SOURCED: `${label} is incomplete because at least one requested service has no governed line.`,
    FX_RATE_REQUIRED: `${label} needs an authorised FX rate for the selected display currency.`,
    PASSAGE_INPUT_REQUIRED: `${label} cannot be dated until the required passage inputs are supplied.`,
  };
  return {
    code: `${leg}_port_total`,
    label,
    amount: null,
    reasonCode: reason,
    message: messages[reason],
    provenance: {
      leg,
      tariffVersionId: result.tariffVersionId,
      ...(warning ? { warningCode: warning.code, ruleCode: warning.ruleCode ?? null } : {}),
    },
  };
}

function sourcedServices(result: PdaCalculationResult): Set<string> {
  const sourced = new Set<string>();
  for (const line of result.lines) {
    if (line.ruleCode) sourced.add(line.ruleCode.toLowerCase());
    for (const service of line.serviceCodes) sourced.add(service.toLowerCase());
  }
  return sourced;
}

function missingRequestedServices(request: PdaRequest, result: PdaCalculationResult): PdaRouteServiceCode[] {
  const sourced = sourcedServices(result);
  return request.call.requestedServices.filter(
    (service): service is PdaRouteServiceCode => !sourced.has(service.toLowerCase()),
  );
}

function serviceLabel(service: string): string {
  return PDA_ROUTE_SERVICE_OPTIONS.find((option) => option.code === service)?.label
    ?? service.replaceAll("_", " ");
}

function serviceNotSourced(
  leg: "load" | "discharge",
  service: PdaRouteServiceCode,
  result: PdaCalculationResult,
  requested: boolean,
): PdaRouteNotSourcedItem {
  const legLabel = leg === "load" ? "Load port" : "Discharge port";
  const label = `${legLabel} ${serviceLabel(service)}`;
  return {
    code: `${leg}_${service}`,
    label,
    amount: null,
    reasonCode: "REQUESTED_SERVICE_NOT_SOURCED",
    message: requested
      ? `${label} is NOT SOURCED: no applicable published line or attributed quotation covers this requested service.`
      : `${label} is NOT SOURCED because it was not requested and no governed line proves that it is included.`,
    provenance: {
      leg,
      tariffVersionId: result.tariffVersionId,
      requestedService: service,
    },
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
  const requiredInclusiveServices: PdaRouteServiceCode[] = ["cargo_handling", "agency"];
  const loadMissingServices = missingRequestedServices(input.canonical.loadRequest, input.load);
  const dischargeMissingServices = missingRequestedServices(input.canonical.dischargeRequest, input.discharge);
  const loadSourcedServices = sourcedServices(input.load);
  const dischargeSourcedServices = sourcedServices(input.discharge);
  const loadMissingForComplete = [...new Set([
    ...loadMissingServices,
    ...requiredInclusiveServices.filter((service) => !loadSourcedServices.has(service)),
  ])];
  const dischargeMissingForComplete = [...new Set([
    ...dischargeMissingServices,
    ...requiredInclusiveServices.filter((service) => !dischargeSourcedServices.has(service)),
  ])];
  const load = displayedTotal(input.load, input.displayCurrency, loadMissingForComplete);
  const discharge = displayedTotal(input.discharge, input.displayCurrency, dischargeMissingForComplete);
  const bothPortsKnown = load.knownAmount != null && discharge.knownAmount != null
    ? round(load.knownAmount + discharge.knownAmount, 2)
    : null;
  const notSourced: PdaRouteNotSourcedItem[] = [];

  if (load.reason) notSourced.push(legNotSourced("load", load.reason, input.load, load.warning));
  if (discharge.reason) notSourced.push(legNotSourced("discharge", discharge.reason, input.discharge, discharge.warning));

  for (const [leg, request, result] of [
    ["load", input.canonical.loadRequest, input.load],
    ["discharge", input.canonical.dischargeRequest, input.discharge],
  ] as const) {
    const sourced = sourcedServices(result);
    for (const service of requiredInclusiveServices) {
      if (!sourced.has(service)) {
        notSourced.push(serviceNotSourced(leg, service, result, request.call.requestedServices.includes(service)));
      }
    }
    for (const service of missingRequestedServices(request, result)) {
      if (!requiredInclusiveServices.includes(service)) {
        notSourced.push(serviceNotSourced(leg, service, result, true));
      }
    }
  }

  notSourced.push({
    code: "canal_and_strait_transits",
    label: "Canal and strait transits",
    amount: null,
    reasonCode: "NO_GOVERNED_SOURCE",
    message: "Transit cost is not sourced until an approved governed tariff is available.",
    provenance: { leg: null, tariffVersionId: null },
  });

  const handlingAndAgencyComplete = requiredInclusiveServices.every((service) => (
    loadSourcedServices.has(service) && dischargeSourcedServices.has(service)
  )) && load.completeAmount != null && discharge.completeAmount != null
    ? round(load.completeAmount + discharge.completeAmount, 2)
    : null;

  return {
    displayCurrency: input.displayCurrency,
    allocation: input.allocation,
    canonical: input.canonical,
    legs: { load: input.load, discharge: input.discharge },
    timeline: input.timeline,
    totals: {
      loadPort: load.completeAmount,
      dischargePort: discharge.completeAmount,
      loadPortKnown: load.knownAmount,
      dischargePortKnown: discharge.knownAmount,
      bothPortsKnown,
      handlingAndAgencyComplete,
      transit: null,
      allInKnown: bothPortsKnown,
      allInComplete: null,
      voyageOpex: input.timeline.voyageOpex,
    },
    notSourced,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}
