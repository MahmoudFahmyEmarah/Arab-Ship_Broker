// The Suez estimate → the Voyage canal input. One function for the browser
// preview and the server save, so both always label the canal the same way
// (audit C2O-039 P1-8):
//   · trusted  — only from a trusted Suez estimate;
//   · manual   — complete, and the only departure from trusted is the broker's
//                stamped SDR override;
//   · fallback — complete but partial for any other reason (reported or
//                unmodelled surcharge, undecided flags, placeholder bands): the
//                figure is shown, labelled, and the voyage is partial;
//   · unavailable — no estimate, invalid, or incomplete: no figure.
import type { SuezEstimate } from "@/lib/suez/types";
import type { CanalInput, VoyageSettings } from "./types";

export function canalFromSuez(suez: SuezEstimate | null, settings: VoyageSettings, anchorageInEca: boolean): CanalInput {
  const complete = !!suez && suez.status !== "invalid" && suez.totals.complete;
  let status: CanalInput["status"] = "unavailable";
  if (complete && suez) {
    if (suez.status === "trusted") status = "trusted";
    else {
      const ok = (s: string) => s === "trusted" || s === "manual";
      const manualOnly = suez.sdrRate.status === "manual" && ok(suez.layers.toll.status) && ok(suez.layers.surcharge.status)
        && suez.layers.fixed.every((l) => ok(l.status)) && suez.layers.waste.every((l) => ok(l.status))
        && suez.layers.conditional.every((f) => f.triggered !== null && (f.triggered === false || ok(f.status)));
      status = manualOnly ? "manual" : "fallback";
    }
  }
  return {
    required: true,
    name: "Suez",
    status,
    costUsd: complete && suez ? suez.totals.appliedUsd : null,
    transitDays: suez?.transitDays ?? settings.suez.transitDays,
    anchorageDays: suez?.anchorageDays ?? settings.suez.anchorageDays,
    anchorageInEca,
    nm: settings.suez.nm,
    tariffVersionNo: suez?.tariffVersion.versionNo ?? null,
    complete,
  };
}
