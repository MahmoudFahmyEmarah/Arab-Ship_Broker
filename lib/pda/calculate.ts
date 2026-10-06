import type {
  PdaApplicability,
  PdaCalculationResult,
  PdaExplainedLine,
  PdaRequest,
  PdaTariffBand,
  PdaTariffRule,
  PdaTariffVersion,
  PdaWarning,
  RoundingMode,
} from "./types";
import { pdaRequestSchema, pdaTariffVersionSchema } from "./schemas";

const EPSILON = 1e-9;

function round(value: number, places: number, mode: RoundingMode): number {
  const factor = 10 ** places;
  const scaled = value * factor;
  const rounded =
    mode === "up"
      ? Math.ceil(scaled - EPSILON)
      : mode === "down"
        ? Math.floor(scaled + EPSILON)
        : Math.round(scaled + EPSILON);
  return rounded / factor;
}

function dateIsEffective(callDate: string, version: PdaTariffVersion): boolean {
  return callDate >= version.effectiveFrom && (!version.effectiveTo || callDate <= version.effectiveTo);
}

function inList(value: string | null | undefined, allowed?: string[]): boolean {
  return !allowed?.length || (!!value && allowed.some((item) => item.toLowerCase() === value.toLowerCase()));
}

function inRange(value: number | null | undefined, min?: number, max?: number): boolean {
  if (min == null && max == null) return true;
  if (value == null) return false;
  return (min == null || value >= min) && (max == null || value <= max);
}

// Facts a rule's conditions need but the call did not supply (PR-09): such a
// rule is neither applied nor silently skipped; it raises MISSING_INPUT.
function missingFacts(rule: PdaTariffRule, request: PdaRequest): string[] {
  const a: PdaApplicability = rule.applicability ?? {};
  const out: string[] = [];
  const list = (name: string, value: string | null | undefined, allowed?: string[]) => {
    if (allowed?.length && !value) out.push(name);
  };
  const range = (name: string, value: number | null | undefined, min?: number, max?: number) => {
    if ((min != null || max != null) && value == null) out.push(name);
  };
  list("vessel type", request.vessel.vesselType, a.vesselTypes);
  list("cargo type", request.call.cargoType, a.cargoTypes);
  list("cargo status", request.call.cargoStatus, a.cargoStatuses);
  list("voyage scope", request.call.voyageScope, a.voyageScopes);
  list("location", request.call.location, a.locations);
  range("GT", request.vessel.gt, a.minGt, a.maxGt);
  range("NT", request.vessel.nt, a.minNt, a.maxNt);
  range("SCNRT", request.vessel.scnrt, a.minScnrt, a.maxScnrt);
  range("DWT", request.vessel.dwt, a.minDwt, a.maxDwt);
  range("LOA", request.vessel.loaM, a.minLoaM, a.maxLoaM);
  range("draft", request.vessel.draftM, a.minDraftM, a.maxDraftM);
  range("cargo quantity", request.call.cargoQuantityMt, a.minCargoQuantityMt, a.maxCargoQuantityMt);
  return out;
}

function requestedServiceExcludes(rule: PdaTariffRule, request: PdaRequest): boolean {
  const wanted = rule.applicability?.requestedServices;
  return !!wanted?.length && !wanted.some((s) => request.call.requestedServices.includes(s));
}

function applies(rule: PdaTariffRule, request: PdaRequest): boolean {
  const a: PdaApplicability = rule.applicability ?? {};
  if (a.requestedServices?.length && !a.requestedServices.some((s) => request.call.requestedServices.includes(s))) return false;
  if (!inList(request.vessel.vesselType, a.vesselTypes)) return false;
  if (!inList(request.call.cargoType, a.cargoTypes)) return false;
  if (!inList(request.call.cargoStatus, a.cargoStatuses)) return false;
  if (!inList(request.call.voyageScope, a.voyageScopes)) return false;
  if (!inList(request.call.location, a.locations)) return false;
  return (
    inRange(request.vessel.gt, a.minGt, a.maxGt) &&
    inRange(request.vessel.nt, a.minNt, a.maxNt) &&
    inRange(request.vessel.scnrt, a.minScnrt, a.maxScnrt) &&
    inRange(request.vessel.dwt, a.minDwt, a.maxDwt) &&
    inRange(request.vessel.loaM, a.minLoaM, a.maxLoaM) &&
    inRange(request.vessel.draftM, a.minDraftM, a.maxDraftM) &&
    inRange(request.call.cargoQuantityMt, a.minCargoQuantityMt, a.maxCargoQuantityMt)
  );
}

