import Link from "next/link";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { UsersTable, type AdminUserListRow } from "@/components/admin/users/UsersTable";
import type { TrustTier } from "@/lib/admin/types";

const TIER_TABS: { label: string; value: TrustTier | "ALL" }[] = [
  { label: "All", value: "ALL" },
  { label: "NEW", value: "NEW" },
  { label: "VERIFIED", value: "VERIFIED" },
  { label: "FLAGGED", value: "FLAGGED" },
];

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; inactive?: string }>;
}) {
  await requireAdmin({ section: "users" });
  const params = await searchParams;
  const supabase = await getAdminSupabaseClient();

  const tierFilter = (params.tier ?? "ALL") as TrustTier | "ALL";
  const showInactive = params.inactive === "1";

  let q = supabase
    .from("users")
    .select(
      "id, name, full_name, email, role, trust_tier, is_active, clean_posts, strike_count, company, created_at",
    )
    .neq("role", "admin")
    .order("created_at", { ascending: false });

  if (tierFilter !== "ALL") q = q.eq("trust_tier", tierFilter);
  if (!showInactive) q = q.eq("is_active", true);

  const { data } = await q.limit(500);
  const rows = (data ?? []) as AdminUserListRow[];

  const { data: tierCounts } = await supabase
    .from("users")
    .select("trust_tier")
    .neq("role", "admin")
    .eq("is_active", true);

  const countMap: Record<string, number> = {};
  (tierCounts ?? []).forEach((r: { trust_tier: string }) => {
    countMap[r.trust_tier] = (countMap[r.trust_tier] ?? 0) + 1;
  });

  const buildHref = (overrides: Record<string, string>) => {
    const p = new URLSearchParams({
      tier: tierFilter,
      ...(showInactive && { inactive: "1" }),
      ...overrides,
    });
    return `/admin/users?${p.toString()}`;
  };

  return (
    <div className="adm-page">
      <AdminPageHeader title="All users" subtitle={`${rows.length} user${rows.length !== 1 ? "s" : ""} shown`}>
        <Link
          href={buildHref({ inactive: showInactive ? "" : "1" })}
          className={`adm-filter-chip${showInactive ? " is-on" : ""}`}
        >
          {showInactive ? "Including inactive" : "Show inactive"}
        </Link>
      </AdminPageHeader>

      <div className="adm-tabs">
        {TIER_TABS.map((tab) => {
          const count = tab.value !== "ALL" ? countMap[tab.value] : undefined;
          return (
            <Link
              key={tab.value}
              href={buildHref({ tier: tab.value })}
              className={`adm-tab${tierFilter === tab.value ? " is-on" : ""}`}
            >
              {tab.label}
              {count !== undefined && count > 0 && <span className="adm-tab__count">{count}</span>}
            </Link>
          );
        })}
      </div>

      <UsersTable rows={rows} />
    </div>
  );
}
