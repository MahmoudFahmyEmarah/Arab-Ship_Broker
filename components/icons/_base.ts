import * as React from "react";

// Shared contract for the hand-drawn line icon set (Arab ShipBroker).
// viewBox 0 0 80 110, strokeWidth 3, round caps/joins, color via currentColor
// only. Decorative by default (aria-hidden); pass `title` for meaningful
// standalone use and it becomes role="img".
export interface IconProps
  extends Omit<React.SVGProps<SVGSVGElement>, "width" | "height"> {
  width?: number | string;
  height?: number | string;
  title?: string;
}

export function iconRootProps({ width = 24, height = 24, title }: IconProps) {
  return {
    width,
    height,
    viewBox: "0 0 80 110",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    role: title ? ("img" as const) : undefined,
    "aria-hidden": title ? undefined : true,
  };
}
