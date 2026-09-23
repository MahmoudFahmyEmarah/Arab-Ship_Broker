// The secondary route line under a cargo's POL → POD (17 Sep 2026).
//
//   Greece [area] → Syria [area]           ← the listing's own wording, always
//   ≈ Estimated via Piraeus → Lattakia     ← the reference route the figures use
//
// A reference port never replaces the area in the main line, so nobody reads
// Piraeus or Lattakia as the contractual port. When a side cannot be placed
// at all the line turns amber: "Reference port required".
import * as React from "react";
import { routeEstimate, type RouteLegs } from "@/lib/portal/route-legs";

export function RouteEstimateLine({ legs, className }: { legs: RouteLegs; className?: string }) {
  const est = routeEstimate(legs);
  if (!est) return null;
  return (
    <span className={`route-est is-${est.state}${className ? ` ${className}` : ""}`} title={est.detail}>
      <span className="route-est__mark" aria-hidden>{est.state === "invalid" ? "!" : "≈"}</span>
      <span className="route-est__text">{est.text}</span>
    </span>
  );
}
