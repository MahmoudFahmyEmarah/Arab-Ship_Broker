// Voyage ← PDA: a port DA taken from a saved PDA estimate (B2O-020 P2). Pure: the save fetches the estimate through
// get_pda_estimate (the PDA module's authorised read) and passes it here. Fail-closed: another port, no USD total or
// a malformed estimate is refused; the estimate's coverage decides the status (published → trusted,
// partial → fallback, manual_required → manual).
export type PdaCoverage = "published" | "partial" | "manual_required";
export interface PdaEstimateView { id?: unknown; portLocode?: unknown; coverage?: unknown; nativeCurrency?: unknown; nativeTotal?: unknown; convertedCurrency?: unknown; convertedTotal?: unknown }

export function pdaFromEstimate(est: PdaEstimateView | null, port: string | null, estimateId: string):
  { ok: true; usd: number; coverage: PdaCoverage; estimateId: string } | { ok: false; error: string } {
  if (!est || est.id !== estimateId) return { ok: false, error: "The linked PDA estimate is not available to you; choose another or enter the DA manually." };
  if (!port || est.portLocode !== port) return { ok: false, error: `The PDA estimate is for ${String(est.portLocode ?? "another port")}, not ${port ?? "this port"}; choose an estimate for this port.` };
  const coverage = est.coverage === "published" || est.coverage === "partial" || est.coverage === "manual_required" ? est.coverage : null;
  if (!coverage) return { ok: false, error: "The PDA estimate has no recognised coverage." };
  const usd = est.nativeCurrency === "USD" ? Number(est.nativeTotal) : est.convertedCurrency === "USD" ? Number(est.convertedTotal) : NaN;
  if (!Number.isFinite(usd) || usd < 0) return { ok: false, error: "The PDA estimate has no USD total; convert it in the Ports DA calculator or enter the DA manually." };
  return { ok: true, usd: Math.round(usd * 100) / 100, coverage, estimateId };
}

export const pdaStatusFor = (coverage: PdaCoverage | undefined): "trusted" | "fallback" | "manual" =>
  coverage === "published" ? "trusted" : coverage === "partial" ? "fallback" : "manual";
