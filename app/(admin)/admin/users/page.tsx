import Link from "next/link";
import {
  Users,
  Search,
  ArrowRight,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Mail,
  Building2,
  Calendar,
  BarChart2,
} from "lucide-react";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { TrustTierBadge, AdminBadge } from "@/components/admin/AdminBadge";
import type { AdminUserRow, TrustTier } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

type SortCol =
  | "created_at"
  | "full_name"
  | "trust_tier"
  | "clean_posts"
  | "strike_count";

const TIER_TABS: {
  label: string;
  value: TrustTier | "ALL";
  icon: React.ElementType;
}[] = [
  { label: "All", value: "ALL", icon: Users },
  { label: "NEW", value: "NEW", icon: Clock },
  { label: "VERIFIED", value: "VERIFIED", icon: CheckCircle2 },
  { label: "FLAGGED", value: "FLAGGED", icon: AlertTriangle },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    tier?: string;
    q?: string;
    sort?: string;
    inactive?: string;
  }>;
}) {
  await requireAdmin({ section: "users" });
  const params = await searchParams;
  const supabase = await getAdminSupabaseClient();

  const tierFilter = (params.tier ?? "ALL") as TrustTier | "ALL";
  const query = params.q ?? "";
  const sortCol = (params.sort ?? "created_at") as SortCol;
  const showInactive = params.inactive === "1";

  let q = supabase
    .from("users")
    .select(
      "id, name, full_name, email, role, trust_tier, is_active, clean_posts, strike_count, company, phone, notes, created_at, updated_at",
    )
    .neq("role", "admin")
    .order(sortCol, { ascending: sortCol === "full_name" });

  if (tierFilter !== "ALL") q = q.eq("trust_tier", tierFilter);
  if (!showInactive) q = q.eq("is_active", true);
  if (query.trim()) {
    q = q.or(`full_name.ilike.%${query.trim()}%,email.ilike.%${query.trim()}%`);
  }

  const { data } = await q.limit(500);
  const users = (data ?? []) as AdminUserRow[];

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
      sort: sortCol,
      ...(query && { q: query }),
      ...(showInactive && { inactive: "1" }),
      ...overrides,
    });
    return `/admin/users?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Users"
        subtitle={`${users.length} user${users.length !== 1 ? "s" : ""} shown`}
      />

      <div className="flex items-center gap-1 dp-card p-1 w-fit flex-wrap">
        {TIER_TABS.map((tab) => {
          const active = tierFilter === tab.value;
          const count = tab.value !== "ALL" ? countMap[tab.value] : undefined;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.value}
              href={buildHref({ tier: tab.value })}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                active
                  ? "bg-asb-blue text-white shadow-sm"
                  : "text-asb-gray-500 hover:bg-asb-gray-50 hover:text-asb-ink",
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {count !== undefined && count > 0 && (
                <span
                  className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none",
                    active
                      ? "bg-white/20 text-white"
                      : "bg-asb-gray-100 text-asb-gray-700",
                  )}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <form
          method="GET"
          action="/admin/users"
          className="relative flex-1 max-w-xs"
        >
          <input type="hidden" name="tier" value={tierFilter} />
          <input type="hidden" name="sort" value={sortCol} />
          {showInactive && <input type="hidden" name="inactive" value="1" />}
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-asb-gray-400" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Search name or email…"
            className="w-full pl-9 pr-4 h-9 text-sm rounded border border-asb-gray-200 bg-white focus:outline-none  focus:border-asb-blue focus:border-asb-blue"
          />
        </form>

        <Link
          href={buildHref({ inactive: showInactive ? "" : "1" })}
          className={cn(
            "text-xs px-3 py-2 rounded border font-medium transition-all",
            showInactive
              ? "bg-asb-navy-deep text-white border-asb-navy-deep"
              : "bg-white text-asb-gray-500 border-asb-gray-200 hover:border-asb-gray-200",
          )}
        >
          {showInactive ? "Hiding active" : "Show inactive"}
        </Link>
      </div>

      {users.length === 0 ? (
        <div className="dp-card py-16 text-center">
          <Users className="w-8 h-8 text-asb-gray-400 mx-auto mb-3" />
          <p className="text-asb-gray-500 font-semibold">No users found</p>
          <p className="text-asb-gray-400 text-sm mt-1">
            {query ? "Try a different search term" : "Adjust the filters"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 max-[1024px]:grid-cols-2 max-[640px]:grid-cols-1 gap-4">
          {users.map((user) => (
            <Link
              key={user.id}
              href={`/admin/users/${user.id}`}
              className="group dp-card p-5 hover:border-asb-blue hover:shadow-md transition-all flex flex-col gap-4"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded bg-asb-gray-50 border border-asb-gray-200 flex items-center justify-center shrink-0 mt-0.5">
                    <Users className="w-4 h-4 text-asb-gray-500" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-bold text-asb-navy group-hover:text-asb-blue transition-colors truncate">
                        {user.full_name || user.name || "—"}
                      </p>
                      {!user.is_active && (
                        <span className="shrink-0">
                          <AdminBadge variant="inactive" label="Suspended" />
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-asb-gray-400 truncate mt-0.5 capitalize">
                      {user.role.replace("_", " ")}
                    </p>
                  </div>
                </div>
                <TrustTierBadge tier={user.trust_tier} />
              </div>

              {/* Contact */}
              <div className="flex items-center gap-1.5 text-xs text-asb-gray-700 bg-asb-gray-50 rounded px-3 py-2 border border-asb-gray-100">
                <Mail className="w-3.5 h-3.5 text-asb-gray-400 shrink-0" />
                <span className="truncate text-asb-gray-700">{user.email}</span>
              </div>

              {/* Pills */}
              <div className="grid grid-cols-2 gap-2">
                {user.company && (
                  <DataPill
                    icon={Building2}
                    label="Company"
                    value={user.company}
                  />
                )}
                <DataPill
                  icon={BarChart2}
                  label="Clean posts"
                  value={String(user.clean_posts)}
                />
                <DataPill
                  icon={AlertTriangle}
                  label="Strikes"
                  value={String(user.strike_count)}
                  highlight={user.strike_count > 0}
                />
                <DataPill
                  icon={Calendar}
                  label="Joined"
                  value={formatDate(user.created_at)}
                />
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end pt-3 border-t border-asb-gray-100 mt-auto">
                <ArrowRight className="w-4 h-4 text-asb-gray-400 group-hover:text-asb-blue group-hover:translate-x-0.5 transition-all" />
              </div>
            </Link>
          ))}
        </div>
      )}

      <p className="text-xs text-asb-gray-400 text-right">
        {users.length} user{users.length !== 1 ? "s" : ""} ·{" "}
        {tierFilter !== "ALL" ? tierFilter : "all tiers"} ·{" "}
        {showInactive ? "including inactive" : "active only"}
      </p>
    </div>
  );
}

function DataPill({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-asb-gray-50 rounded-lg px-2.5 py-2 border border-asb-gray-100">
      <p className="text-[10px] text-asb-gray-400 font-semibold uppercase tracking-wide mb-0.5">
        {label}
      </p>
      <div className="flex items-center gap-1">
        <Icon
          className={cn(
            "w-3 h-3 shrink-0",
            highlight ? "text-red-400" : "text-asb-gray-400",
          )}
        />
        <p
          className={cn(
            "text-xs font-bold truncate",
            highlight ? "text-red-600" : "text-asb-ink-soft",
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
