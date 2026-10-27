import Link from "next/link";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ReviewStatusBadge, TrustTierBadge } from "@/components/admin/AdminBadge";
import { QueueFilters } from "@/components/admin/queue/QueueFilters";
import { ZONE_CODES, isPlainZoneName } from "@/lib/zones";
import type { QueueItem } from "@/lib/admin/types";

type StatusFilter = "PENDING" | "APPROVED" | "REJECTED" | "FLAGGED" | "ALL";
type TypeFilter = "all" | "cargo" | "vessel_availability";

function formatAge(iso: string): { label: string; urgent: boolean } {
  const minutes = (Date.now() - new Date(iso).getTime()) / 60000;
  const urgent = minutes > 120;
  if (minutes < 60) return { label: `${Math.round(minutes)}m ago`, urgent };
  const h = Math.floor(minutes / 60);
  if (h < 48) { const m = Math.round(minutes % 60); return { label: m > 0 ? `${h}h ${m}m ago` : `${h}h ago`, urgent }; }
  return { label: new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }), urgent };
}

const STATUSES: StatusFilter[] = ["PENDING", "APPROVED", "REJECTED", "FLAGGED", "ALL"];
const RANGES: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
const sinceIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const TABS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All submissions" },
  { value: "cargo", label: "Cargo submissions" },
  { value: "vessel_availability", label: "Vessel submissions" },
];

