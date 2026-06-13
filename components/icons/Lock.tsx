import * as React from "react";
import { IconProps, iconRootProps } from "./_base";

// Privacy / data-protection. Padlock: rounded body, shackle arc, keyhole.
export function Lock({ width, height, title, ...props }: IconProps) {
  return (
    <svg {...iconRootProps({ width, height, title })} {...props}>
      {title ? <title>{title}</title> : null}
      <rect x="18" y="48" width="44" height="44" rx="8" />
      <path d="M28 48 V37 a12 12 0 0 1 24 0 V48" />
      <circle cx="40" cy="64" r="5" />
      <path d="M40 69 V80" />
    </svg>
  );
}
