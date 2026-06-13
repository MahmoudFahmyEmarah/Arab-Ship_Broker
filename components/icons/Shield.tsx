import * as React from "react";
import { IconProps, iconRootProps } from "./_base";

// Sanctions screening. Shield outline with an interior check.
export function Shield({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...iconRootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="M40 29 L61 36 V62 C61 80 50 90 40 95 C30 90 19 80 19 62 V36 Z" />
      <path d="M30 60 L37 68 L52 50" />
    </svg>
  );
}
