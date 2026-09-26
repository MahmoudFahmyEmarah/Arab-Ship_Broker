// Admin → Fixture rooms → one room (26 Sep 2026). The whole read model as the
// database returns it to an admin: identities unmasked, the ledger with actor
// ids and idempotency keys, the recaps, and the durable access log of the
// room. Two platform actions: redact a message, close a room as failed or
// expired. Each read is written to fixture_access_log by the RPC itself.
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireAdmin, getAdminSupabaseClient } from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import * as sdk from "@/sdk/app/fixtures";
import type { FixtureRoomView } from "@/lib/fixture-room/types";
import { isTerminal } from "@/lib/fixture-room/state-machine";
import { shortDateTime } from "@/lib/fixture-room/format";
import { Card, ClaimNotice, Mono, StatusBadge } from "../ui";
import { closeFixtureRoomAdmin, redactFixtureMessageAdmin } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fixture room · Admin" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminFixtureRoomPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  await requireAdmin({ section: "fixtures" });
  const { id } = await params;
  const flash = await searchParams;
  const supabase = await getAdminSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const claim = ((user?.app_metadata as { role?: string } | undefined)?.role ?? "") === "admin";

  let view: FixtureRoomView | null = null;
  let log: sdk.FixtureAccessLogEntry[] = [];
  let error: string | null = null;
  if (!UUID.test(id)) error = "That is not a room id.";
  else {
    try {
      view = await sdk.getFixtureRoom(supabase, id);
      try { log = await sdk.adminFixtureAccessLog(supabase, id, 100); } catch { log = []; }
    } catch (e) {
      error = e instanceof sdk.FixtureRequestError ? e.fx.message : e instanceof Error ? e.message : "Could not load the room.";
    }
  }

  return (
    <div className="adm-page">
      <AdminPageHeader title={view ? `Fixture room ${view.room.ref}` : "Fixture room"} subtitle="Unmasked read model, ledger and access log. Every open of this page is itself logged.">
        <Link href="/admin/fixtures" className="adm-btn small">← All rooms</Link>
        {view && <Link href={`/dashboard/fixture-room/${view.room.id}`} className="adm-btn small ghost">Open as mediator ↗</Link>}
      </AdminPageHeader>
      <ClaimNotice present={claim} />
      {flash.message && <div className="adm-page__warn" role="status" data-testid="fixtures-flash">{flash.message}</div>}
      {flash.error && <div className="adm-page__warn" role="alert" data-testid="fixtures-flash-error">⚠ {flash.error}</div>}

      {!view ? (
        <div className="adm-empty" role="alert" data-testid="fixtures-room-error">{error ?? "Room not found."}</div>
      ) : (
        <RoomBody view={view} log={log} claim={claim} />
      )}
    </div>
  );
}

