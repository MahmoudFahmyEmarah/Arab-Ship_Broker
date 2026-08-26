import * as React from "react";
import Image from "next/image";

// The FULL Arab ShipBroker brand mark (anchor + A·C + waves) as an icon-slot
// component. It is an image, not a glyph — brand colors are baked in — so
// color context is handled with filters:
//   · white       — render solid white (for dark surfaces like the hero pill)
//   · hoverInvert — flip to white while a parent `.group` is hovered (for
//                   tiles whose background darkens on hover)
export function BrandLogo({
  className = "",
  white = false,
  hoverInvert = false,
  size = 32,
}: {
  className?: string;
  white?: boolean;
  hoverInvert?: boolean;
  size?: number;
}) {
  const filters = [
    white ? "brightness-0 invert" : "",
    hoverInvert ? "group-hover:brightness-0 group-hover:invert transition-[filter] duration-500" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Image
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      className={`${filters}${filters && className ? " " : ""}${className}`}
    />
  );
}
