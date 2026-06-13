import * as React from "react";
import { IconProps, iconRootProps } from "./_base";

// Brand mark (NOT a compliance card icon). Outer ring, faint inner ring, a
// north-filled needle and an outlined south blade on a small hub.
export function Compass({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...iconRootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <circle cx="40" cy="58" r="30" />
      <circle cx="40" cy="58" r="24" strokeWidth={1.5} opacity={0.4} />
      {/* North pointer — filled */}
      <path d="M40 37 L46 58 L34 58 Z" fill="currentColor" stroke="none" />
      {/* South pointer — outlined */}
      <path d="M40 79 L46 58 L34 58 Z" strokeWidth={2} />
      <circle cx="40" cy="58" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
