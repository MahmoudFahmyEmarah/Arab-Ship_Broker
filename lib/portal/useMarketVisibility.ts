"use client";

// Market freshness — viewer-resolved visibility settings + the shared window
// predicate. ONE source of truth: the get_market_visibility RPC reads the
// same app_settings row the database's RLS gate (fn_market_fresh_ok) uses,
// so what the UI offers always matches what the database will serve.
import * as React from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export interface MarketVisibilityView {
  freshDays: number;
  archiveCapDays: number;
  laycanException: boolean;
  tier: string;
  isAdmin: boolean;
  ladder: number[]; // configured day-windows (fresh + tier caps), ascending
  tiers: Record<string, number>; // per-tier archive caps (for lock labels)
}

export const MARKET_VISIBILITY_FALLBACK: MarketVisibilityView = {
  freshDays: 7,
  archiveCapDays: 7,
  laycanException: true,
  tier: "T1",
  isAdmin: false,
  ladder: [7],
  tiers: { T1: 0, T2: 0, T3: 30, T4: 60 },
};

export function useMarketVisibility(): MarketVisibilityView {
  const [v, setV] = React.useState<MarketVisibilityView>(MARKET_VISIBILITY_FALLBACK);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      // a couple of retries — a transient network blip would otherwise pin the
      // viewer to the fallback (live-only) until the next full page load
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          const { data, error } = await getSupabaseBrowserClient().rpc("get_market_visibility");
          if (error) throw error;
          if (!cancelled && data && typeof data === "object") {
            const d = data as Partial<MarketVisibilityView>;
            setV({
              ...MARKET_VISIBILITY_FALLBACK,
              ...d,
              ladder: Array.isArray(d.ladder) && d.ladder.length ? d.ladder : [d.freshDays ?? 7],
            });
          }
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        }
      }
      /* fallback stands — the RLS gate still enforces the caps */
    })();
    return () => { cancelled = true; };
  }, []);
  return v;
}

/** Is a listing inside the chosen posted-window (or saved by the
 *  future-laycan/open-date exception)? */
export function withinPostedWindow(
  postedAt: string | null | undefined,
  futureDate: string | null | undefined,
  days: number,
  laycanException: boolean,
): boolean {
  if (postedAt) {
    const t = Date.parse(postedAt);
    if (Number.isFinite(t) && t >= Date.now() - days * 86_400_000) return true;
  } else {
    // no posted timestamp on the row (older seeds) — let it through rather
    // than silently hiding data the database chose to serve
    return true;
  }
  if (laycanException && futureDate) {
    const f = Date.parse(futureDate);
    const todayStart = new Date().setHours(0, 0, 0, 0);
    if (Number.isFinite(f) && f >= todayStart) return true;
  }
  return false;
}

/** "3d" / "<1d" age label for the posted-at badge; null when unknown. */
export function postedAgeLabel(postedAt: string | null | undefined): string | null {
  if (!postedAt) return null;
  const t = Date.parse(postedAt);
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  return days <= 0 ? "<1d" : `${days}d`;
}
