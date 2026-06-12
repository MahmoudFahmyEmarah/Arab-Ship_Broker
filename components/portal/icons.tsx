// Custom outline icon set ported from the Claude design (asb/icons.jsx).
// Stroke-only, 24×24 grid. Typed React components.
import * as React from "react";

interface IconProps {
  size?: number;
  color?: string;
  className?: string;
}

function base(size: number, color?: string, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color || "currentColor",
    strokeWidth: size <= 16 ? 1.7 : 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };
}

export function IconDashboard({ size = 16, color, className }: IconProps) {
  return (
    <svg {...base(size, color, className)}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
    </svg>
  );
}

export function IconCargo({
  size = 16,
  color,
  className,
  plus = false,
  fleck = "#fff",
}: IconProps & { plus?: boolean; fleck?: string }) {
  const fill = color || "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <path d="M 13.5 6 L 22.5 19 L 9.5 19 Z" fill={fill} />
      <path d="M 7 10 L 14.5 19 L 1.5 19 L 5 14 Z" fill={fill} />
      <g fill={fleck} opacity="0.85">
        <circle cx="6" cy="17" r="0.35" />
        <circle cx="8" cy="15.5" r="0.3" />
        <circle cx="10" cy="17.5" r="0.35" />
        <circle cx="14.5" cy="14" r="0.35" />
        <circle cx="17" cy="12" r="0.3" />
        <circle cx="16" cy="16" r="0.35" />
      </g>
      {plus && (
        <g stroke={fill} strokeWidth="2.4" strokeLinecap="round">
          <circle cx="20" cy="4" r="3" fill="#fff" stroke="none" />
          <line x1="20" y1="2.5" x2="20" y2="5.5" />
          <line x1="18.5" y1="4" x2="21.5" y2="4" />
        </g>
      )}
    </svg>
  );
}

export function IconVessel({
  size = 16,
  color,
  className,
  plus = false,
  fleck = "#fff",
}: IconProps & { plus?: boolean; fleck?: string }) {
  const fill = color || "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <rect x="4" y="9.5" width="3" height="3" fill={fill} />
      <rect x="5" y="6" width="1.6" height="3.8" fill={fill} />
      <path
        d="M 1.5 14 L 17 14 Q 21 14 22.5 11 L 22.5 16 Q 22 17.5 19 17.5 L 4 17.5 Q 2 17.5 1.5 16 Z"
        fill={fill}
      />
      <rect x="19" y="13" width="1.6" height="1" fill={fleck} opacity="0.85" rx="0.2" />
      <path
        d="M 1.5 19.5 Q 4 18.5 6.5 19.5 T 11.5 19.5 T 16.5 19.5 T 22.5 19.5"
        stroke={fill}
        strokeWidth="1.1"
        fill="none"
        strokeLinecap="round"
      />
      {plus && (
        <g stroke={fill} strokeWidth="2.4" strokeLinecap="round">
          <circle cx="20.5" cy="3.5" r="3" fill="#fff" stroke="none" />
          <line x1="20.5" y1="2" x2="20.5" y2="5" />
          <line x1="19" y1="3.5" x2="22" y2="3.5" />
        </g>
      )}
    </svg>
  );
}

export function IconVoyage({ size = 16, color, className }: IconProps) {
  const fill = color || "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <rect x="4" y="6" width="1.6" height="3.5" fill={fill} />
      <circle cx="3.2" cy="5" r="1.0" fill={fill} />
      <circle cx="4.6" cy="3.7" r="1.0" fill={fill} />
      <rect x="3.5" y="9.5" width="3.5" height="3.5" fill={fill} />
      <rect x="7" y="9.5" width="3.5" height="3.5" fill={fill} />
      <circle cx="17.5" cy="7.5" r="4.2" fill={fill} />
      <text x="17.5" y="9.6" textAnchor="middle" fontSize="6.2" fontWeight="700" fill="#fff" fontFamily="Arial, sans-serif">
        $
      </text>
      <path d="M 1.5 13 L 21 13 L 17.5 18 L 5 18 Z" fill={fill} />
    </svg>
  );
}

