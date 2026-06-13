import Link from "next/link";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  VesselAvailabilityTable,
  type AdminVesselAvailRow,
} from "@/components/admin/vessel/VesselAvailabilityTable";

const STATUS_TABS = ["ALL", "OPEN", "ON SUBS", "FIXED", "INACTIVE"] as const;
const REVIEW_TABS = ["ALL", "PENDING", "APPROVED", "REJECTED", "FLAGGED"] as const;

type VesselRow = {
  vessel_name?: string | null;
  imo_number?: string | null;
  vessel_type?: string | null;
  dwt_grain?: number | null;
  is_sanctioned?: boolean | null;
};

export default async function AdminVesselAvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; review?: string }>;
}) {
  await requireAdmin({ section: "vesselavail" });
  const params = await searchParams;
  const supabase = await getAdminSupabaseClient();

  const statusFilter = params.status ?? "ALL";
  const reviewFilter = params.review ?? "ALL";

  let q = supabase
    .from("vessel_availability")
    .select(
      `id, ref, status, review_status, open_port_name, open_zone, open_date, created_at,
       vessel:vessels(vessel_name, imo_number, vessel_type, dwt_grain, is_sanctioned)`,
    )
    .order("created_at", { ascending: false });

  if (statusFilter !== "ALL") q = q.eq("status", statusFilter);
  if (reviewFilter !== "ALL") q = q.eq("review_status", reviewFilter);

  const { data } = await q.limit(500);

  // Flatten the vessel join into plain row fields for the client table.
  const rows: AdminVesselAvailRow[] = (data ?? []).map((va) => {
    const raw = va as Record<string, unknown>;
    const v = (Array.isArray(raw.vessel) ? raw.vessel[0] : raw.vessel) as VesselRow | null;
    return {
      id: raw.id as string,
      ref: (raw.ref as string) ?? null,
      status: raw.status as string,
      review_status: raw.review_status as string,
      open_port_name: (raw.open_port_name as string) ?? null,
      open_zone: (raw.open_zone as string) ?? null,
      open_date: (raw.open_date as string) ?? null,
      vessel_name: v?.vessel_name ?? "—",
      imo_number: v?.imo_number ?? null,
      vessel_type: v?.vessel_type ?? null,
      dwt_grain: v?.dwt_grain ?? null,
      is_sanctioned: !!v?.is_sanctioned,
    };
  });

  const buildHref = (overrides: Record<string, string>) => {
    const p = new URLSearchParams({ status: statusFilter, review: reviewFilter, ...overrides });
    return `/admin/vessel-availability?${p}`;
  };

  return (
    <div className="adm-page">
      <AdminPageHeader title="Vessel availability" subtitle={`${rows.length} postings shown`} />

      <div className="adm-tabs">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab}
            href={buildHref({ status: tab })}
            className={`adm-tab${statusFilter === tab ? " is-on" : ""}`}
          >
            {tab === "ALL" ? "All" : tab}
          </Link>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "var(--adm-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
          Review
        </span>
        {REVIEW_TABS.map((tab) => (
          <Link
            key={tab}
            href={buildHref({ review: tab })}
            className={`adm-filter-chip${reviewFilter === tab ? " is-on" : ""}`}
          >
            {tab === "ALL" ? "All" : tab.charAt(0) + tab.slice(1).toLowerCase()}
          </Link>
        ))}
      </div>

      <VesselAvailabilityTable rows={rows} />
    </div>
  );
}
