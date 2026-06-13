import Link from "next/link";
import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  CargoListingsTable,
  type AdminCargoListRow,
} from "@/components/admin/cargo/CargoListingsTable";

type StatusFilter = "IN" | "PARTIAL" | "OUT" | "CLOSED" | "ALL";
type ReviewFilter = "PENDING" | "APPROVED" | "REJECTED" | "FLAGGED" | "ALL";

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: "IN", label: "Active" },
  { id: "PARTIAL", label: "Partial" },
  { id: "OUT", label: "Out of scope" },
  { id: "CLOSED", label: "Closed" },
  { id: "ALL", label: "All" },
];
const REVIEW_TABS: ReviewFilter[] = ["ALL", "PENDING", "APPROVED", "REJECTED", "FLAGGED"];

export default async function AdminCargoPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; review?: string; zone?: string }>;
}) {
  await requireAdmin({ section: "cargo" });
  const params = await searchParams;
  const supabase = await getAdminSupabaseClient();

  const statusFilter = (params.status ?? "IN") as StatusFilter;
  const reviewFilter = (params.review ?? "ALL") as ReviewFilter;
  const zoneFilter = params.zone ?? "";

  let q = supabase
    .from("cargo_listings")
    .select(
      "id, ref, status, review_status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo, qty_min_mt, qty_max_mt, load_port_name, load_zone, disch_port_name, disch_zone, laycan_from, laycan_to, is_spot, freight_idea_usd_mt",
    )
    .order("created_at", { ascending: false });

  if (statusFilter !== "ALL") q = q.eq("status", statusFilter);
  if (reviewFilter !== "ALL") q = q.eq("review_status", reviewFilter);
  if (zoneFilter) q = q.or(`load_zone.eq.${zoneFilter},disch_zone.eq.${zoneFilter}`);

  const { data } = await q.limit(500);
  const rows = (data ?? []) as AdminCargoListRow[];

  const buildHref = (overrides: Record<string, string>) => {
    const p = new URLSearchParams({
      status: statusFilter,
      review: reviewFilter,
      ...(zoneFilter && { zone: zoneFilter }),
      ...overrides,
    });
    return `/admin/cargo?${p}`;
  };

  return (
    <div className="adm-page">
      <AdminPageHeader title="Cargo listings" subtitle={`${rows.length} listings shown`} />

      <div className="adm-tabs">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.id}
            href={buildHref({ status: tab.id })}
            className={`adm-tab${statusFilter === tab.id ? " is-on" : ""}`}
          >
            {tab.label}
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

      <CargoListingsTable rows={rows} />
    </div>
  );
}
