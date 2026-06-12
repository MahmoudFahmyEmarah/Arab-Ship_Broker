"use client";

// Cookie consent — the ONE consent model for the app.
//
// Categories (truthful to what we actually set — no analytics/ads exist):
//  · necessary  — Supabase auth session cookies + this consent cookie. Always
//                 on (strictly necessary; exempt from consent).
//  · functional — local preferences (asb:prefs, asb:notifs, asb:mapBase,
//                 assistant window position). Only written WITH consent.
//
// Consent is stored in a first-party cookie (1 year) so the server could read
// it too. functionalStore is the gate every preference write goes through —
// declining wipes previously stored preferences.

export type Consent = { v: 1; necessary: true; functional: boolean; ts: string };

const COOKIE = "asb_cookie_consent";
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year
export const FUNCTIONAL_KEYS = ["asb:prefs", "asb:notifs", "asb:mapBase", "asb:bosunPos"];

export function readConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`));
  if (!m) return null;
  try {
    const c = JSON.parse(decodeURIComponent(m[1])) as Consent;
    return c && c.v === 1 ? c : null;
  } catch {
    return null;
  }
}

export function writeConsent(functional: boolean): Consent {
  const c: Consent = { v: 1, necessary: true, functional, ts: new Date().toISOString() };
  document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(c))}; Max-Age=${MAX_AGE}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  if (!functional) {
    // Declining functional storage wipes what we previously kept.
    for (const k of FUNCTIONAL_KEYS) {
      try { localStorage.removeItem(k); } catch {}
    }
  }
  try { window.dispatchEvent(new CustomEvent("asb:consent-changed", { detail: c })); } catch {}
  return c;
}

export function hasFunctionalConsent(): boolean {
  return readConsent()?.functional === true;
}

// Re-open the consent manager from anywhere (footer, Settings).
export function openCookieSettings() {
  try { window.dispatchEvent(new CustomEvent("asb:cookie-settings")); } catch {}
}

// The gate for functional (preference) storage. Reads are always allowed —
// the write is what requires consent.
export const functionalStore = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string): void {
    if (!hasFunctionalConsent()) return;
    try { localStorage.setItem(key, value); } catch {}
  },
};