function requireNumber(value: number | null | undefined, name: string): number {
  if (value == null || !Number.isFinite(value)) throw new Error(`MISSING_INPUT:${name}`);
  return value;
}

function bandQuantity(rule: PdaTariffRule, request: PdaRequest): number {
  const configured = rule.unit?.toLowerCase();
  if (configured === "gt") return requireNumber(request.vessel.gt, "gt");
  if (configured === "nt") return requireNumber(request.vessel.nt, "nt");
  if (configured === "scnrt") return requireNumber(request.vessel.scnrt, "scnrt");
  if (configured === "dwt") return requireNumber(request.vessel.dwt, "dwt");
  if (configured === "loa_m") return requireNumber(request.vessel.loaM, "loaM");
  if (configured === "days") return request.call.days;
  if (configured === "hours") return request.call.hours ?? request.call.days * 24;
  if (configured === "units") return requireNumber(request.call.units, "units");
  return requireNumber(request.call.cargoQuantityMt, "cargoQuantityMt");
}

function sortedBands(rule: PdaTariffRule): PdaTariffBand[] {
  const bands = [...(rule.bands ?? [])].sort((a, b) => a.order - b.order);
  if (!bands.length) throw new Error("INVALID_TARIFF:no bands configured");
  return bands;
}

function findBand(rule: PdaTariffRule, quantity: number): PdaTariffBand {
  const band = sortedBands(rule).find(
    (candidate) => quantity >= candidate.lowerBound && (candidate.upperBound == null || quantity <= candidate.upperBound),
  );
  // A gap in a published table is a missing line, not a failed estimate (PR-09).
  if (!band) throw new Error(`TARIFF_GAP:no band covers ${quantity}`);
  return band;
}

function progressiveAmount(rule: PdaTariffRule, quantity: number): number {
  // Every slice of [0, quantity] must be covered (C2O-051): an uncovered first
  // or internal interval would otherwise be skipped silently and underprice.
  let covered = 0;
  for (const band of sortedBands(rule)) {
    if (covered >= quantity) break;
    if (band.lowerBound > covered) throw new Error(`TARIFF_GAP:no band covers ${covered} to ${Math.min(band.lowerBound, quantity)}`);
    covered = Math.max(covered, band.upperBound ?? Number.POSITIVE_INFINITY);
  }
  if (covered < quantity) throw new Error(`TARIFF_GAP:no band covers ${covered} to ${quantity}`);
  let total = 0;
  for (const band of sortedBands(rule)) {
    const upper = band.upperBound ?? quantity;
    const units = Math.max(0, Math.min(quantity, upper) - band.lowerBound);
    if (units > 0) total += units * requireNumber(band.rate, `band ${band.order} rate`);
    if (quantity <= upper) break;
  }
  return total;
}

