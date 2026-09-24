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
  if (!band) throw new Error(`INVALID_TARIFF:no band covers ${quantity}`);
  return band;
}

function progressiveAmount(rule: PdaTariffRule, quantity: number): number {
  let total = 0;
  for (const band of sortedBands(rule)) {
    const upper = band.upperBound ?? quantity;
    const units = Math.max(0, Math.min(quantity, upper) - band.lowerBound);
    if (units > 0) total += units * requireNumber(band.rate, `band ${band.order} rate`);
    if (quantity <= upper) break;
  }
  return total;
}

function automaticAmount(rule: PdaTariffRule, request: PdaRequest, prior: Map<string, number>) {
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
        if (!prior.has(code)) throw new Error(`MISSING_INPUT:calculated percentage base ${code}`);
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

export function calculatePda(rawRequest: PdaRequest, rawVersion: PdaTariffVersion | null): PdaCalculationResult {
  const request = pdaRequestSchema.parse(rawRequest) as PdaRequest;
  const generatedAt = new Date().toISOString();
  const emptyCurrency = rawVersion?.currency ?? request.convertedCurrency ?? "USD";

  if (!rawVersion) {
    return {
      coverage: "manual_required",
      tariffVersionId: null,
      nativeCurrency: emptyCurrency,
      lines: [],
      totals: { native: 0 },
      warnings: [warning("NO_PUBLISHED_TARIFF", `No published tariff exists for ${request.portLocode}.`)],
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
      warnings: [warning("PORT_MISMATCH", "The selected tariff belongs to a different port.")],
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
      warnings: [warning("TERMINAL_MISMATCH", "The selected tariff does not match the exact terminal scope.")],
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
      warnings: [warning("VERSION_NOT_EFFECTIVE", `Tariff version is not effective on ${request.callDate}.`)],
      generatedAt,
    };
  }

  const lines: PdaExplainedLine[] = [];
  const byCode = new Map<string, number>();
  const manualByRule = new Map((request.manualLines ?? []).filter((line) => line.ruleCode).map((line) => [line.ruleCode!, line]));

  for (const rule of [...version.rules].sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code))) {
    if (!applies(rule, request)) continue;
    const manual = manualByRule.get(rule.code);
    if (rule.basis === "manual_quote") {
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
        inputs: {},
        manual: true,
        manualReason: manual.reason,
        enteredBy: manual.enteredBy,
        evidence: rule.source,
      });
      warnings.push(warning("MANUAL_LINE", `${rule.label} was entered manually.`, rule.code));
      continue;
    }

    try {
      const calculated = automaticAmount(rule, request, byCode);
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
        inputs: { quantity: calculated.quantity, rate: calculated.rate },
        manual: false,
        evidence: rule.source,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("MISSING_INPUT:")) {
        warnings.push(warning("MISSING_INPUT", `${rule.label} requires ${message.slice("MISSING_INPUT:".length)}.`, rule.code));
        continue;
      }
      throw error;
    }
  }

  for (const manual of request.manualLines ?? []) {
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
      inputs: {},
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
  const incomplete = warnings.some((item) => item.code === "MISSING_INPUT" || item.code === "MANUAL_QUOTE_REQUIRED");
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
