import * as React from "react";
import { IconProps, icon24RootProps } from "./_base24";

// ASB 24×24 glyph set — landing-page icon audit, section 1 ("Swap now").
// Drawings are verbatim from the approved audit sheet; the Vessel silhouette
// is the same hull as the platform's animated map ship, so the public site
// and the portal share one ship.

/** Side-profile bulk carrier — hull, funnel, mast, twin wake lines. */
export function Vessel({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title }, "fill")} {...props}>
      {title ? <title>{title}</title> : null}
      <rect x="4" y="9.5" width="3" height="3" />
      <rect x="5" y="6" width="1.6" height="3.8" />
      <path d="M 1.5 14 L 17 14 Q 21 14 22.5 11 L 22.5 16 Q 22 17.5 19 17.5 L 4 17.5 Q 2 17.5 1.5 16 Z" />
      <path d="M 1.5 19.5 Q 4 18.5 6.5 19.5 T 11.5 19.5 T 16.5 19.5 T 22.5 19.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
      <path d="M 1.5 21.5 Q 4 20.5 6.5 21.5 T 11.5 21.5 T 16.5 21.5 T 22.5 21.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

/** Bulk cargo — two stockpile mounds, reads as mass rather than parcel. */
export function Cargo({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title }, "fill")} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="M 13.5 6 L 22.5 19 L 9.5 19 Z" />
      <path d="M 7 10 L 14.5 19 L 1.5 19 L 5 14 Z" />
    </svg>
  );
}

/** Loaded voyage scene — crane, stockpiles, sun, laden hull on the water. */
export function Voyage({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title }, "fill")} {...props}>
      {title ? <title>{title}</title> : null}
      <rect x="4" y="6" width="1.6" height="3.5" />
      <circle cx="3.2" cy="5" r="1" />
      <circle cx="4.6" cy="3.7" r="1" />
      <rect x="3.5" y="9.5" width="3.5" height="3.5" />
      <rect x="7" y="9.5" width="3.5" height="3.5" />
      <circle cx="17.5" cy="7.5" r="4.2" />
      <path d="M 1.5 13 L 21 13 L 17.5 18 L 5 18 Z" />
      <path d="M 1.5 20.5 Q 4 19.5 6.5 20.5 T 11.5 20.5 T 16.5 20.5 T 22.5 20.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

/** Document — plain doc, three ruled lines (no magnifier). */
export function Doc({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="M 6 3 L 16 3 L 19 6 L 19 21 L 6 21 Z" />
      <line x1="9" y1="9" x2="16" y2="9" />
      <line x1="9" y1="13" x2="16" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  );
}

/** Shackle — a locking link; the set's stand-in for a padlock in marketing copy. */
export function Shackle({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <ellipse cx="12" cy="12" rx="6.6" ry="9.4" />
      <ellipse cx="12" cy="8.2" rx="2.5" ry="2.35" />
      <ellipse cx="12" cy="15.8" rx="2.5" ry="2.35" />
    </svg>
  );
}

/** Swivel — rigging link, used as a small decorative mark. */
export function Swivel({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <ellipse cx="12" cy="5" rx="2.3" ry="2.8" />
      <line x1="12" y1="7.8" x2="12" y2="9.2" />
      <rect x="9.3" y="9.2" width="5.4" height="5.6" rx="1.2" />
      <line x1="9.3" y1="12" x2="14.7" y2="12" />
      <line x1="12" y1="14.8" x2="12" y2="16.2" />
      <ellipse cx="12" cy="19" rx="2.3" ry="2.8" />
    </svg>
  );
}

/** Sign-in — the set's sign-out glyph mirrored (arrow entering the door). */
export function SignIn({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <g transform="scale(-1,1) translate(-24,0)">
        <path d="M 13 5 L 13 4 Q 13 3 12 3 L 5 3 Q 4 3 4 4 L 4 20 Q 4 21 5 21 L 12 21 Q 13 21 13 20 L 13 19" />
        <line x1="10" y1="12" x2="21" y2="12" />
        <polyline points="17,8 21,12 17,16" />
      </g>
    </svg>
  );
}

/** Shield outline — the set's plain shield (screening / standards). */
export function ShieldLine({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="M 12 3 L 4 6 L 4 12 Q 4 18 12 21 Q 20 18 20 12 L 20 6 Z" />
    </svg>
  );
}

/** Globe — meridian plus two parallels; legible down to 16px. */
export function Globe({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <line x1="3.3" y1="9.2" x2="20.7" y2="9.2" />
      <line x1="3.3" y1="14.8" x2="20.7" y2="14.8" />
    </svg>
  );
}

