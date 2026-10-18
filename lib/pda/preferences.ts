// PDA · member preferences for the Setup tab (owner ruling O2ALL-008, increment D; 20261018110000).
//
// A preference changes how the estimator is SHOWN, never a figure and never where a figure came from. They live in one
// governed row per member (pda_member_preferences), read with get_my_pda_preferences and written with
// set_my_pda_preferences; nothing is kept in browser storage.
import type { PdaEstimatorDensity } from "./estimator-contract";

export type PdaStartTab = "estimate" | "ports";

export interface PdaPreferences {
  density: PdaEstimatorDensity;
  startTab: PdaStartTab;
  /** false until the member has saved once (the values are then the defaults) */
  saved: boolean;
}

export const PDA_PREFERENCE_DEFAULTS: PdaPreferences = { density: "compact", startTab: "estimate", saved: false };

export const PDA_DENSITY_OPTIONS: readonly { id: PdaEstimatorDensity; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "comfortable", label: "Comfortable" },
];

export const PDA_START_TAB_OPTIONS: readonly { id: PdaStartTab; label: string }[] = [
  { id: "estimate", label: "Estimate" },
  { id: "ports", label: "Ports" },
];

export function parsePdaPreferences(raw: unknown): PdaPreferences {
  const value = (raw ?? {}) as { density?: unknown; startTab?: unknown; saved?: unknown };
  return {
    density: value.density === "comfortable" ? "comfortable" : "compact",
    startTab: value.startTab === "ports" ? "ports" : "estimate",
    saved: value.saved === true,
  };
}

/**
 * The tab the page opens on. A handoff (a vessel, cargo or port sent from the Fixture Room or another surface) always
 * opens the Estimate, because that is what the sender asked for; otherwise the member's start tab applies.
 */
export function initialPdaTab(preferences: PdaPreferences, hasHandoff: boolean): PdaStartTab {
  return hasHandoff ? "estimate" : preferences.startTab;
}
