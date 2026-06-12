"use client";

// Cookie consent banner + manager. Shows on first visit (no consent cookie),
// and re-opens via openCookieSettings() (footer "Cookie settings", Settings →
// Security & Privacy). Two truthful categories — we run NO analytics or ad
// trackers, and the policy page says so.
import * as React from "react";
import Link from "next/link";
import { readConsent, writeConsent } from "@/lib/consent";

export function CookieConsent() {
  const [open, setOpen] = React.useState(false);
  const [manage, setManage] = React.useState(false);
  const [functional, setFunctional] = React.useState(true);

  React.useEffect(() => {
    const existing = readConsent();
    if (!existing) setOpen(true);
    else setFunctional(existing.functional);
    const reopen = () => {
      const c = readConsent();
      setFunctional(c ? c.functional : true);
      setManage(true);
      setOpen(true);
    };
    window.addEventListener("asb:cookie-settings", reopen);
    return () => window.removeEventListener("asb:cookie-settings", reopen);
  }, []);

  if (!open) return null;

  const decide = (fn: boolean) => {
    writeConsent(fn);
    setOpen(false);
    setManage(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[2147483600] p-4 max-[640px]:p-2"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white/97 shadow-[0_12px_40px_rgba(13,37,69,0.18)] backdrop-blur p-5 max-[640px]:p-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5 w-9 h-9 rounded-xl bg-ocean-50 text-ocean-600 flex items-center justify-center" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5" />
              <circle cx="8.5" cy="8.5" r=".8" fill="currentColor" /><circle cx="16" cy="15.5" r=".8" fill="currentColor" /><circle cx="10" cy="15" r=".8" fill="currentColor" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ocean-900">We use cookies</p>
            <p className="text-xs text-slate-600 leading-relaxed mt-1">
              Strictly necessary cookies keep you signed in. With your consent we also
              store your preferences (theme, board layout, map style) on this device.
              We run <strong>no advertising or analytics trackers</strong>.{" "}
              <Link href="/cookies" className="text-ocean-600 underline underline-offset-2 hover:text-ocean-700">Cookie policy</Link>
            </p>

            {manage && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-700">Strictly necessary</p>
                    <p className="text-[11px] text-slate-500">Sign-in session and this consent choice. Always on.</p>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Always on</span>
                </div>
                <button
                  type="button"
                  onClick={() => setFunctional((f) => !f)}
                  className="w-full flex items-center justify-between gap-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-left"
                >
                  <div>
                    <p className="text-xs font-semibold text-slate-700">Preferences (functional)</p>
                    <p className="text-[11px] text-slate-500">Theme, board view, notification toggles, map style — stored on your device.</p>
                  </div>
                  <span
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${functional ? "bg-ocean-600" : "bg-slate-300"}`}
                    aria-hidden
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${functional ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                  </span>
                </button>
              </div>
            )}

            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => decide(true)}
                className="px-4 h-9 rounded-lg bg-ocean-600 hover:bg-ocean-700 text-white text-xs font-semibold transition-colors"
              >
                Accept all
              </button>
              <button
                type="button"
                onClick={() => decide(false)}
                className="px-4 h-9 rounded-lg bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-semibold transition-colors"
              >
                Necessary only
              </button>
              {manage ? (
                <button
                  type="button"
                  onClick={() => decide(functional)}
                  className="px-4 h-9 rounded-lg bg-white border border-ocean-200 text-ocean-700 text-xs font-semibold hover:border-ocean-400 transition-colors"
                >
                  Save choices
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setManage(true)}
                  className="px-3 h-9 rounded-lg text-slate-500 hover:text-slate-700 text-xs font-medium underline underline-offset-2"
                >
                  Manage preferences
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
