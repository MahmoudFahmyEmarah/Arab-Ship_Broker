// Admin → Fixture rooms (26 Sep 2026). Access: section "fixtures". The
// section is not in the shared registry yet (request S5 to the integration
// owner), so canAccess answers "edit" for the owner and "none" for every
// sub-admin: owner-only until registered. Every read goes through the
// governed RPCs with the admin's own session; the database unmasks and writes
// fixture_access_log on each content read.
import Link from "next/link";
import { requireAdmin, getAdminSupabaseClient } from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import * as sdk from "@/sdk/app/fixtures";
import type { FixtureRoomListItem, FixtureRoomStatus } from "@/lib/fixture-room/types";
import { shortDateTime } from "@/lib/fixture-room/format";
import { Card, ClaimNotice, StatusBadge } from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fixture rooms · Admin" };

const FILTERS: { key: string; label: string; statuses: FixtureRoomStatus[] | null }[] = [
  { key: "open", label: "Open", statuses: ["draft", "invited", "negotiating", "on_subjects"] },
  { key: "fixed", label: "Fixed", statuses: ["fixed"] },
  { key: "closed", label: "Closed", statuses: ["withdrawn", "failed", "expired"] },
  { key: "all", label: "All", statuses: null },
];

export default async function AdminFixturesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireAdmin({ section: "fixtures" });
  const params = await searchParams;
  const filter = FILTERS.find((f) => f.key === params.filter) ?? FILTERS[0];
  const supabase = await getAdminSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const claim = ((user?.app_metadata as { role?: string } | undefined)?.role ?? "") === "admin";

  let rooms: FixtureRoomListItem[] = [];
  let error: string | null = null;
  try {
    rooms = await sdk.listFixtureRooms(supabase, filter.statuses, 200);
  } catch (e) {
    error = e instanceof sdk.FixtureRequestError ? e.fx.message : e instanceof Error ? e.message : "Could not list the rooms.";
  }

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Fixture rooms"
        subtitle="Every negotiation room on the platform, read through the governed ledger. Admin reads are unmasked and written to the durable access log."
      />
      <ClaimNotice present={claim} />

      <div className="adm-filterbar" style={{ marginTop: 12 }} role="tablist" aria-label="Room status">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/admin/fixtures?filter=${f.key}`} role="tab" aria-selected={f.key === filter.key}
            className={`adm-filter-chip${f.key === filter.key ? " is-on" : ""}`}>
            {f.label}
          </Link>
        ))}
        <span className="adm-card__sub" style={{ marginLeft: "auto" }}>{rooms.length} room{rooms.length === 1 ? "" : "s"}</span>
      </div>

      {error ? (
        <div className="adm-empty" role="alert" data-testid="fixtures-error">{error}</div>
      ) : rooms.length === 0 ? (
        <div className="adm-empty" data-testid="fixtures-empty">No {filter.label.toLowerCase()} rooms.</div>
      ) : (
        <Card title="Rooms" sub={`${filter.label} · newest activity first`} testId="fixtures-table">
          <div className="adm-table">
            <table>
              <thead>
                <tr>
                  <th>Ref</th><th>Status</th><th className="num">v</th><th>Cargo</th><th>Vessel</th>
                  <th className="num">Terms</th><th className="num">Subjects open</th><th>Listing sync</th><th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.id}>
                    <td><Link className="adm-link" href={`/admin/fixtures/${r.id}`} data-testid={`fixtures-row-${r.id}`}>{r.ref}</Link></td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="num mono">{r.version}</td>
                    <td>{r.cargo.commodity ?? "—"} <span className="adm-card__sub">· {r.cargo.loadPort ?? "—"} → {r.cargo.dischPort ?? "—"}</span></td>
                    <td>{r.vessel.name ?? "—"} <span className="adm-card__sub">· {r.vessel.type ?? "—"}{r.vessel.dwt != null ? ` · ${Number(r.vessel.dwt).toLocaleString("en-US")} DWT` : ""}</span></td>
                    <td className="num">{r.agreedTerms}/{r.termCount}</td>
                    <td className="num">{r.openSubjects}</td>
                    <td>{r.listingSyncOutstanding ? <span className="adm-badge amber">outstanding</span> : <span className="adm-card__sub">—</span>}</td>
                    <td className="adm-card__sub">{shortDateTime(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