// The design's review queue (Portal standalone 7 · PageReview): submission tabs with counts, a filter bar of
// dropdowns with "N pending · oldest first", and one row per submission with Preview · Approve → · Request changes
// · Reject. "All submissions" stays the landing tab (the rail's Review badge counts both types). Every decision is
// still taken on the submission's own page (its checks and the listing in full are there); the row buttons open it
// with that decision ready.
export default async function AdminQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; tier?: string; commodity?: string; zone?: string; range?: string }>;
}) {
  await requireAdmin({ section: "review" });
  const params = await searchParams;
  const supabase = await getAdminSupabaseClient();

  const statusFilter: StatusFilter = STATUSES.includes(params.status as StatusFilter) ? (params.status as StatusFilter) : "PENDING";
  const typeFilter: TypeFilter = TABS.some((t) => t.value === params.type) ? (params.type as TypeFilter) : "all";
  // the zone goes into a PostgREST or() string, so only plain zone names pass (E.MED yes; quotes, commas, brackets no)
  const zone = params.zone && isPlainZoneName(params.zone) ? params.zone : undefined;

  let query = supabase.from("v_admin_queue_detail").select("*").order("created_at", { ascending: true });
  if (statusFilter !== "ALL") query = query.eq("status", statusFilter);
  if (typeFilter !== "all") query = query.eq("listing_type", typeFilter);
  if (params.tier) query = query.eq("submitter_trust_tier", params.tier);
  if (params.commodity) query = query.eq("commodity_name", params.commodity);
  if (zone) {
    query = typeFilter === "cargo" ? query.or(`load_zone.eq."${zone}",disch_zone.eq."${zone}"`)
      : typeFilter === "vessel_availability" ? query.eq("open_zone", zone)
      : query.or(`load_zone.eq."${zone}",disch_zone.eq."${zone}",open_zone.eq."${zone}"`);
  }
  if (params.range && RANGES[params.range]) query = query.gte("created_at", sinceIso(RANGES[params.range]));
  const { data, error: readError } = await query.limit(200);
  const items = (data ?? []) as QueueItem[];

  // exact tab counts at the chosen status (a count query, never a capped row list)
  const countOf = async (t: TypeFilter) => {
    let q = supabase.from("v_admin_queue_detail").select("id", { count: "exact", head: true });
    if (statusFilter !== "ALL") q = q.eq("status", statusFilter);
    if (t !== "all") q = q.eq("listing_type", t);
    const { count, error } = await q;
    return error ? null : count;   // unknown is shown as "—", never as 0
  };
  const [allCount, cargoCount, vesselCount] = await Promise.all([countOf("all"), countOf("cargo"), countOf("vessel_availability")]);
  const counts: Record<TypeFilter, number | null> = { all: allCount, cargo: cargoCount, vessel_availability: vesselCount };

  // dropdown options: zones from the registry; commodities from the cargo submissions at this status
  let commodityQuery = supabase.from("v_admin_queue_detail").select("commodity_name").eq("listing_type", "cargo").not("commodity_name", "is", null);
  if (statusFilter !== "ALL") commodityQuery = commodityQuery.eq("status", statusFilter);
  const { data: commodityRows } = await commodityQuery.limit(1000);
  const commodities = [...new Set(((commodityRows ?? []) as { commodity_name: string }[]).map((r) => r.commodity_name))].sort();
  const zones = ZONE_CODES.filter((z) => z !== "Unknown");

  const tabHref = (t: TypeFilter) => `/admin/queue?status=${statusFilter}${t === "all" ? "" : `&type=${t}`}`;
  const statusWord = statusFilter === "ALL" ? "shown" : statusFilter.toLowerCase();
  const unfiltered = typeFilter === "all" && !params.tier && !params.commodity && !zone && !params.range;

  return (
    <div className="adm-page">
      <AdminPageHeader title="Listing review queue" subtitle="Approve, request changes, or reject pending submissions" />

      <div className="adm-tabs adm-tabs--card">
        {TABS.map((t) => (
          <Link key={t.value} href={tabHref(t.value)} className={`adm-tab${typeFilter === t.value ? " is-on" : ""}`} aria-current={typeFilter === t.value ? "page" : undefined}>
            {t.label} <span className="adm-tab__count">{counts[t.value] ?? "—"}</span>
          </Link>
        ))}
      </div>

      <QueueFilters
        summary={`${items.length} ${statusWord} · oldest first`}
        filters={[
          { key: "status", label: "Status: pending", options: STATUSES.filter((s) => s !== "PENDING").map((s) => ({ value: s, label: `Status: ${s.toLowerCase()}` })) },
          { key: "range", label: "Date range", options: [{ value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "90d", label: "Last 90 days" }] },
          { key: "tier", label: "User tier", options: [{ value: "NEW", label: "New" }, { value: "VERIFIED", label: "Verified" }, { value: "FLAGGED", label: "Flagged" }] },
          ...(typeFilter !== "vessel_availability" ? [{ key: "commodity", label: "Commodity", options: commodities.map((c) => ({ value: c, label: c })) }] : []),
          { key: "zone", label: "Zone", options: zones.map((z) => ({ value: z, label: z })) },
        ]}
      />

      {readError ? (
        <div className="adm-empty" role="alert">The review queue could not be read just now, so this is not an empty queue. Reload the page to try again.</div>
      ) : items.length === 0 ? (
        <div className="adm-empty">
          {statusFilter === "PENDING" && unfiltered
            ? "Queue is clear. All submissions have been reviewed."
            : `No ${statusWord} ${typeFilter === "cargo" ? "cargo " : typeFilter === "vessel_availability" ? "vessel " : ""}submissions match. ${
                typeFilter !== "all" && (counts.all ?? 0) > 0 ? `${counts.all} ${statusWord} in All submissions.` : "Adjust the filters to see others."}`}
        </div>
      ) : (
        <div className="adm-card adm-queue">
          {items.map((item) => {
            const isCargo = item.listing_type === "cargo";
            const age = formatAge(item.created_at);
            const pending = item.status === "PENDING";
            const href = `/admin/queue/${item.id}`;
            return (
              <div key={item.id} className="adm-queue__row">
                <span className={`adm-list__icon ${isCargo ? "is-cargo" : "is-vessel"}`} aria-hidden="true">{isCargo ? "C" : "V"}</span>
                <div className="adm-list__body">
                  <div className="adm-list__title">
                    {isCargo ? (item.commodity_name ?? "Cargo") : (item.vessel_name ?? "Vessel")}
                    {isCargo && item.cargo_ref ? <span className="adm-queue__ref"> {item.cargo_ref}</span> : null}
                  </div>
                  <div className="adm-list__meta">
                    {isCargo
                      ? [item.load_port_name && item.disch_port_name ? `${item.load_port_name} → ${item.disch_port_name}` : item.load_zone && item.disch_zone ? `${item.load_zone} → ${item.disch_zone}` : item.cargo_type ?? "Cargo listing",
                         item.qty_max_mt ? `${item.qty_max_mt.toLocaleString("en-US")} MT` : null].filter(Boolean).join(" · ")
                      : [item.vessel_type ?? "Vessel", item.dwt_grain ? `${item.dwt_grain.toLocaleString("en-US")} DWT` : null, `open ${item.open_port_name ?? "—"}`].filter(Boolean).join(" · ")}
                  </div>
                  <div className="adm-list__meta adm-queue__by">
                    <span>Submitted by {item.submitter_name ?? item.submitter_email ?? "Unknown"}</span>
                    {item.submitter_trust_tier && <TrustTierBadge tier={item.submitter_trust_tier} />}
                    <span className={age.urgent && pending ? "adm-queue__late" : undefined}>· {age.label}</span>
                    {item.is_random_sample && <span className="adm-badge draft">Sample</span>}
                  </div>
                </div>
                <div className="adm-list__actions">
                  {!pending && <ReviewStatusBadge status={item.status} />}
                  <Link href={href} className="adm-btn small">{pending ? "Preview" : "Open"}</Link>
                  {pending && (
                    <>
                      <Link href={`${href}?decide=approve#decision`} className="adm-btn small approve">Approve →</Link>
                      <Link href={`${href}?decide=amend#decision`} className="adm-btn small warn">Request changes</Link>
                      <Link href={`${href}?decide=reject#decision`} className="adm-btn small reject">Reject</Link>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
