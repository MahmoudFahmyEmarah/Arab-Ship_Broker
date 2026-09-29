// Fixture Room · the few glyphs the design draws with an icon font, as inline
// SVG (the app ships no icon font). Decorative by default; pass a title to
// make one meaningful. Stroke follows currentColor so the design's colours apply.
import * as React from "react";

type P = React.SVGProps<SVGSVGElement> & { size?: number; title?: string };
function Svg({ size = 14, title, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={title ? undefined : true} role={title ? "img" : undefined} {...rest}>
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IcLock = (p: P) => <Svg {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>;
export const IcVolume = (p: P) => <Svg {...p}><path d="M15 8a5 5 0 0 1 0 8" /><path d="M17.7 5a9 9 0 0 1 0 14" /><path d="M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5A.8.8 0 0 1 11 5v14a.8.8 0 0 1-1.5.5z" /></Svg>;
export const IcVolumeOff = (p: P) => <Svg {...p}><path d="M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5A.8.8 0 0 1 11 5v14a.8.8 0 0 1-1.5.5z" /><path d="M16 10l4 4m0-4l-4 4" /></Svg>;
export const IcDownload = (p: P) => <Svg {...p}><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /><path d="M7 11l5 5 5-5" /><path d="M12 4v12" /></Svg>;
export const IcAnchor = (p: P) => <Svg {...p}><circle cx="12" cy="5" r="2" /><path d="M12 7v14" /><path d="M5 12H3a9 9 0 0 0 18 0h-2" /><path d="M9 12h6" /></Svg>;
export const IcMail = (p: P) => <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></Svg>;
export const IcRefresh = (p: P) => <Svg {...p}><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" /><path d="M20 20v-4h-4" /></Svg>;
export const IcBarrel = (p: P) => <Svg {...p}><path d="M8 4h8" /><path d="M6 4c-1 3-1 13 0 16" /><path d="M18 4c1 3 1 13 0 16" /><path d="M8 20h8" /><path d="M5 9h14" /><path d="M5 15h14" /></Svg>;
export const IcAlert = (p: P) => <Svg {...p}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9L2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></Svg>;
export const IcPhone = (p: P) => <Svg {...p}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></Svg>;
export const IcUserCheck = (p: P) => <Svg {...p}><circle cx="9" cy="7" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><path d="M16 11l2 2 4-4" /></Svg>;
export const IcWhatsapp = (p: P) => <Svg {...p}><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" /><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" /></Svg>;
export const IcCheck = (p: P) => <Svg {...p}><path d="M5 12l5 5L20 7" /></Svg>;
