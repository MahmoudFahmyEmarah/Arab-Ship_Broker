"use client";

// Propeller page-transition overlay (App Router port of asb/loader-overlay.js).
// Shows the instant an internal link is clicked and fades out once the new route
// has rendered (pathname/search change), with a minimum-visible window so it
// doesn't flash. Mounted once globally in the root layout.
import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import "@/lib/portal/loader.css";

const MIN_VISIBLE = 600; // once shown, stay up at least this long (no flicker)
const SHOW_DELAY = 0; // show on every internal navigation (brand loader, not hidden)

export function PropellerLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Start visible: a brief propeller boot-splash on first load / hard refresh,
  // faded out once the route is ready (the effect below schedules the hide).
  const [visible, setVisible] = React.useState(true);
  const shownAt = React.useRef(Date.now());
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Arm the overlay. SHOW_DELAY 0 → it appears on each navigation; MIN_VISIBLE
  // keeps it up long enough to read as a deliberate transition, not a flash.
  const show = React.useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => {
      shownAt.current = Date.now();
      setVisible(true);
    }, SHOW_DELAY);
  }, []);

  // Intercept same-origin internal link clicks → show overlay before navigation.
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(href)) return;
      let url: URL;
      try { url = new URL(a.href, location.href); } catch { return; }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.hash) return; // same-page anchor
      if (url.pathname === location.pathname && url.search === location.search) return; // same route
      show();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [show]);

  // New route has rendered → cancel any pending (not-yet-shown) overlay, and if
  // it did show, fade it out after the minimum-visible window.
  React.useEffect(() => {
    if (showTimer.current) clearTimeout(showTimer.current); // fast nav: never show
    if (!visible) return;
    const wait = Math.max(0, MIN_VISIBLE - (Date.now() - shownAt.current));
    hideTimer.current = setTimeout(() => setVisible(false), wait);
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  return (
    <div
      className={`asb-loading-overlay${visible ? " is-visible" : ""}`}
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <svg className="prop" viewBox="0 0 320 320" aria-hidden="true">
        <defs>
          <path
            id="asb-blade"
            fill="currentColor"
            d="M152 144 C 145 116 139 86 150 56 C 157 38 177 35 185 55 C 197 84 192 117 177 139 C 171 147 158 149 152 144 Z"
          />
        </defs>
        <circle className="hydro-out" cx="160" cy="160" r="138" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray="26 62" opacity=".16" />
        <circle className="hydro-in" cx="160" cy="160" r="110" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="16 70" opacity=".10" />
        <g className="blades">
          <use href="#asb-blade" />
          <use href="#asb-blade" transform="rotate(120 160 160)" />
          <use href="#asb-blade" transform="rotate(240 160 160)" />
        </g>
        <circle cx="160" cy="160" r="22" fill="currentColor" />
        <circle cx="160" cy="160" r="8" fill="var(--asb-paper)" />
      </svg>
    </div>
  );
}
