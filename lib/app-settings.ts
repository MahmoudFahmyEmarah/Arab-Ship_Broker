import { getSupabaseServerClient } from "@/lib/supabase/server";

// Global platform flags live in public.app_settings (key/jsonb value). Keys are
// centralised here so the reader, the admin action, and any future flag share
// one source of truth.
export const BETA_MODE_KEY = "beta_mode";
export const PLATFORM_MODE_KEY = "platform_mode";
export const COMING_SOON_DESIGN_KEY = "coming_soon_design";
// Everything else on the Administration page (AI provider, marketplace defaults
// and default card fields) is stored as one JSON blob under this key.
export const PLATFORM_SETTINGS_KEY = "platform_settings";

// The four operating modes shown in admin → Platform settings. Only "Beta"
// currently changes member-facing behaviour (gates everything but the
// Dashboard); the others are wired visually and reserved for later.
export type PlatformMode = "Live" | "Beta" | "Test" | "Maintenance";

// The maritime "coming soon" overlay designs a member can see on a gated page.
export const COMING_SOON_VARIANTS = ["radar", "beacon", "compass"] as const;
export type ComingSoonVariant = (typeof COMING_SOON_VARIANTS)[number];

// Which designs are enabled. A single entry forces that design on every gated
// page; multiple entries rotate page-to-page. Stored as an array of variants;
// legacy string values ("radar"/"beacon"/"both") are still read — see
// normalizeComingSoonDesign.
export type ComingSoonDesign = ComingSoonVariant[];

// Read a single app_settings row's jsonb value. Returns null on any failure so
// callers can fall back to a safe default (the table may predate the migration).
async function readSetting<T>(key: string): Promise<T | null> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) return null;
    return (data?.value ?? null) as T | null;
  } catch {
    return null;
  }
}

// Read the global beta-mode flag (server-side). Defaults to false if the
// app_settings table/row is missing or unreadable, so the portal never
// hard-fails on a database that hasn't had the migration applied yet.
export async function getBetaMode(): Promise<boolean> {
  const value = await readSetting<boolean>(BETA_MODE_KEY);
  return value === true;
}

// Read the selected platform mode. Falls back to deriving from the legacy
// beta_mode flag (Beta when on, otherwise Live) so existing databases keep
// working before the new key is ever written.
export async function getPlatformMode(): Promise<PlatformMode> {
  const value = await readSetting<string>(PLATFORM_MODE_KEY);
  if (value === "Live" || value === "Beta" || value === "Test" || value === "Maintenance") {
    return value;
  }
  const beta = await getBetaMode();
  return beta ? "Beta" : "Live";
}

// Accept both the legacy single-string values and the new array form; always
// return a non-empty list in canonical order (COMING_SOON_VARIANTS). Unknown /
// empty input falls back to radar+beacon, the original alternating behaviour.
export function normalizeComingSoonDesign(value: unknown): ComingSoonDesign {
  if (value === "both") return ["radar", "beacon"];
  if (
    typeof value === "string" &&
    (COMING_SOON_VARIANTS as readonly string[]).includes(value)
  ) {
    return [value as ComingSoonVariant];
  }
  if (Array.isArray(value)) {
    const picked = COMING_SOON_VARIANTS.filter((v) => value.includes(v));
    if (picked.length) return picked;
  }
  return ["radar", "beacon"];
}

// Read the coming-soon design preference. Defaults to radar+beacon (alternating)
// when unset.
export async function getComingSoonDesign(): Promise<ComingSoonDesign> {
  const value = await readSetting<unknown>(COMING_SOON_DESIGN_KEY);
  return normalizeComingSoonDesign(value);
}

// ── Everything else on the Administration page (one JSON blob) ───────────────
export type AiSettings = {
  vendor: string;
  model: string;
  baseUrl: string;
  apiKey: string;
};

