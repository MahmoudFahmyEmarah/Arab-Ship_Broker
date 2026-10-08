// Which unconfirmed platform constants a displayed figure rests on (B2O-020 P2: the "platform assumption" badge on
// every assumed figure, not only the running cost). The engine lists only the constants it actually used.
export type AssumptionArea = "sea" | "port" | "canal" | "running" | "seaMargin";
const AREA_KEYS: Record<AssumptionArea, (key: string) => boolean> = {
  sea: (k) => k === "speeds" || k === "seaMargin.defaultPct",
  seaMargin: (k) => k === "seaMargin.defaultPct",
  port: (k) => k === "portTimeDays",
  canal: (k) => k === "suez.days",
  running: (k) => k.startsWith("opex.") || k === "classMultipliers",
};

export function assumptionsFor(area: AssumptionArea, platformAssumptions: { key: string; label: string }[]): { key: string; label: string }[] {
  return platformAssumptions.filter((p) => AREA_KEYS[area](p.key));
}

/** the area a leg's days depend on: sea passages, port calls, canal transit / convoy anchorage */
export function legArea(kind: string): AssumptionArea | null {
  return kind === "sea" ? "sea" : kind === "port" ? "port" : kind === "canal" ? "canal" : null;
}
