"use client";

// PosterLine — the third line on market rows/cards: the platform account that
// put the listing on the market (owner decision: the poster, never the source).
//   individual  → person icon            "Bashir Osman"
//   company     → building icon          "Capt Mohamed · Arab ShipBroker LLC"
//   employee    → person-in-building     "Nurgul Akca · Kuzey Shipping"
// Admin accounts carry a small shield badge. The company name links to the
// company profile (My Company module) when the poster has a registry seat.
import * as React from "react";
import Link from "next/link";
import type { PosterView } from "@/lib/portal/types";

const KIND_LABEL: Record<PosterView["kind"], string> = {
  individual: "Posted by an individual member",
  company: "Posted by a company account",
  employee: "Posted by a company employee",
};

function KindIcon({ kind }: { kind: PosterView["kind"] }) {
  const common = { width: 11, height: 11, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (kind) {
    case "company":
      return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" /></svg>;
    case "employee":
      return <svg {...common}><rect x="3" y="4" width="10" height="17" rx="1.5" /><path d="M6 8h2M6 12h2M6 16h2" /><circle cx="17.5" cy="12" r="2.5" /><path d="M13.5 21a4 4 0 0 1 8 0" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
  }
}

export function PosterLine({ poster, className }: { poster?: PosterView | null; className?: string }) {
  if (!poster || (!poster.name && !poster.company)) return null;
  const name = poster.name;
  const company = poster.company && poster.company !== poster.name ? poster.company : null;
  const title = `${KIND_LABEL[poster.kind]}${poster.isAdmin ? " · platform admin" : ""}`;
  return (
    <div className={`poster-line${className ? ` ${className}` : ""}`} title={title} onClick={(e) => e.stopPropagation()}>
      <span className={`poster-line__icon is-${poster.kind}`}><KindIcon kind={poster.kind} /></span>
      {name && <span className="poster-line__name">{name}</span>}
      {name && company && <span className="poster-line__sep">·</span>}
      {company && (poster.orgId ? (
        <Link href={`/dashboard/team?org=${poster.orgId}`} className="poster-line__co is-link" title={`Open ${company}`}>{company}</Link>
      ) : (
        <span className="poster-line__co">{company}</span>
      ))}
      {poster.isAdmin && (
        <span className="poster-line__admin" title="Platform admin">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></svg>
        </span>
      )}
    </div>
  );
}
