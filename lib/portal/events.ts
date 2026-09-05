"use client";

// First-party product events → public.platform_events. Fire-and-forget from
// the browser: never awaited by the UI, never throws, silently dropped when
// the member is signed out or has declined functional storage (the consent
// banner promises we keep nothing beyond preferences without it). Rows are
// written under the member's own auth uid (RLS: user_id = auth.uid()) and are
// only readable by admins, where they feed the console dashboard.
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { readConsent } from "@/lib/consent";

export type PlatformEvent =
  | "page_view"
  | "route_drawn"
  | "estimate_shown"
  | "estimate_declined"
  | "match_popup"
  | "voyage_estimate"
  | "voyage_export"
  | "suez_calc"
  | "suez_export"
  | "ports_da";

const SESSION_KEY = "asb:sid";
let sessionId: string | null = null;
let userId: string | null | undefined; // undefined = not looked up yet
let lastKey = "";
let lastAt = 0;

function getSessionId(): string | null {
  if (sessionId) return sessionId;
  try {
    const stored = window.sessionStorage.getItem(SESSION_KEY);
    if (stored) return (sessionId = stored);
    const fresh = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
    window.sessionStorage.setItem(SESSION_KEY, fresh);
    return (sessionId = fresh);
  } catch {
    return null;
  }
}

function device(): "phone" | "tablet" | "desktop" {
  const w = window.innerWidth;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  if (w < 600) return "phone";
  if (coarse && w < 1100) return "tablet";
  return "desktop";
}

async function resolveUserId(): Promise<string | null> {
  if (userId !== undefined) return userId;
  try {
    const { data } = await getSupabaseBrowserClient().auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    userId = null;
  }
  return userId;
}

/** Record one event. Safe to call anywhere on the client; returns immediately. */
export function logEvent(event: PlatformEvent, opts: { target?: string | null; meta?: Record<string, unknown>; path?: string } = {}): void {
  if (typeof window === "undefined") return;
  if (readConsent()?.functional !== true) return;
  // collapse accidental double fires (React strict effects, re-renders)
  const key = `${event}|${opts.target ?? ""}|${opts.path ?? ""}`;
  const nowMs = Date.now();
  if (key === lastKey && nowMs - lastAt < 1500) return;
  lastKey = key; lastAt = nowMs;

  void (async () => {
    try {
      const uid = await resolveUserId();
      if (!uid) return;
      await getSupabaseBrowserClient().from("platform_events").insert({
        user_id: uid,
        session_id: getSessionId(),
        event,
        target: opts.target ?? null,
        path: opts.path ?? window.location.pathname,
        meta: { device: device(), ...(opts.meta ?? {}) },
      });
    } catch {
      // telemetry must never surface to the member
    }
  })();
}