function automaticAmount(rule: PdaTariffRule, request: PdaRequest, prior: Map<string, number>, notApplicable: Set<string>) {
  const included = rule.includedUnits ?? 0;
  switch (rule.basis) {
    case "flat":
    case "per_call":
      return { amount: requireNumber(rule.amount ?? rule.rate, "amount"), quantity: 1, rate: rule.amount ?? rule.rate ?? null };
    case "per_day": {
      const quantity = Math.max(0, request.call.days - included);
      return { amount: quantity * requireNumber(rule.rate, "rate"), quantity, rate: rule.rate ?? null };
    }
    case "per_hour": {
      const hours = request.call.hours ?? request.call.days * 24;
      const quantity = Math.max(0, hours - included);
      return { amount: quantity * requireNumber(rule.rate, "rate"), quantity, rate: rule.rate ?? null };
    }
    case "per_gt": {
      const quantity = Math.max(0, requireNumber(request.vessel.gt, "gt") - included);
      return { amount: quantity * requireNumber(rule.rate, "rate"), quantity, rate: rule.rate ?? null };
    }
    case "per_nt": {
      const quantity = Math.max(0, requireNumber(request.vessel.nt, "nt") - included);
      return { amount: quantity * requireNumber(rule.rate, "rate"), quantity, rate: rule.rate ?? null };
    }
    case "per_scnrt": {
      const quantity = Math.max(0, requireNumber(request.vessel.scnrt, "scnrt") - included);
      return { amount: quantity * requireNumber(rule.rate, "rate"), quantity, rate: rule.rate ?? null };
    }
    case "per_dwt": {
      const quantity = Math.max(0, requireNumber(request.vessel.dwt, "dwt") - included);
      return { amount: quantity * requireNumber(rule.rate, "rate"), quantity, rate: rule.rate ?? null };
    }
    case "per_loa": {
      const quantity = Math.max(0, requireNumber(request.vessel.loaM, "loaM") - included);
      return { amount: quantity * requireNumber(rule.rate, "rate"), quantity, rate: rule.rate ?? null };
    }
    case "per_cargo_mt": {
      const quantity = Math.max(0, requireNumber(request.call.cargoQuantityMt, "cargoQuantityMt") - included);
      return { amount: quantity * requireNumber(rule.rate, "rate"), quantity, rate: rule.rate ?? null };
    }
    case "per_unit": {
      const quantity = Math.max(0, requireNumber(request.call.units, "units") - included);
      return { amount: quantity * requireNumber(rule.rate, "rate"), quantity, rate: rule.rate ?? null };
    }
    case "percentage": {
      const codes = rule.applicability?.percentageBaseCodes ?? [];
      if (!codes.length) throw new Error("INVALID_TARIFF:percentageBaseCodes required");
      const quantity = codes.reduce((sum, code) => {
        // A base rule that does not apply to this call contributes nothing (PR-09);
        // one that applies but could not be priced still blocks the line.
        if (!prior.has(code)) {
          if (notApplicable.has(code)) return sum;
          throw new Error(`MISSING_INPUT:calculated percentage base ${code}`);
        }
        return sum + prior.get(code)!;
      }, 0);
      const rate = requireNumber(rule.rate, "percentage rate");
      return { amount: quantity * (rate / 100), quantity, rate };
    }
    case "tiered_flat": {
      const quantity = bandQuantity(rule, request);
      const band = findBand(rule, quantity);
      return { amount: requireNumber(band.flatAmount ?? band.rate, `band ${band.order} amount`), quantity, rate: null };
    }
    case "tiered_rate": {
      const quantity = bandQuantity(rule, request);
      const rate = requireNumber(findBand(rule, quantity).rate, "band rate");
      return { amount: quantity * rate, quantity, rate };
    }
    case "progressive": {
      const quantity = bandQuantity(rule, request);
      return { amount: progressiveAmount(rule, quantity), quantity, rate: null };
    }
    case "manual_quote":
      throw new Error("MANUAL_QUOTE");
  }
}

function makeExplanation(rule: PdaTariffRule, quantity: number | null, rate: number | null, beforeTax: number, amount: number) {
  const parts = [`${rule.label}: ${rule.basis}`];
  if (quantity != null) parts.push(`quantity ${quantity}`);
  if (rate != null) parts.push(`rate ${rate}`);
  if (rule.minimumAmount != null) parts.push(`minimum ${rule.minimumAmount}`);
  if (rule.maximumAmount != null) parts.push(`maximum ${rule.maximumAmount}`);
  if (rule.taxPercent) parts.push(`tax ${rule.taxPercent}%`);
  parts.push(`calculated ${beforeTax}`, `rounded ${amount}`);
  return parts.join("; ");
}

function warning(code: PdaWarning["code"], message: string, ruleCode?: string): PdaWarning {
  return { code, message, ...(ruleCode ? { ruleCode } : {}) };
}

type ManualLine = NonNullable<PdaRequest["manualLines"]>[number];

function indexManualRuleQuotes(lines: ManualLine[]): {
  byRule: Map<string, ManualLine>;
  suppliedRuleCodes: Set<string>;
  duplicateRuleCodes: Set<string>;
} {
  const grouped = new Map<string, ManualLine[]>();
  for (const line of lines) {
    if (!line.ruleCode) continue;
    const group = grouped.get(line.ruleCode) ?? [];
    group.push(line);
    grouped.set(line.ruleCode, group);
  }
  const duplicateRuleCodes = new Set(
    [...grouped.entries()].filter(([, group]) => group.length > 1).map(([code]) => code),
  );
  return {
    byRule: new Map(
      [...grouped.entries()]
        .filter(([code]) => !duplicateRuleCodes.has(code))
        .map(([code, group]) => [code, group[0]!] as const),
    ),
    suppliedRuleCodes: new Set(grouped.keys()),
    duplicateRuleCodes,
  };
}

function manualQuotesNotApplied(lines: ManualLine[], context: string): PdaWarning[] {
  return lines.map((line) => warning(
    "MANUAL_QUOTE_NOT_APPLIED",
    `${line.label} was not applied because ${context}; no manual amount was priced.`,
    line.ruleCode ?? undefined,
  ));
}

function governedServiceCodes(rule: PdaTariffRule): string[] {
  const applicability = rule.applicability?.requestedServices ?? [];
  // A rule code is stable provenance. A single service applicability is also
  // unambiguous; a multi-value list is only an OR-condition and must not be
  // misrepresented as proving that every listed service was priced.
  return [...new Set([rule.code, ...(applicability.length === 1 ? applicability : [])])];
}

