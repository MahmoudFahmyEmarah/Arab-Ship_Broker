import * as React from "react";
import type { IconProps } from "./_base";

// Shared contract for the ASB 24×24 glyph set (per the ASB Design System's
// "bespoke line set"). Two families share the grid:
//   · stroke glyphs — round caps/joins, no fill; stroke THICKENS at small
//     sizes per the system: 1.7 at ≤16px, 1.5 above (pass a numeric width
//     at small call sites so the rule can resolve)
//   · fill glyphs   — solid currentColor silhouettes (Vessel, Cargo, Voyage)
// Color ALWAYS comes from the parent via currentColor — never a prop.
export function icon24RootProps(
  { width = 24, height = 24, title }: IconProps,
  family: "stroke" | "fill" = "stroke",
) {
  const px = typeof width === "number" ? width : 24;
  return {
    width,
    height,
    viewBox: "0 0 24 24",
    ...(family === "stroke"
      ? {
          fill: "none" as const,
          stroke: "currentColor",
          strokeWidth: px <= 16 ? 1.7 : 1.5,
          strokeLinecap: "round" as const,
          strokeLinejoin: "round" as const,
        }
      : { fill: "currentColor" }),
    role: title ? ("img" as const) : undefined,
    "aria-hidden": title ? undefined : true,
  };
}

export type { IconProps };