export function IconSettings({ size = 16, color, className }: IconProps) {
  return (
    <svg {...base(size, color, className)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M 12 2 L 12 5 M 12 19 L 12 22 M 2 12 L 5 12 M 19 12 L 22 12 M 5 5 L 7 7 M 17 17 L 19 19 M 5 19 L 7 17 M 17 7 L 19 5" />
    </svg>
  );
}

export function IconSidebar({ size = 16, color, className }: IconProps) {
  return (
    <svg {...base(size, color, className)}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  );
}

export function IconBell({ size = 14, color, className }: IconProps) {
  return (
    <svg {...base(size, color, className)}>
      <path d="M 6 17 V 11 Q 6 6 12 6 Q 18 6 18 11 V 17 L 20 19 H 4 Z" />
      <path d="M 10 21 Q 12 22 14 21" />
    </svg>
  );
}

export function IconPlus({ size = 14, color, className }: IconProps) {
  return (
    <svg {...base(size, color, className)}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function IconSignOut({ size = 14, color, className }: IconProps) {
  return (
    <svg {...base(size, color, className)}>
      <path d="M 13 5 L 13 4 Q 13 3 12 3 L 5 3 Q 4 3 4 4 L 4 20 Q 4 21 5 21 L 12 21 Q 13 21 13 20 L 13 19" />
      <line x1="10" y1="12" x2="21" y2="12" />
      <polyline points="17,8 21,12 17,16" />
    </svg>
  );
}

export function IconMap({ size = 14, color, className }: IconProps) {
  return (
    <svg {...base(size, color, className)}>
      <polygon points="3,7 9,4 15,7 21,4 21,17 15,20 9,17 3,20" />
      <line x1="9" y1="4" x2="9" y2="17" />
      <line x1="15" y1="7" x2="15" y2="20" />
    </svg>
  );
}

export function IconUser({ size = 14, color, className }: IconProps) {
  return (
    <svg {...base(size, color, className)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M 4 21 Q 4 14 12 14 Q 20 14 20 21" />
    </svg>
  );
}
export function IconDoc({ size = 14, color, className }: IconProps) {
  return (
    <svg {...base(size, color, className)}>
      <path d="M 6 3 L 16 3 L 19 6 L 19 21 L 6 21 Z" />
      <line x1="9" y1="9" x2="16" y2="9" />
      <line x1="9" y1="13" x2="16" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  );
}
export function IconShield({ size = 14, color, className }: IconProps) {
  return (
    <svg {...base(size, color, className)}>
      <path d="M 12 3 L 4 6 L 4 12 Q 4 18 12 21 Q 20 18 20 12 L 20 6 Z" />
    </svg>
  );
}
export function IconShieldLock({ size = 14, color, className }: IconProps) {
  return (
    <svg {...base(size, color, className)}>
      <path d="M 12 3 L 4 6 L 4 12 Q 4 18 12 21 Q 20 18 20 12 L 20 6 Z" />
      <rect x="9.5" y="11" width="5" height="5" rx="0.5" />
      <path d="M 10.5 11 V 9.5 Q 10.5 8 12 8 Q 13.5 8 13.5 9.5 V 11" />
    </svg>
  );
}
export function IconStar({ size = 14, color, className }: IconProps) {
  return (
    <svg {...base(size, color, className)}>
      <polygon points="12,3 14.5,9 21,9.5 16,14 17.5,21 12,17.5 6.5,21 8,14 3,9.5 9.5,9" />
    </svg>
  );
}

export function IconBack({ size = 14, color, className }: IconProps) {
  return (
    <svg {...base(size, color, className)}>
      <polyline points="14,6 8,12 14,18" />
    </svg>
  );
}

export function IconClose({ size = 14, color, className }: IconProps) {
  return (
    <svg {...base(size, color, className)}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

export function IconCaret({
  size = 12,
  color,
  className,
  direction = "down",
}: IconProps & { direction?: "down" | "up" | "left" | "right" }) {
  const transform = {
    down: "rotate(0)",
    up: "rotate(180)",
    left: "rotate(90)",
    right: "rotate(-90)",
  }[direction];
  return (
    <svg {...base(size, color, className)} style={{ transform, transition: "transform 150ms" }}>
      <polyline points="6,9 12,15 18,9" />
    </svg>
  );
}
