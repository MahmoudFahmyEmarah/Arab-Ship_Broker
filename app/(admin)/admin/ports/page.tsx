import Link from "next/link";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PortsGrid } from "@/components/admin/ports/PortsGrid";
import { CreatePortModal } from "@/components/admin/ports/CreatePortModal";
import type { AdminPortRow } from "@/lib/admin/types";

const ZONE_TABS = [
  "ALL", "B.SEA", "E.MED", "W.MED", "C.MED", "ADRIATIC", "R.SEA", "AG",
  "A.SEA", "WCAF", "ECAF", "NCONT", "CARIB", "F.EAST", "ECI",
] as const;

export default async function AdminPortsPage({
  searchParams,
}: {
  searchParams: Promise<{
    zone?: string;
    unverified?: string;
    inactive?: string;
    create?: string;
  }>;
}) {
  await requireAdmin({ section: "ports" });
  const params = await searchParams;
  const supabase = await getAdminSupabaseClient();

  const zoneFilter = params.zone ?? "ALL";
  const unverifiedOnly = params.unverified === "1";
  const showInactive = params.inactive === "1";
  const showCreate = params.create === "1";

  let q = supabase
    .from("ports")
    .select(
      "locode, trade_name, country, zone, port_type, latitude, longitude, is_active, is_verified, notes, created_at",
    )
    .order("trade_name");

  if (zoneFilter !== "ALL") q = q.eq("zone", zoneFilter);
  if (unverifiedOnly) q = q.eq("is_verified", false);
  if (!showInactive) q = q.eq("is_active", true);

  const { data } = await q.limit(500);
  const ports = (data ?? []) as AdminPortRow[];
  const unverifiedCount = ports.filter((p) => !p.is_verified).length;

  const buildHref = (overrides: Record<string, string>) => {
    const p = new URLSearchParams({
      zone: zoneFilter,
      ...(unverifiedOnly && { unverified: "1" }),
      ...(showInactive && { inactive: "1" }),
      ...overrides,
    });
    return `/admin/ports?${p}`;
  };

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Ports"
        subtitle={`${ports.length} ports · ${unverifiedCount} awaiting verification`}
        warn={
          unverifiedCount > 0 && !unverifiedOnly ? (
            <span>
              {unverifiedCount} port{unverifiedCount !== 1 ? "s" : ""} awaiting verification.{" "}
              <Link href={buildHref({ unverified: "1" })} className="adm-link">Review →</Link>
            </span>
          ) : undefined
        }
      >
        <Link href={buildHref({ create: "1" })} className="adm-btn primary">+ Add port</Link>
      </AdminPageHeader>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {ZONE_TABS.map((tab) => (
          <Link
            key={tab}
            href={buildHref({ zone: tab })}
            className={`adm-filter-chip${zoneFilter === tab ? " is-on" : ""}`}
          >
            {tab === "ALL" ? "All zones" : tab}
          </Link>
        ))}
        <span style={{ flex: 1 }} />
        <Link
          href={buildHref({ unverified: unverifiedOnly ? "" : "1" })}
          className={`adm-filter-chip${unverifiedOnly ? " is-on" : ""}`}
        >
          Unverified only
        </Link>
        <Link
          href={buildHref({ inactive: showInactive ? "" : "1" })}
          className={`adm-filter-chip${showInactive ? " is-on" : ""}`}
        >
          {showInactive ? "Including inactive" : "Show inactive"}
        </Link>
      </div>

      <PortsGrid ports={ports} />

      {showCreate && <CreatePortModal />}
    </div>
  );
}