export function calculatePda(rawRequest: PdaRequest, rawVersion: PdaTariffVersion | null): PdaCalculationResult {
  const request = pdaRequestSchema.parse(rawRequest) as PdaRequest;
  const manualLines = request.manualLines ?? [];
  const generatedAt = new Date().toISOString();
  const emptyCurrency = rawVersion?.currency ?? request.convertedCurrency ?? "USD";

  if (!rawVersion) {
    return {
      coverage: "manual_required",
      tariffVersionId: null,
      nativeCurrency: emptyCurrency,
      lines: [],
      totals: { native: 0 },
      warnings: [
        warning("NO_PUBLISHED_TARIFF", `No published tariff exists for ${request.portLocode}.`),
        ...manualQuotesNotApplied(manualLines, "no effective published tariff and currency govern this call"),
      ],
      generatedAt,
    };
  }

  const version = pdaTariffVersionSchema.parse(rawVersion) as PdaTariffVersion;
  const warnings: PdaWarning[] = [];
  if (version.portLocode !== request.portLocode) {
    return {
      coverage: "manual_required",
      tariffVersionId: null,
      nativeCurrency: version.currency,
      lines: [],
      totals: { native: 0 },
      warnings: [
        warning("PORT_MISMATCH", "The selected tariff belongs to a different port."),
        ...manualQuotesNotApplied(manualLines, "the selected tariff belongs to a different port"),
      ],
      generatedAt,
    };
  }
  // A port-wide tariff (terminalId = null) deliberately applies to every
  // terminal at that port. A terminal-scoped tariff must remain an exact
  // match and may never leak to a neighbouring terminal.
  if (version.terminalId != null && version.terminalId !== (request.terminalId ?? null)) {
    return {
      coverage: "manual_required",
      tariffVersionId: null,
      nativeCurrency: version.currency,
      lines: [],
      totals: { native: 0 },
      warnings: [
        warning("TERMINAL_MISMATCH", "The selected tariff does not match the exact terminal scope."),
        ...manualQuotesNotApplied(manualLines, "the selected tariff does not govern this terminal"),
      ],
      generatedAt,
    };
  }
  if (!dateIsEffective(request.callDate, version)) {
    return {
      coverage: "manual_required",
      tariffVersionId: null,
      nativeCurrency: version.currency,
      lines: [],
      totals: { native: 0 },
      warnings: [
        warning("VERSION_NOT_EFFECTIVE", `Tariff version is not effective on ${request.callDate}.`),
        ...manualQuotesNotApplied(manualLines, `the tariff is not effective on ${request.callDate}`),
      ],
      generatedAt,
    };
  }

  const lines: PdaExplainedLine[] = [];
  const byCode = new Map<string, number>();
  const manualQuotes = indexManualRuleQuotes(manualLines);
  const manualByRule = manualQuotes.byRule;
  const applicableManualRuleCodes = new Set<string>();
  const notApplicable = new Set<string>();
  for (const code of manualQuotes.duplicateRuleCodes) {
    warnings.push(warning(
      "MANUAL_QUOTE_DUPLICATE",
      `Multiple manual quotations target rule ${code}; none of those quotations was applied.`,
      code,
    ));
  }

  for (const rule of [...version.rules].sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code))) {
    if (requestedServiceExcludes(rule, request)) { notApplicable.add(rule.code); continue; }
    const missing = missingFacts(rule, request);
    if (missing.length) {
      warnings.push(warning("MISSING_INPUT", `${rule.label} requires ${missing.join(", ")} to decide whether it applies.`, rule.code));
      continue;
    }
    if (!applies(rule, request)) { notApplicable.add(rule.code); continue; }
    const manual = manualByRule.get(rule.code);
    if (rule.basis === "manual_quote") {
      applicableManualRuleCodes.add(rule.code);
      if (!manual) {
        warnings.push(
          warning(
            "MANUAL_QUOTE_REQUIRED",
            rule.manualInstructions || `${rule.label} requires an authorized manual quotation.`,
            rule.code,
          ),
        );
        continue;
      }
      const amount = round(manual.amount, version.decimalPlaces, version.roundingMode);
      byCode.set(rule.code, amount);
      lines.push({
        ruleId: rule.id,
        ruleCode: rule.code,
        label: manual.label,
        basis: "manual",
        quantity: null,
        rate: null,
        amount,
        ...(request.fxRate ? { convertedAmount: round(amount * request.fxRate, version.decimalPlaces, version.roundingMode) } : {}),
        explanation: `Authorized manual quotation: ${manual.reason}`,
        inputs: { serviceCodes: governedServiceCodes(rule) },
        serviceCodes: governedServiceCodes(rule),
        manual: true,
        manualReason: manual.reason,
        enteredBy: manual.enteredBy,
        evidence: rule.source,
      });
      warnings.push(warning("MANUAL_LINE", `${rule.label} was entered manually.`, rule.code));
      continue;
    }

    try {
      const calculated = automaticAmount(rule, request, byCode, notApplicable);
      let beforeTax = calculated.amount;
      if (rule.minimumAmount != null) beforeTax = Math.max(beforeTax, rule.minimumAmount);
      if (rule.maximumAmount != null) beforeTax = Math.min(beforeTax, rule.maximumAmount);
      const withTax = beforeTax * (1 + (rule.taxPercent ?? 0) / 100);
      const amount = round(withTax, version.decimalPlaces, version.roundingMode);
      byCode.set(rule.code, amount);
      lines.push({
        ruleId: rule.id,
        ruleCode: rule.code,
        label: rule.label,
        basis: rule.basis,
        quantity: calculated.quantity,
        rate: calculated.rate,
        amount,
        ...(request.fxRate ? { convertedAmount: round(amount * request.fxRate, version.decimalPlaces, version.roundingMode) } : {}),
        explanation: makeExplanation(rule, calculated.quantity, calculated.rate, beforeTax, amount),
        inputs: {
          quantity: calculated.quantity,
          rate: calculated.rate,
          serviceCodes: governedServiceCodes(rule),
        },
        serviceCodes: governedServiceCodes(rule),
        manual: false,
        evidence: rule.source,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("TARIFF_GAP:")) {
        warnings.push(warning("TARIFF_GAP", `${rule.label}: the published table has no band for ${message.slice("TARIFF_GAP:no band covers ".length)}; the line is not priced.`, rule.code));
        continue;
      }
      if (message.startsWith("MISSING_INPUT:")) {
        warnings.push(warning("MISSING_INPUT", `${rule.label} requires ${message.slice("MISSING_INPUT:".length)}.`, rule.code));
        continue;
      }
      throw error;
    }
  }

  for (const code of manualQuotes.suppliedRuleCodes) {
    if (!applicableManualRuleCodes.has(code)) {
      warnings.push(warning(
        "MANUAL_QUOTE_UNMATCHED",
        `Manual quotation rule ${code} is unknown, not applicable to this call, or not a manual-quote rule; it was not applied.`,
        code,
      ));
    }
  }

  for (const manual of manualLines) {
    if (manual.ruleCode) continue;
    const amount = round(manual.amount, version.decimalPlaces, version.roundingMode);
    lines.push({
      ruleId: null,
      ruleCode: null,
      label: manual.label,
      basis: "manual",
      quantity: null,
      rate: null,
      amount,
      ...(request.fxRate ? { convertedAmount: round(amount * request.fxRate, version.decimalPlaces, version.roundingMode) } : {}),
      explanation: `Authorized manual line: ${manual.reason}`,
      inputs: { serviceCodes: [] },
      serviceCodes: [],
      manual: true,
      manualReason: manual.reason,
      enteredBy: manual.enteredBy,
      evidence: {},
    });
    warnings.push(warning("MANUAL_LINE", `${manual.label} was entered manually.`));
  }

  if (!lines.length && !warnings.length) warnings.push(warning("NO_APPLICABLE_RULES", "No published rule applies to the supplied call facts."));
  const native = round(lines.reduce((sum, line) => sum + line.amount, 0), version.decimalPlaces, version.roundingMode);
  const converted = request.fxRate
    ? round(lines.reduce((sum, line) => sum + (line.convertedAmount ?? 0), 0), version.decimalPlaces, version.roundingMode)
    : undefined;
  const incomplete = warnings.some((item) => (
    item.code === "MISSING_INPUT"
    || item.code === "TARIFF_GAP"
    || item.code === "MANUAL_QUOTE_REQUIRED"
    || item.code === "MANUAL_QUOTE_DUPLICATE"
    || item.code === "MANUAL_QUOTE_UNMATCHED"
    || item.code === "MANUAL_QUOTE_NOT_APPLIED"
  ));
  const anyManual = lines.some((line) => line.manual);

  return {
    coverage: !lines.length ? "manual_required" : incomplete ? "partial" : anyManual ? "partial" : "published",
    tariffVersionId: version.id,
    nativeCurrency: version.currency,
    ...(request.convertedCurrency && request.fxRate ? { convertedCurrency: request.convertedCurrency } : {}),
    lines,
    totals: { native, ...(converted != null ? { converted } : {}) },
    warnings,
    generatedAt,
  };
}
