"use client";

import * as React from "react";
import Link from "next/link";
import type { FixtureRoomListItem, FixtureRoomStatus } from "@/lib/fixture-room/types";
import { ROOM_STATUS_LABEL, isTerminal } from "@/lib/fixture-room/state-machine";
import { relativeTime } from "@/lib/fixture-room/format";
import { useNow } from "@/lib/fixture-room/client";

type Filter = "active" | "fixed" | "closed" | "all";

const inFilter = (r: FixtureRoomListItem, f: Filter) =>
  f === "all" ? true : f === "fixed" ? r.status === "fixed" : f === "closed" ? isTerminal(r.status) : !isTerminal(r.status) && r.status !== "fixed";

function StatusPill({ status }: { status: FixtureRoomStatus }) {
  return <span className={`fxr-phase is-${status}`}><span className="fxr-phase__dot" aria-hidden="true" />{ROOM_STATUS_LABEL[status]}</span>;
}

export function RoomInbox({ rooms, canCreate, isAdmin }: { rooms: FixtureRoomListItem[]; canCreate: boolean; isAdmin: boolean }) {
  const [filter, setFilter] = React.useState<Filter>("active");
  const now = useNow(30_000);
  const shown = rooms.filter((r) => inFilter(r, filter));
  const counts: Record<Filter, number> = {
    active: rooms.filter((r) => inFilter(r, "active")).length,
    fixed: rooms.filter((r) => inFilter(r, "fixed")).length,
    closed: rooms.filter((r) => inFilter(r, "closed")).length,
    all: rooms.length,
  };
  return (
    <div className="fxr">
      <div className="fxr-page">
        <div className="fxr-page__head">
          <div>
            <h1 className="fxr-title">Fixture Room</h1>
            <p className="fxr-sub">{isAdmin ? "Every room on the platform (your reads are logged)." : "Rooms your company is a party to."}</p>
          </div>
          {canCreate && (
            <Link href="/dashboard/fixture-room/new" className="asb-btn primary" data-testid="inbox-start-fixture">Start a fixture →</Link>
          )}
        </div>

        <div className="fxr-seg" role="tablist" aria-label="Filter rooms">
          {(["active", "fixed", "closed", "all"] as Filter[]).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "is-on" : ""} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)} <span className="fxr-seg__n">{counts[f]}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="fxr-empty" data-testid="inbox-empty">
            {rooms.length === 0 ? (
              <>
                <div className="fxr-empty__title">No fixtures yet</div>
                <div className="fxr-empty__sub">
                  {canCreate ? "Open a room from one of your cargoes or positions and the counterparty is invited automatically." : "A counterparty can invite you into a room from their listing."}
                </div>
              </>
            ) : (
              <div className="fxr-empty__title">Nothing in this view</div>
            )}
          </div>
        ) : (
          <ul className="fxr-inbox" data-testid="inbox-list">
            {shown.map((r) => (
              <li key={r.id} className={`fxr-inbox__row${r.listingSyncOutstanding ? " has-sync" : ""}`} data-testid={`room-row-${r.id}`}>
                <Link href={`/dashboard/fixture-room/${r.id}`} className="fxr-inbox__link">
                  <div className="fxr-inbox__top">
                    <span className="fxr-ref">{r.ref}</span>
                    <StatusPill status={r.status} />
                    {r.myStatus === "invited" && <span className="fxr-tag is-invite">Invitation</span>}
                    {r.listingSyncOutstanding && <span className="fxr-tag is-warn" title="The marketplace listings do not yet match this fixture">Listing sync</span>}
                    <span className="fxr-inbox__time">{relativeTime(r.updatedAt, now)}</span>
                  </div>
                  <div className="fxr-inbox__line">
                    <b>{r.cargo.commodity ?? "Cargo"}</b>
                    <span className="fxr-arr">·</span>
                    <span>{r.cargo.loadPort ?? "—"}</span>
                    <span className="fxr-arr">→</span>
                    <span>{r.cargo.dischPort ?? "—"}</span>
                    <span className="fxr-arr">·</span>
                    <b>{r.vessel.name ?? "Vessel"}</b>
                    {r.vessel.dwt != null && <span className="fxr-muted">{Number(r.vessel.dwt).toLocaleString("en-US")} DWT</span>}
                  </div>
                  <div className="fxr-inbox__meta">
                    <span>{r.mySide === "cargo" ? "Cargo side" : r.mySide === "vessel" ? "Vessel side" : r.mySide === "mediator" ? "Mediator" : "Observer"}</span>
                    {r.counterpartyLabel && <span>· vs {r.counterpartyLabel}{r.counterpartyDisclosed ? "" : " (via ASB)"}</span>}
                    <span>· {r.agreedTerms}/{r.termCount} terms agreed</span>
                    {r.openSubjects > 0 && <span>· {r.openSubjects} subject{r.openSubjects === 1 ? "" : "s"} open</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