/** Trend up — one rise, one dip, one arrowhead; no invented data points. */
export function TrendUp({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <polyline points="3,17.5 9,11.5 13,15.5 21,7" />
      <polyline points="15.6,7 21,7 21,12.4" />
    </svg>
  );
}

/** Clock — hands at 12:20, the arrangement that stays legible when small. */
export function Clock({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="9" />
      <polyline points="12,6.6 12,12 16.4,14.4" />
    </svg>
  );
}

/** Envelope — form email fields. */
export function Mail({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <rect x="3" y="5.5" width="18" height="13" rx="1.5" />
      <polyline points="4.2,6.6 12,13 19.8,6.6" />
    </svg>
  );
}

/** DocAudit — the Doc silhouette with its third line replaced by a check:
 *  two lines read, one signed off — the audit in progress, not its outcome
 *  (inspection glyph proposal, option A). */
export function DocAudit({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="M 6 3 L 16 3 L 19 6 L 19 21 L 6 21 Z" />
      <line x1="9" y1="8.6" x2="16" y2="8.6" />
      <line x1="9" y1="12.4" x2="14.4" y2="12.4" />
      <polyline points="9,16.6 11.2,18.8 15.8,14.2" />
    </svg>
  );
}

/** MarketBars — three stroke bars on a shared baseline, each taller than the
 *  last: a chart AND growth in one reading (market glyph proposal, option A).
 *  Built like Dashboard/Mail/Doc — rounded stroke rects, rx 1, never filled. */
export function MarketBars({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <rect x="3.4" y="13.4" width="4.6" height="7.2" rx="1" />
      <rect x="9.7" y="9.2" width="4.6" height="11.4" rx="1" />
      <rect x="16" y="4.6" width="4.6" height="16" rx="1" />
    </svg>
  );
}

/** Sliders — "adjust this view" (Settings stays for account preferences). */
export function Sliders({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <line x1="3.5" y1="7" x2="20.5" y2="7" />
      <line x1="3.5" y1="12" x2="20.5" y2="12" />
      <line x1="3.5" y1="17" x2="20.5" y2="17" />
      <circle cx="9" cy="7" r="2.1" />
      <circle cx="15.5" cy="12" r="2.1" />
      <circle cx="7" cy="17" r="2.1" />
    </svg>
  );
}

/** How-It-Works step 02 — the "matching mark", treatment B of the matching
 *  options sheet: vessel overlapping the cargo with a band-coloured knockout
 *  ring so two solids read as ONE pair (stacked-avatar device), not a list of
 *  two things. Hovering the step tile plays treatment F — the convergence —
 *  as a layer on top of B (see .asb-matchmark in globals.css; the resting
 *  state is always B, motion is a bonus, never the explanation).
 *  Override the ring colour with --mm-band when the band behind it differs. */
export function CargoVesselPair({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 24"
      width={47}
      height={28}
      fill="currentColor"
      aria-hidden
      className={`asb-matchmark${className ? " " + className : ""}`}
    >
      <g className="mm-cargo">
        <path d="M 13.5 6 L 22.5 19 L 9.5 19 Z" />
        <path d="M 7 10 L 14.5 19 L 1.5 19 L 5 14 Z" />
      </g>
      <g transform="translate(16.5,0)">
        <g className="mm-vessel">
          {/* knockout ring: band-coloured stroke painted UNDER the hull fill */}
          <g
            stroke="var(--mm-band, #0a1c34)"
            strokeWidth={5}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            <rect x="4" y="9.5" width="3" height="3" />
            <rect x="5" y="6" width="1.6" height="3.8" />
            <path d="M 1.5 14 L 17 14 Q 21 14 22.5 11 L 22.5 16 Q 22 17.5 19 17.5 L 4 17.5 Q 2 17.5 1.5 16 Z" />
          </g>
          <path d="M 1.5 19.5 Q 4 18.5 6.5 19.5 T 11.5 19.5 T 16.5 19.5 T 22.5 19.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
          <path d="M 1.5 21.5 Q 4 20.5 6.5 21.5 T 11.5 21.5 T 16.5 21.5 T 22.5 21.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
        </g>
      </g>
    </svg>
  );
}

/** Brand anchor as a currentColor glyph — the EXACT geometry of the logo
 *  (public/anchor.svg): solid head, stroke-2 shank, crossbar and flukes.
 *  Only the colors change (brand fixed → inherited), never the drawing. */
export function AnchorMark({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...icon24RootProps({ width, height, title }, "fill")} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path
        d="M12 2v6M8 12H4l8 10 8-10h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