function RoomBody({ view, log, claim }: { view: FixtureRoomView; log: sdk.FixtureAccessLogEntry[]; claim: boolean }) {
  const { room, snapshot, parties, terms, subjects, messages, events, recaps } = view;
  const cargo = snapshot.cargo;
  const vessel = snapshot.vessel.vessel;
  const closable = !isTerminal(room.status) && room.status !== "fixed";
  const sync = room.listingSync;
  const key = () => randomUUID();

  return (
    <>
      <div className="adm-cols-2" style={{ marginTop: 12 }}>
        <Card title="Room" sub={`v${room.version} · catalogue ${room.termCatalogueVersion}`} testId="fixtures-room-card">
          <div className="adm-kv">
            <span className="adm-kv__k">Status</span><span className="adm-kv__v"><StatusBadge status={room.status} /></span>
            <span className="adm-kv__k">Mediation</span><span className="adm-kv__v">{room.mediation}</span>
            <span className="adm-kv__k">Created</span><span className="adm-kv__v">{shortDateTime(room.createdAt)}</span>
            <span className="adm-kv__k">Updated</span><span className="adm-kv__v">{shortDateTime(room.updatedAt)}</span>
            <span className="adm-kv__k">Snapshot</span><span className="adm-kv__v">{shortDateTime(room.snapshotAt)} · <Mono value={room.snapshotHash.slice(0, 12)} /></span>
            <span className="adm-kv__k">Disclosure</span><span className="adm-kv__v">{room.counterpartyDisclosed ? `disclosed ${shortDateTime(room.counterpartyDisclosedAt)}` : "withheld"}</span>
            <span className="adm-kv__k">Fixed</span><span className="adm-kv__v">{room.fixedOnSubsAt ? `on subs ${shortDateTime(room.fixedOnSubsAt)}` : "—"}{room.fixedAt ? ` · clean ${shortDateTime(room.fixedAt)}` : ""}</span>
            <span className="adm-kv__k">Closed</span><span className="adm-kv__v">{room.closedAt ? `${room.closedReason} ${shortDateTime(room.closedAt)}${room.closedNote ? ` · ${room.closedNote}` : ""}` : "—"}</span>
            <span className="adm-kv__k">Created by</span><span className="adm-kv__v"><Mono value={room.createdByUserId} /> party <Mono value={(room as { createdByPartyId?: string | null }).createdByPartyId} /></span>
            <span className="adm-kv__k">Listings</span><span className="adm-kv__v">cargo <Mono value={room.cargoListingId} /> · position <Mono value={room.vesselAvailabilityId} /> · vessel <Mono value={room.vesselId} /></span>
            <span className="adm-kv__k">Listing sync</span>
            <span className="adm-kv__v">
              {sync ? (
                <>
                  cargo {sync.cargo.current ?? "—"} → {sync.cargo.target ?? "—"}{sync.cargo.outstanding ? " (outstanding)" : ""} · position {sync.vessel.current ?? "—"} → {sync.vessel.target ?? "—"}{sync.vessel.outstanding ? " (outstanding)" : ""}
                </>
              ) : "no requirement recorded"}
            </span>
          </div>
        </Card>
        <Card title="Pairing" sub="from the immutable snapshots" testId="fixtures-pairing-card">
          <div className="adm-kv">
            <span className="adm-kv__k">Cargo</span><span className="adm-kv__v">{String(cargo.ref ?? "—")} · {String(cargo.commodity_name ?? "—")} · {String(cargo.qty_min_mt ?? "—")}–{String(cargo.qty_max_mt ?? "—")} MT</span>
            <span className="adm-kv__k">Route</span><span className="adm-kv__v">{String(cargo.load_port_name ?? cargo.load_port_locode ?? "—")} → {String(cargo.disch_port_name ?? cargo.disch_port_locode ?? "—")}</span>
            <span className="adm-kv__k">Laycan</span><span className="adm-kv__v">{cargo.is_spot ? "SPOT" : `${String(cargo.laycan_from ?? "—")} – ${String(cargo.laycan_to ?? "—")}`}</span>
            <span className="adm-kv__k">Vessel</span><span className="adm-kv__v">{String(vessel.vessel_name ?? "—")} · {String(vessel.vessel_type ?? "—")} · {vessel.dwt_grain != null ? `${Number(vessel.dwt_grain).toLocaleString("en-US")} DWT` : "—"}{vessel.is_tbn ? " · TBN" : ""}{snapshot.vesselIdentityMasked ? " (masked for you)" : ""}</span>
            <span className="adm-kv__k">IMO / flag</span><span className="adm-kv__v">{String(vessel.imo_number ?? "—")} · {String(vessel.flag ?? "—")} · built {String(vessel.build_year ?? "—")}</span>
            <span className="adm-kv__k">Position</span><span className="adm-kv__v">{String(snapshot.vessel.availability.open_port_name ?? "—")} · {String(snapshot.vessel.availability.open_date ?? "—")} · {String(snapshot.vessel.availability.status ?? "—")}</span>
          </div>
        </Card>
      </div>

      <Card title="Parties" sub={claim ? "identities unmasked for the admin read" : "masked: no admin claim on this session"} testId="fixtures-parties">
        <div className="adm-table">
          <table>
            <thead><tr><th>Side</th><th>Capacity</th><th>Mode</th><th>Status</th><th>Label</th><th>Name · desk</th><th>Org</th><th>Member</th><th>Contact</th><th>Anchor</th></tr></thead>
            <tbody>
              {parties.map((p) => (
                <tr key={p.id}>
                  <td>{p.side}</td><td>{p.capacity}</td><td>{p.participationMode}{p.isPlatform ? " · platform" : ""}</td>
                  <td><span className={`adm-badge ${p.status === "active" ? "active" : p.status === "invited" ? "pending" : "inactive"}`}>{p.status}</span></td>
                  <td>{p.label}</td>
                  <td>{p.name ?? "—"}{p.deskLabel ? ` · ${p.deskLabel}` : ""}</td>
                  <td><Mono value={p.orgId} /></td><td><Mono value={p.userId} /></td><td><Mono value={p.contactId} /></td>
                  <td>{p.anchorListingType ? <>{p.anchorListingType} <Mono value={p.anchorListingId} /></> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Terms" sub={`${terms.filter((t) => t.status === "agreed").length}/${terms.length} agreed`} testId="fixtures-terms">
        <div className="adm-table">
          <table>
            <thead><tr><th className="num">#</th><th>Term</th><th>Status</th><th>Cargo position</th><th>Vessel position</th><th>Agreed</th><th>Holder</th><th className="num">Round</th></tr></thead>
            <tbody>
              {terms.map((t) => (
                <tr key={t.id}>
                  <td className="num">{t.sortOrder}</td><td>{t.label}{t.required ? "" : " (optional)"}</td>
                  <td><span className={`adm-badge ${t.status === "agreed" ? "active" : t.status === "countered" ? "amber" : t.status === "withdrawn" ? "inactive" : "draft"}`}>{t.status}</span></td>
                  <td>{t.cargoPosition?.displayValue ?? "—"}</td><td>{t.vesselPosition?.displayValue ?? "—"}</td>
                  <td>{t.agreed ? `${t.agreed.displayValue} · ${shortDateTime(t.agreedAt)}` : "—"}</td>
                  <td>{t.holder ?? "—"}</td><td className="num">{t.round}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="adm-cols-2">
        <Card title="Subjects" sub={`${subjects.filter((s) => s.status === "open").length} open`} testId="fixtures-subjects">
          {subjects.length === 0 ? <div className="adm-card__sub">None recorded.</div> : (
            <div className="adm-table"><table>
              <thead><tr><th className="num">#</th><th>Subject</th><th>Side</th><th>Status</th><th>Deadline</th></tr></thead>
              <tbody>{subjects.map((s) => (
                <tr key={s.id}><td className="num">{s.seq}</td><td>{s.title}</td><td>{s.responsibleSide ?? "—"}</td><td>{s.status}</td><td>{s.deadlineAt ? shortDateTime(s.deadlineAt) : "—"}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
        <Card title="Recaps" sub={`${recaps.length} version${recaps.length === 1 ? "" : "s"}`} testId="fixtures-recaps">
          {recaps.length === 0 ? <div className="adm-card__sub">None published.</div> : (
            <div className="adm-table"><table>
              <thead><tr><th className="num">v</th><th>Published</th><th>By</th><th className="num">Acks</th><th>Invalidated</th></tr></thead>
              <tbody>{recaps.map((rv) => (
                <tr key={rv.id}><td className="num">{rv.versionNo}</td><td>{shortDateTime(rv.publishedAt)}</td><td>{rv.publishedByLabel ?? "—"}</td><td className="num">{rv.acknowledgements.length}</td><td>{rv.invalidatedAt ? shortDateTime(rv.invalidatedAt) : "—"}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </div>

      <Card title="Messages" sub="room, side and mediator threads; redaction withholds the text and keeps the event" testId="fixtures-messages">
        {messages.length === 0 ? <div className="adm-card__sub">No messages.</div> : (
          <div className="adm-table"><table>
            <thead><tr><th>When</th><th>From</th><th>Visibility</th><th>Kind</th><th>Body</th><th>Redact</th></tr></thead>
            <tbody>{messages.map((m) => (
              <tr key={m.id}>
                <td className="adm-card__sub">{shortDateTime(m.createdAt)}</td><td>{m.label} <span className="adm-card__sub">· {m.side}</span></td><td>{m.visibility}</td><td>{m.kind}</td>
                <td>{m.redacted ? <span className="adm-badge inactive">redacted</span> : m.body}</td>
                <td>
                  {m.redacted ? "—" : (
                    <form action={redactFixtureMessageAdmin} style={{ display: "flex", gap: 6, alignItems: "center" }} data-testid={`fixtures-redact-${m.id}`}>
                      <input type="hidden" name="roomId" value={room.id} />
                      <input type="hidden" name="messageId" value={m.id} />
                      <input type="hidden" name="expectedVersion" value={room.version} />
                      <input type="hidden" name="idempotencyKey" value={key()} />
                      <input className="adm-input" name="reason" placeholder="Reason (kept in the ledger)" minLength={4} maxLength={500} required aria-label="Redaction reason" />
                      <button type="submit" className="adm-btn small reject" disabled={!claim}>Redact</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      <Card title="Ledger" sub={`${events.length} event${events.length === 1 ? "" : "s"} · seq = room version`} testId="fixtures-ledger">
        <div className="adm-table"><table>
          <thead><tr><th className="num">Seq</th><th>Type</th><th>When</th><th>Actor</th><th>On behalf of</th><th>Command</th><th>Idempotency key</th><th>Payload</th></tr></thead>
          <tbody>{events.map((e) => (
            <tr key={e.id}>
              <td className="num mono">{e.seq}</td><td>{e.type}{e.relayed ? " · relayed" : ""}</td><td className="adm-card__sub">{shortDateTime(e.at)}</td>
              <td>{e.actorLabel}{e.actorUserId ? <> <Mono value={e.actorUserId} /></> : null}</td>
              <td>{e.onBehalfOfLabel ?? "—"}</td><td><Mono value={e.command} /></td><td><Mono value={e.idempotencyKey} /></td>
              <td><details><summary className="adm-link">view</summary><pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "var(--fs-label)", margin: "6px 0 0" }}>{JSON.stringify(e.payload, null, 1)}</pre></details></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>

      <Card title="Access log" sub="every content-bearing admin read of this room, durable; the version poll is not logged" testId="fixtures-access-log">
        {log.length === 0 ? <div className="adm-card__sub">{claim ? "No admin read recorded before this one." : "Admin-only; not readable without the claim."}</div> : (
          <div className="adm-table"><table>
            <thead><tr><th>When</th><th>Who</th><th>User id</th><th>Reason</th></tr></thead>
            <tbody>{log.map((l) => (
              <tr key={l.id}><td className="adm-card__sub">{shortDateTime(l.at)}</td><td>{l.userLabel}{l.isAdmin ? " · admin" : ""}</td><td><Mono value={l.userId} /></td><td>{l.reason}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      {closable && (
        <Card title="Close the room" sub="a platform decision: failed or expired; withdrawal belongs to a principal" testId="fixtures-close">
          <form action={closeFixtureRoomAdmin} style={{ display: "grid", gridTemplateColumns: "180px 1fr auto", gap: 8, alignItems: "end" }}>
            <input type="hidden" name="roomId" value={room.id} />
            <input type="hidden" name="expectedVersion" value={room.version} />
            <input type="hidden" name="idempotencyKey" value={key()} />
            <label className="adm-field"><span className="adm-field__label">Reason</span>
              <select className="adm-select" name="reason" defaultValue="failed"><option value="failed">Failed</option><option value="expired">Expired</option></select>
            </label>
            <label className="adm-field"><span className="adm-field__label">Note (kept in the ledger)</span>
              <input className="adm-input" name="note" maxLength={500} placeholder="Why the platform closed it" />
            </label>
            <button type="submit" className="adm-btn warn" disabled={!claim}>Close room</button>
          </form>
        </Card>
      )}
    </>
  );
}
