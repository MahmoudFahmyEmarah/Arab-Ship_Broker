import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_VOYAGE_SETTINGS, type VoyageSettings } from "@/lib/voyage/types";

// Voyage estimator settings live in app_settings.voyage_settings (members read,
// admins write on /admin/voyage-data). Missing keys fall back to the defaults so
// a partial admin edit never breaks the engine.
export async function getVoyageSettings(supabase: SupabaseClient): Promise<VoyageSettings> {
  try {
    const { data, error } = await supabase.from("app_settings").select("value").eq("key", "voyage_settings").maybeSingle();
    if (error || !data?.value) return DEFAULT_VOYAGE_SETTINGS;
    return mergeVoyageSettings(data.value as Partial<VoyageSettings>);
  } catch {
    return DEFAULT_VOYAGE_SETTINGS;
  }
}

export function mergeVoyageSettings(v: Partial<VoyageSettings> | null | undefined): VoyageSettings {
  const d = DEFAULT_VOYAGE_SETTINGS;
  if (!v) return d;
  return {
    speeds: { ...d.speeds, ...(v.speeds ?? {}) },
    seaMargin: { ...d.seaMargin, ...(v.seaMargin ?? {}) },
    portTimeDays: { ...d.portTimeDays, ...(v.portTimeDays ?? {}) },
    anchorageDaysDefault: v.anchorageDaysDefault ?? d.anchorageDaysDefault,
    suez: { ...d.suez, ...(v.suez ?? {}) },
    opex: { ...d.opex, ...(v.opex ?? {}) },
    classMultipliers: { ...d.classMultipliers, ...(v.classMultipliers ?? {}) },
    eca: { ...d.eca, ...(v.eca ?? {}) },
    fuelFallback: { ...d.fuelFallback, ...(v.fuelFallback ?? {}) },
  };
}
