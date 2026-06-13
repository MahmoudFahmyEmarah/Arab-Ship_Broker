import * as React from "react";
import { IconProps, iconRootProps } from "./_base";

// Review / "before it goes live". Clock face with two hands.
export function Clock({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...iconRootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <circle cx="40" cy="58" r="30" />
      <path d="M40 58 V39" />
      <path d="M40 58 H55" />
    </svg>
  );
}
