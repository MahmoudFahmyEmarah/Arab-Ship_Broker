// voyage_settings validation (admin writes on /admin/voyage-data).
import { z } from "zod";
import type { VoyageSettings } from "./types";

const pctSmall = z.number().finite().min(0).max(100);
const days = z.number().finite().min(0).max(60);

export const voyageSettingsSchema = z.object({
  speeds: z.object({ ladenKn: z.number().finite().min(3).max(40), ballastKn: z.number().finite().min(3).max(40) }).strict(),
  seaMargin: z.object({
    defaultPct: pctSmall,
    byLane: z.record(z.string().regex(/^[A-Z0-9.]+>[A-Z0-9.]+$/), pctSmall).default({}),
    bySeason: z.partialRecord(z.enum(["winter", "spring", "summer", "autumn"]), pctSmall).default({}),
  }).strict(),
  portTimeDays: z.object({ loadDefault: days, dischDefault: days, idleSharePct: pctSmall }).strict(),
  anchorageDaysDefault: days,
  suez: z.object({ transitDays: days, anchorageDays: days, nm: z.number().finite().min(0).max(500) }).strict(),
  opex: z.object({ crewUsdDay: z.number().finite().min(0).max(100000), maintenanceUsdDay: z.number().finite().min(0).max(100000) }).strict(),
  classMultipliers: z.object({ A: z.number().finite().min(0.1).max(10), B: z.number().finite().min(0.1).max(10), C: z.number().finite().min(0.1).max(10) }).strict(),
  eca: z.object({ fuelProductKey: z.enum(["LSMGO", "ULSFO", "MGO05", "MDO"]) }).strict(),
  fuelFallback: z.record(z.string().regex(/^[A-Z0-9]{2,12}$/), z.number().finite().min(1).max(10000)),
}).strict();

export function parseVoyageSettings(v: unknown): { ok: true; value: VoyageSettings } | { ok: false; error: string } {
  const r = voyageSettingsSchema.safeParse(v);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, value: r.data as VoyageSettings };
}
