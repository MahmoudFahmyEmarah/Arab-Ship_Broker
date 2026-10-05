// The Suez estimate → a Voyage canal input. One function for the browser
// preview and the server save, so both always label the canal the same way
// (audit C2O-039 P1-8, C2O-043, Opus B PR-03):
//   · trusted  — only from a trusted Suez estimate;
//   · manual   — complete, and the only departure from trusted is the broker's
//                stamped SDR override; or the Suez estimate is incomplete and the
//                broker entered the canal cost with a reason (PR-03 e);
//   · fallback — complete but partial for any other reason (reported or
//                unmodelled surcharge, undecided flags, placeholder bands): the
//                figure is shown, labelled, and the voyage is partial;
//   · unavailable — no estimate, invalid, or incomplete without a manual cost.
import type { SuezEstimate } from "@/lib/suez/types";
import type { ManualProvenance } from "./snapshots";
import type { CanalInput, VoyageSettings } from "./types";

export interface CanalOptions {
  leg?: "laden" | "ballast";
  anchorageInEca: boolean;
  anchorageInEcaSource?: "governed" | "coarse" | "manual";
  /** broker canal cost, used only when the Suez estimate is incomplete */
  manualCost?: { usd: number; manual: ManualProvenance } | null;
}

export function canalFromSuez(suez: SuezEstimate | null, settings: VoyageSettings, opts: CanalOptions): CanalInput {
  const complete = !!suez && suez.status !== "invalid" && suez.totals.complete;
  let status: CanalInput["status"] = "unavailable";
  let costUsd: number | null = complete && suez ? suez.totals.appliedUsd : null;
  let manual: ManualProvenance | undefined;
  if (complete && suez) {
    if (suez.status === "trusted") status = "trusted";
    else {
      const ok = (s: string) => s === "trusted" || s === "manual";
      const manualOnly = suez.sdrRate.status === "manual" && ok(suez.layers.toll.status) && ok(suez.layers.surcharge.status)
        && suez.layers.fixed.every((l) => ok(l.status)) && suez.layers.waste.every((l) => ok(l.status))
        && suez.layers.conditional.every((f) => f.triggered !== null && (f.triggered === false || ok(f.status)));
      status = manualOnly ? "manual" : "fallback";
    }
  } else if (opts.manualCost && Number.isFinite(opts.manualCost.usd) && opts.manualCost.usd >= 0 && opts.manualCost.manual.reason.trim().length >= 3) {
    status = "manual";
    costUsd = opts.manualCost.usd;
    manual = opts.manualCost.manual;
  }
  return {
    required: true,
    name: "Suez",
    leg: opts.leg ?? "laden",
    status,
    costUsd,
    transitDays: suez?.transitDays ?? settings.suez.transitDays,
    anchorageDays: suez?.anchorageDays ?? settings.suez.anchorageDays,
    anchorageInEca: opts.anchorageInEca,
    anchorageInEcaSource: opts.anchorageInEcaSource ?? "manual",
    nm: settings.suez.nm,
    tariffVersionNo: suez?.tariffVersion.versionNo ?? null,
    complete,
    ...(manual ? { manual } : {}),
  };
}

// The date the ship is expected at the canal: the plan's start (laycan, else today) moved by the days of the
// legs sailed before the transit. A transit inside a leg is placed half-way along it. The tariff and the SDR
// rate are then taken on that date, never on today's (Opus B PR-03 c).
export function suezTransitDate(startIso: string, offsetDays: number): string {
  const d = new Date(`${startIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(offsetDays));
  return d.toISOString().slice(0, 10);
}
