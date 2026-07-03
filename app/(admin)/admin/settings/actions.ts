"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  BETA_MODE_KEY,
  PLATFORM_MODE_KEY,
  COMING_SOON_DESIGN_KEY,
  PLATFORM_SETTINGS_KEY,
  COMING_SOON_VARIANTS,
  normalizeComingSoonDesign,
  type PlatformMode,
  type ComingSoonDesign,
  type ComingSoonVariant,
  type PlatformSettingsData,
} from "@/lib/app-settings";

// Flip the global beta-mode flag. Owner-only (the "settings" section is
// owner-only in the authorization registry); the edit guard keeps view seats
// from writing. Writes go through the service-role key (bypasses RLS).
export async function setBetaMode(enabled: boolean) {
  await requireAdmin({ section: "settings", edit: true });

  const { error } = await getSupabaseAdminClient()
    .from("app_settings")
    .upsert(
      { key: BETA_MODE_KEY, value: enabled, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/settings");
  // The flag changes what every non-admin sees across the whole portal.
  revalidatePath("/dashboard", "layout");
  return { success: true };
}

// Persist the platform mode + coming-soon design in one go. beta_mode is kept
// in sync (true only for "Beta") so the dashboard gate keeps reading a single
// boolean. Owner-only; writes bypass RLS via the service-role key.
export async function savePlatformSettings(input: {
  mode: PlatformMode;
  design: ComingSoonDesign;
  settings: PlatformSettingsData;
}) {
  await requireAdmin({ section: "settings", edit: true });

  const valid: PlatformMode[] = ["Live", "Beta", "Test", "Maintenance"];
  const allowedVariants = COMING_SOON_VARIANTS as readonly ComingSoonVariant[];
  const designOk =
    Array.isArray(input.design) &&
    input.design.length > 0 &&
    input.design.every((d) => allowedVariants.includes(d));
  if (!valid.includes(input.mode) || !designOk) {
    return { success: false, error: "Invalid settings payload" };
  }
  if (!input.settings || typeof input.settings !== "object") {
    return { success: false, error: "Invalid settings payload" };
  }

  // Store in canonical order / de-duplicated.
  const design = normalizeComingSoonDesign(input.design);
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdminClient()
    .from("app_settings")
    .upsert(
      [
        { key: PLATFORM_MODE_KEY, value: input.mode, updated_at: now },
        { key: COMING_SOON_DESIGN_KEY, value: design, updated_at: now },
        { key: BETA_MODE_KEY, value: input.mode === "Beta", updated_at: now },
        { key: PLATFORM_SETTINGS_KEY, value: input.settings, updated_at: now },
      ],
      { onConflict: "key" },
    );

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/settings");
  // These settings change what every non-admin sees across the whole portal.
  revalidatePath("/dashboard", "layout");
  return { success: true };
}
