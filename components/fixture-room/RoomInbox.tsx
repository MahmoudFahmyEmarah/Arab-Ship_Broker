"use client";

// The member's rooms. The design keeps one pairing in the browser; the
// governed module lists every room the viewer is a party to (admins: all,
// logged), so the inbox borrows the match builder's head and segmented
// control and lists rooms as cards.
import * as React from "react";
import Link from "next/link";
import type { FixtureRoomListItem, FixtureRoomStatus } from "@/lib/fixture-room/types";
import { ROOM_STATUS_LABEL, isTerminal } from "@/lib/fixture-room/state-machine";
import { relativeTime } from "@/lib/fixture-room/format";
import { useNow } from "@/lib/fixture-room/client";

type Filter = "active" | "fixed" | "closed" | "all";

const inFilter = (r: FixtureRoomListItem, f: Filter) =>
  f === "all" ? true : f === "fixed" ? r.status === "fixed" : f === "closed" ? isTerminal(r.status) : !isTerminal(r.status) && r.status !== "fixed";

export function phaseClass(status: FixtureRoomStatus): string {
  return status === "on_subjects" ? "is-subs" : status === "fixed" ? "is-fixed" : isTerminal(status) ? "is-void" : "";
}

export function StatusPill({ status }: { status: FixtureRoomStatus }) {
  return <span className={`nr-phase ${phaseClass(status)}`}><span className="nr-phase__dot" aria-hidden="true" />{ROOM_STATUS_LABEL[status]}</span>;
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
    <div className="nr fxm-wrap">
      <div className="fxm">
        <div className="fxm__head">
          <div>
            <h1 className="fxm__title">Fixture Room</h1>
            <p className="fxm__sub">{isAdmin ? "Every room on the platform (your reads are logged)." : "Rooms your company is a party to."}</p>
          </div>
          {canCreate && <Link href="/dashboard/fixture-room/new" className="asb-btn primary" data-testid="inbox-start-fixture">Start a fixture →</Link>}
        </div>

        <div className="fxm__seg" role="tablist" aria-label="Filter rooms">
          {(["active", "fixed", "closed", "all"] as Filter[]).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "is-on" : ""} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}<span className="fxm__n">{counts[f]}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="nr-empty" data-testid="inbox-empty">
            {rooms.length === 0 ? (
              <>
                <div className="nr-empty__title">No fixtures yet</div>
                <div className="nr-empty__sub">
                  {canCreate ? "Open a room from one of your cargoes or positions and the counterparty is invited automatically." : "A counterparty can invite you into a room from their listing."}
                </div>
              </>
            ) : (
              <div className="nr-empty__title">Nothing in this view</div>
            )}
          </div>
        ) : (
          <ul className="nr-inbox" data-testid="inbox-list">
            {shown.map((r) => (
              <li key={r.id} className={`nr-inbox__row${r.listingSyncOutstanding ? " has-sync" : ""}`} data-testid={`room-row-${r.id}`}>
                <Link href={`/dashboard/fixture-room/${r.id}`} className="nr-inbox__link">
                  <div className="nr-inbox__top">
                    <span className="nr-ref">{r.ref}</span>
                    <StatusPill status={r.status} />
                    {r.myStatus === "invited" && <span className="nr-tag is-invite">Invitation</span>}
                    {r.listingSyncOutstanding && <span className="nr-tag is-warn" title="The marketplace listings do not yet match this fixture">Listing sync</span>}
                    <span className="nr-inbox__time">{relativeTime(r.updatedAt, now)}</span>
                  </div>
                  <div className="nr-inbox__line">
                    <span className="strong">{r.cargo.commodity ?? "Cargo"}</span>
                    <span className="arr">·</span>
                    <span>{r.cargo.loadPort ?? "—"}</span>
                    <span className="arr">→</span>
                    <span>{r.cargo.dischPort ?? "—"}</span>
                    <span className="arr">·</span>
                    <span className="strong">{r.vessel.name ?? "Vessel"}</span>
                    {r.vessel.dwt != null && <span className="nr-muted">&nbsp;{Number(r.vessel.dwt).toLocaleString("en-US")} DWT</span>}
                  </div>
                  <div className="nr-inbox__meta">
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
