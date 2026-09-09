"use client";

// Topbar pill: a data-quality run in progress survives navigation. Polls the
// active run every few seconds (cheap count query) and links to its progress.
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getActiveRunSummary } from "@/app/(admin)/admin/data-quality/pill-actions";

export function DqRunPill() {
  const pathname = usePathname();
  const [run, setRun] = React.useState<Awaited<ReturnType<typeof getActiveRunSummary>>>(null);
  React.useEffect(() => {
    let alive = true;
    const tick = async () => { try { const r = await getActiveRunSummary(); if (alive) setRun(r); } catch { /* pill is decorative */ } };
    tick();
    const id = setInterval(tick, 6000);
    return () => { alive = false; clearInterval(id); };
  }, [pathname]);
  if (!run) return null;
  if (pathname?.startsWith("/admin/data-quality") && new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("tab") === "progress") return null;
  return (
    <Link href={`/admin/data-quality?tab=progress&run=${run.id}`} className="dq-pill" title="A data-quality run is in progress — open the live progress screen">
      <span className="dq-pill__dot" style={run.status === "paused" ? { animation: "none", background: "var(--asb-amber)" } : undefined} />
      <span>{run.status === "paused" ? "Paused" : "Run"} {run.pct}% · {run.done}/{run.total} batches</span>
      <span className="dq-pill__bar"><span style={{ width: `${run.pct}%` }} /></span>
    </Link>
  );
}
