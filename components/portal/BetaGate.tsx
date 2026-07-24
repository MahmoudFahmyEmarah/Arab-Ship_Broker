"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ComingSoon, type ComingSoonVariant } from "./ComingSoon";
import type { ComingSoonDesign } from "@/lib/app-settings";
import "./beta-gate.css";

// Page order used to rotate the overlay designs (radar / beacon / compass) so
// each consecutive locked page gets the next look. Most-specific paths first so
// the prefix match resolves correctly (e.g. /dashboard/cargo/my before /dashboard/cargo).
const GATED_ORDER = [
  "/dashboard/cargo/my",
  "/dashboard/cargo/post",
  "/dashboard/cargo/create",
  "/dashboard/cargo",
  "/dashboard/vessels/post",
  "/dashboard/vessels/register",
  "/dashboard/vessels/browse",
  "/dashboard/vessels",
  "/dashboard/voyage-estimator",
  "/dashboard/ports-da",
  "/dashboard/suez-toll",
  "/dashboard/circulars",
  "/dashboard/alerts",
  "/dashboard/team",
  "/dashboard/account",
  "/dashboard/ports",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Resolve which overlay a page gets. A single enabled design is forced across
// every page; multiple designs rotate by page index (unlisted routes fall back
// to a stable hash so a page is always consistent).
function variantFor(pathname: string, design: ComingSoonDesign): ComingSoonVariant {
  const list: ComingSoonDesign = design.length ? design : ["radar", "beacon"];
  if (list.length === 1) return list[0];
  const idx = GATED_ORDER.findIndex(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const n = idx >= 0 ? idx : hash(pathname);
  return list[n % list.length];
}

export function BetaGate({
  betaMode,
  isAdmin,
  comingSoonDesign = ["radar", "beacon"],
  children,
}: {
  betaMode: boolean;
  isAdmin: boolean;
  comingSoonDesign?: ComingSoonDesign;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "/dashboard";

  // No lock when: the flag is off, the viewer is an admin, or we're on the
  // Dashboard root (the one page members keep, fully interactive).
  const isDashboardRoot = pathname === "/dashboard" || pathname === "/dashboard/";
  if (!betaMode || isAdmin || isDashboardRoot) {
    return <>{children}</>;
  }

  // Render the real page beneath a see-through scrim that blocks interaction,
  // with the centred "coming soon" card on top. The sidebar lives outside this
  // wrapper, so members can still navigate back to the Dashboard.
  return (
    <div className="asb-cs-wrap">
      {children}
      <div className="asb-cs-scrim" aria-hidden />
      <div className="asb-cs-center" role="dialog" aria-modal="false" aria-label="Coming soon">
        <ComingSoon variant={variantFor(pathname, comingSoonDesign)} />
      </div>
    </div>
  );
}
