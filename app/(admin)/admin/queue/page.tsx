import Link from "next/link";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ReviewStatusBadge, TrustTierBadge } from "@/components/admin/AdminBadge";
import { QueueFilters } from "@/components/admin/queue/QueueFilters";
import type { QueueItem } from "@/lib/admin/types";

type StatusFilter = "PENDING" | "APPROVED" | "REJECTED" | "FLAGGED" | "ALL";
type TypeFilter = "cargo" | "vessel_availability";

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

// The design's review queue (Portal standalone 7 · PageReview): Cargo / Vessel submission tabs with counts, a
// filter bar of dropdowns with "N pending · oldest first", and one row per submission with Preview · Approve →
// · Request changes · Reject. Every decision is still taken on the submission's own page (its checks and the
// listing in full are there); the row buttons open it with that decision ready.
export default async function AdminQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; tier?: string; commodity?: string; zone?: string; range?: string }>;
}) {
  await requireAdmin({ section: "review" });
  const params = await searchParams;
  const supabase = await getAdminSupabaseClient();

  const statusFilter: StatusFilter = STATUSES.includes(params.status as StatusFilter) ? (params.status as StatusFilter) : "PENDING";
  const typeFilter: TypeFilter = params.type === "vessel_availability" ? "vessel_availability" : "cargo";

  let query = supabase.from("v_admin_queue_detail").select("*").order("created_at", { ascending: true });
  if (statusFilter !== "ALL") query = query.eq("status", statusFilter);
  query = query.eq("listing_type", typeFilter);
  if (params.tier) query = query.eq("submitter_trust_tier", params.tier);
  if (params.commodity) query = query.eq("commodity_name", params.commodity);
  if (params.zone) query = typeFilter === "cargo" ? query.or(`load_zone.eq.${params.zone},disch_zone.eq.${params.zone}`) : query.eq("open_zone", params.zone);
  if (params.range && RANGES[params.range]) query = query.gte("created_at", sinceIso(RANGES[params.range]));
  const { data } = await query.limit(200);
  const items = (data ?? []) as QueueItem[];

  // tab counts at the chosen status, and the option lists for the dropdowns
  let countQuery = supabase.from("v_admin_queue_detail").select("listing_type, commodity_name, load_zone, disch_zone, open_zone");
  if (statusFilter !== "ALL") countQuery = countQuery.eq("status", statusFilter);
  const { data: all } = await countQuery.limit(2000);
  const rows = (all ?? []) as { listing_type: string; commodity_name: string | null; load_zone: string | null; disch_zone: string | null; open_zone: string | null }[];
  const count = (t: TypeFilter) => rows.filter((r) => r.listing_type === t).length;
  const commodities = [...new Set(rows.map((r) => r.commodity_name).filter((x): x is string => !!x))].sort();
  const zones = [...new Set(rows.filter((r) => r.listing_type === typeFilter).flatMap((r) => (typeFilter === "cargo" ? [r.load_zone, r.disch_zone] : [r.open_zone])).filter((x): x is string => !!x))].sort();

  const tabHref = (t: TypeFilter) => `/admin/queue?status=${statusFilter}&type=${t}`;
  const statusWord = statusFilter === "ALL" ? "shown" : statusFilter.toLowerCase();

  return (
    <div className="adm-page">
      <AdminPageHeader title="Listing review queue" subtitle="Approve, request changes, or reject pending submissions" />

      <div className="adm-tabs adm-tabs--card">
        <Link href={tabHref("cargo")} className={`adm-tab${typeFilter === "cargo" ? " is-on" : ""}`} aria-current={typeFilter === "cargo" ? "page" : undefined}>
          Cargo submissions <span className="adm-tab__count">{count("cargo")}</span>
        </Link>
        <Link href={tabHref("vessel_availability")} className={`adm-tab${typeFilter === "vessel_availability" ? " is-on" : ""}`} aria-current={typeFilter === "vessel_availability" ? "page" : undefined}>
          Vessel submissions <span className="adm-tab__count">{count("vessel_availability")}</span>
        </Link>
      </div>

      <QueueFilters
        summary={`${items.length} ${statusWord} · oldest first`}
        filters={[
          { key: "status", label: "Status: pending", options: STATUSES.filter((s) => s !== "PENDING").map((s) => ({ value: s, label: `Status: ${s.toLowerCase()}` })) },
          { key: "range", label: "Date range", options: [{ value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "90d", label: "Last 90 days" }] },
          { key: "tier", label: "User tier", options: [{ value: "NEW", label: "New" }, { value: "VERIFIED", label: "Verified" }, { value: "FLAGGED", label: "Flagged" }] },
          ...(typeFilter === "cargo" ? [{ key: "commodity", label: "Commodity", options: commodities.map((c) => ({ value: c, label: c })) }] : []),
          { key: "zone", label: "Zone", options: zones.map((z) => ({ value: z, label: z })) },
        ]}
      />

      {items.length === 0 ? (
        <div className="adm-empty">
          {statusFilter === "PENDING"
            ? "Queue is clear. All submissions have been reviewed."
            : `No ${statusWord} submissions. Adjust the filters to see others.`}
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