export type MarketplaceDefaults = {
  archiveLayer1: string;
  archiveLayer2: string;
  archiveLayer3: string;
  // How many days a spot cargo (no fixed laycan) stays "active" — counted in the
  // public hero stats and shown on the cargo board — measured from when it was
  // posted (created_at). Without this, spot cargoes never aged out and inflated
  // the "available this week" count. Read as a string; parsed where used.
  spotActiveDays: string;
  // Same idea for vessels with no fixed open date (open_date IS NULL): they stay
  // "open this week" for this many days after posting, then age out. Vessels that
  // DO carry an open date use the ±7-day date window instead.
  vesselActiveDays: string;
  // Market Insights only: for a DATED open position, how many days BEFORE the
  // report week a vessel's open_date may fall and still count as "open" that
  // week (a ship opening shortly before the week is still relevant). Distinct
  // from the home board's ±7-day dated window — Insights looks further back.
  // The two 14-day recency windows above are shared with get_public_stats();
  // this lookback is Insights-specific. Read by fn_build_market_insights.
  insightsOpenLookbackDays: string;
  brokerCommission: string;
  despatchRate: string;
  demurrage: string;
  iacDefault: string;
};

// Fallbacks when a setting is unset/blank/non-numeric. Kept in sync with the
// get_public_stats() SQL defaults so the hero and the boards agree.
export const DEFAULT_SPOT_ACTIVE_DAYS = 14;
export const DEFAULT_VESSEL_ACTIVE_DAYS = 14;
// Insights-only dated open-position lookback. Kept in sync with the
// fn_build_market_insights() SQL fallback.
export const DEFAULT_INSIGHTS_OPEN_LOOKBACK_DAYS = 14;

export type PlatformSettingsData = {
  ai: AiSettings;
  marketplace: MarketplaceDefaults;
  cardFields: Record<string, boolean>;
};

// Default card fields shown on new users' cards (Commission + Matches off).
export const DEFAULT_CARD_FIELDS: Record<string, boolean> = {
  "REF code": true,
  Commodity: true,
  Route: true,
  Quantity: true,
  Laycan: true,
  "Load terms": true,
  "Load rate": true,
  "Stowage SF": true,
  "Freight idea": true,
  Commission: false,
  Matches: false,
};

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettingsData = {
  ai: { vendor: "anthropic", model: "claude-sonnet-4", baseUrl: "", apiKey: "" },
  marketplace: {
    archiveLayer1: "30",
    archiveLayer2: "6",
    archiveLayer3: "1",
    spotActiveDays: String(DEFAULT_SPOT_ACTIVE_DAYS),
    vesselActiveDays: String(DEFAULT_VESSEL_ACTIVE_DAYS),
    insightsOpenLookbackDays: String(DEFAULT_INSIGHTS_OPEN_LOOKBACK_DAYS),
    brokerCommission: "2.5",
    despatchRate: "Half demurrage",
    demurrage: "15,000",
    iacDefault: "Included (IAC)",
  },
  cardFields: DEFAULT_CARD_FIELDS,
};

// Read the platform-settings blob, merging stored values over the defaults so a
// partial/old row (or missing key) still yields a complete, valid object.
export async function getPlatformSettings(): Promise<PlatformSettingsData> {
  const stored = await readSetting<Partial<PlatformSettingsData>>(PLATFORM_SETTINGS_KEY);
  if (!stored || typeof stored !== "object") return DEFAULT_PLATFORM_SETTINGS;
  return {
    ai: { ...DEFAULT_PLATFORM_SETTINGS.ai, ...(stored.ai ?? {}) },
    marketplace: { ...DEFAULT_PLATFORM_SETTINGS.marketplace, ...(stored.marketplace ?? {}) },
    cardFields: { ...DEFAULT_CARD_FIELDS, ...(stored.cardFields ?? {}) },
  };
}

// Resolve the spot-cargo active window (in days) as a positive integer, falling
// back to the default for unset/blank/non-numeric/zero values. Used by the cargo
// board to age out stale spot listings the same way get_public_stats() does.
export async function getSpotActiveDays(): Promise<number> {
  const settings = await getPlatformSettings();
  const raw = settings.marketplace.spotActiveDays;
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SPOT_ACTIVE_DAYS;
}

// Resolve the vessel active window (in days) for open vessels with no fixed open
// date. Same fallback rules as getSpotActiveDays(); used by the vessel board.
export async function getVesselActiveDays(): Promise<number> {
  const settings = await getPlatformSettings();
  const raw = settings.marketplace.vesselActiveDays;
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_VESSEL_ACTIVE_DAYS;
}
