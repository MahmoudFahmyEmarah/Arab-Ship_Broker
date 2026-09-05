"use client";

// Logs one page_view per route change inside the member portal. Mounted once
// in the dashboard layout; renders nothing.
import * as React from "react";
import { usePathname } from "next/navigation";
import { logEvent } from "@/lib/portal/events";

export function PortalEventTracker() {
  const pathname = usePathname();
  React.useEffect(() => {
    if (!pathname) return;
    logEvent("page_view", { path: pathname });
  }, [pathname]);
  return null;
}
