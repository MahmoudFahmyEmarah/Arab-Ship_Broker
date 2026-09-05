// Admin sidebar icon set — the ASB design system's Icon glyphs (24-unit grid,
// round caps, 1.7 stroke at 16 px), ported from the console redesign. Line
// icons stroke with currentColor; Cargo and Vessel are the system's solid
// marks. The .adm-side__icon wrapper controls the hue (muted → baby blue on
// the active item).
import * as React from "react";

type Glyph = { svg: string; solid?: boolean };

export const ADMIN_ICONS: Record<string, Glyph> = {
  Dashboard: {
    svg: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
  },
  DocAudit: {
    svg: '<path d="M 6 3 L 16 3 L 19 6 L 19 21 L 6 21 Z"/><line x1="9" y1="8.6" x2="16" y2="8.6"/><line x1="9" y1="12.4" x2="14.4" y2="12.4"/><polyline points="9,16.6 11.2,18.8 15.8,14.2"/>',
  },
  Cargo: {
    solid: true,
    svg: '<path d="M 13.5 6 L 22.5 19 L 9.5 19 Z"/><path d="M 7 10 L 14.5 19 L 1.5 19 L 5 14 Z"/>',
  },
  Vessel: {
    solid: true,
    svg: '<rect x="4" y="9.5" width="3" height="3"/><rect x="5" y="6" width="1.6" height="3.8"/><path d="M 1.5 14 L 17 14 Q 21 14 22.5 11 L 22.5 16 Q 22 17.5 19 17.5 L 4 17.5 Q 2 17.5 1.5 16 Z"/><path d="M 1.5 19.5 Q 4 18.5 6.5 19.5 T 11.5 19.5 T 16.5 19.5 T 22.5 19.5" stroke="currentColor" stroke-width="1.1" fill="none"/><path d="M 1.5 21.5 Q 4 20.5 6.5 21.5 T 11.5 21.5 T 16.5 21.5 T 22.5 21.5" stroke="currentColor" stroke-width="1.1" fill="none"/>',
  },
  User: {
    svg: '<circle cx="12" cy="8" r="3.5"/><path d="M 4 21 Q 4 14 12 14 Q 20 14 20 21"/>',
  },
  Globe: {
    svg: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><line x1="3.3" y1="9.2" x2="20.7" y2="9.2"/><line x1="3.3" y1="14.8" x2="20.7" y2="14.8"/>',
  },
  Mail: {
    svg: '<rect x="3" y="5.5" width="18" height="13" rx="1.5"/><polyline points="4.2,6.6 12,13 19.8,6.6"/>',
  },
  Shield: {
    svg: '<path d="M 12 3 L 4 6 L 4 12 Q 4 18 12 21 Q 20 18 20 12 L 20 6 Z"/>',
  },
  ShieldLock: {
    svg: '<path d="M 12 3 L 4 6 L 4 12 Q 4 18 12 21 Q 20 18 20 12 L 20 6 Z"/><rect x="9.5" y="11" width="5" height="5" rx="0.5"/><path d="M 10.5 11 V 9.5 Q 10.5 8 12 8 Q 13.5 8 13.5 9.5 V 11"/>',
  },
  Layers: {
    svg: '<polygon points="12,3 21,7.5 12,12 3,7.5"/><polyline points="3,12.5 12,17 21,12.5"/><polyline points="3,16.5 12,21 21,16.5"/>',
  },
  Anchor: {
    svg: '<circle cx="12" cy="5" r="2.2"/><line x1="12" y1="7.2" x2="12" y2="21"/><line x1="7.5" y1="10.5" x2="16.5" y2="10.5"/><path d="M 4 14 Q 5.2 20.4 12 21 Q 18.8 20.4 20 14"/><polyline points="4,14 2.6,17 6.4,16.2"/><polyline points="20,14 21.4,17 17.6,16.2"/>',
  },
  Map: {
    svg: '<polygon points="3,7 9,4 15,7 21,4 21,17 15,20 9,17 3,20"/><line x1="9" y1="4" x2="9" y2="17"/><line x1="15" y1="7" x2="15" y2="20"/>',
  },
  TrendUp: {
    svg: '<polyline points="3,17.5 9,11.5 13,15.5 21,7"/><polyline points="15.6,7 21,7 21,12.4"/>',
  },
  Sliders: {
    svg: '<line x1="3.5" y1="7" x2="20.5" y2="7"/><line x1="3.5" y1="12" x2="20.5" y2="12"/><line x1="3.5" y1="17" x2="20.5" y2="17"/><circle cx="9" cy="7" r="2.1"/><circle cx="15.5" cy="12" r="2.1"/><circle cx="7" cy="17" r="2.1"/>',
  },
  Clock: {
    svg: '<circle cx="12" cy="12" r="9"/><polyline points="12,6.6 12,12 16.4,14.4"/>',
  },
  MarketBars: {
    svg: '<rect x="3.4" y="13.4" width="4.6" height="7.2" rx="1"/><rect x="9.7" y="9.2" width="4.6" height="11.4" rx="1"/><rect x="16" y="4.6" width="4.6" height="16" rx="1"/>',
  },
  Bell: {
    svg: '<path d="M 6 17 V 11 Q 6 6 12 6 Q 18 6 18 11 V 17 L 20 19 H 4 Z"/><path d="M 10 21 Q 12 22 14 21"/>',
  },
  Doc: {
    svg: '<path d="M 6 3 L 16 3 L 19 6 L 19 21 L 6 21 Z"/><line x1="9" y1="9" x2="16" y2="9"/><line x1="9" y1="13" x2="16" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>',
  },
  Settings: {
    svg: '<circle cx="12" cy="12" r="3"/><path d="M 12 2 L 12 5 M 12 19 L 12 22 M 2 12 L 5 12 M 19 12 L 22 12 M 5 5 L 7 7 M 17 17 L 19 19 M 5 19 L 7 17 M 17 7 L 19 5"/>',
  },
};

/** A design-system glyph at any size (defaults to the rail's 16 px). */
export function AdminGlyph({ name, size = 16, title }: { name: string; size?: number; title?: string }) {
  const g = ADMIN_ICONS[name] ?? ADMIN_ICONS.Dashboard;
  const strokeWidth = size <= 16 ? 1.7 : 1.5;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={g.solid ? "currentColor" : "none"}
      stroke={g.solid ? undefined : "currentColor"}
      strokeWidth={g.solid ? undefined : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      style={{ display: "inline-block", verticalAlign: "middle", flex: "none" }}
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : "") + g.svg }}
    />
  );
}

export function AdminIcon({ name }: { name: string }) {
  return (
    <span className="adm-side__icon">
      <AdminGlyph name={name} />
    </span>
  );
}
