import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  User,
  Mail,
  Calendar,
  Package,
  Ship,
  Clock,
  ExternalLink,
} from "lucide-react";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  TrustTierBadge,
  AdminBadge,
  ReviewStatusBadge,
} from "@/components/admin/AdminBadge";
import { UserControls } from "@/components/admin/users/UserControls";
import type { AdminUserRow } from "@/lib/admin/types";

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function fmtFull(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await getAdminSupabaseClient();

  const { data: user, error } = await supabase
    .from("users")
    .select(
      "id, supabase_user_id, name, full_name, email, role, trust_tier, is_active, clean_posts, strike_count, company, phone, notes, created_at, updated_at",
    )
    .eq("id", id)
    .single();

  if (error || !user) notFound();
  const u = user as AdminUserRow;

  const { data: cargoOwnership } = await supabase
    .from("listing_ownership")
    .select("listing_id")
    .eq("owner_user_id", u.supabase_user_id)
    .eq("listing_type", "cargo")
    .eq("is_current", true);

  const cargoIds = (cargoOwnership ?? []).map(
    (o: { listing_id: string }) => o.listing_id,
  );
  const { data: cargoListings } = cargoIds.length
    ? await supabase
        .from("cargo_listings")
        .select(
          "id, ref, commodity_name, qty_max_mt, load_zone, disch_zone, status, review_status, created_at",
        )
        .in("id", cargoIds)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };

  const { data: vesselOwnership } = await supabase
    .from("listing_ownership")
    .select("listing_id")
    .eq("owner_user_id", u.supabase_user_id)
    .eq("listing_type", "vessel_availability")
    .eq("is_current", true);

  const vaIds = (vesselOwnership ?? []).map(
    (o: { listing_id: string }) => o.listing_id,
  );
  const { data: vesselListings } = vaIds.length
    ? await supabase
        .from("vessel_availability")
        .select(
          "id, ref, open_port_name, open_port_locode, open_zone, open_date, status, review_status, created_at, vessel:vessels(vessel_name, dwt_grain)",
        )
        .in("id", vaIds)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };

  const { data: queueHistory } = await supabase
    .from("review_queue")
    .select(
      "id, listing_type, status, action_taken, review_reason, reviewed_at, created_at",
    )
    .eq("submitted_by", u.supabase_user_id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="space-y-6 max-w-6xl">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Users
      </Link>

      <AdminPageHeader
        title={u.full_name || u.name || "Unknown user"}
        subtitle={u.email}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-6">
            <div className="flex items-start gap-4 mb-5">
              <div className="w-14 h-14 bg-ocean-100 rounded-2xl flex items-center justify-center shrink-0">
                <User className="w-7 h-7 text-ocean-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <TrustTierBadge tier={u.trust_tier} />
                  {!u.is_active && (
                    <AdminBadge variant="inactive" label="Suspended" />
                  )}
                  <AdminBadge
                    variant="neutral"
                    label={u.role.replace("_", " ")}
                  />
                </div>
                <h2 className="text-lg font-bold text-slate-900">
                  {u.full_name || u.name}
                </h2>
                <p className="text-sm text-slate-400">{u.email}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-start gap-2">
                <Mail className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Email
                  </p>
                  <p className="text-sm font-medium text-slate-700 mt-0.5">
                    {u.email}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Calendar className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Joined
                  </p>
                  <p className="text-sm font-medium text-slate-700 mt-0.5">
                    {fmt(u.created_at)}
                  </p>
                </div>
              </div>
            </div>
            {/* Trust progress */}
            <div className="mt-5 pt-5 border-t border-slate-100">
              <div className="flex justify-between items-center mb-1.5">
                <p className="text-xs font-semibold text-slate-500">
                  Progress to VERIFIED
                </p>
                <p className="text-xs font-bold text-slate-700">
                  {u.clean_posts} / 5 clean posts
                </p>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{
                    width: `${Math.min((u.clean_posts / 5) * 100, 100)}%`,
                  }}
                />
              </div>
              {u.strike_count > 0 && (
                <p className="text-xs text-red-500 mt-1.5">
                  {u.strike_count} strike{u.strike_count !== 1 ? "s" : ""}{" "}
                  recorded{u.strike_count >= 2 ? " — auto-downgraded" : ""}
                </p>
              )}
            </div>
            {u.notes && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Admin notes
                </p>
                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                  {u.notes}
                </p>
              </div>
            )}
          </div>

          <HistorySection
            title="Cargo listings"
            icon={Package}
            count={(cargoListings ?? []).length}
            empty="No cargo listings"
          >
            {(cargoListings ?? []).map((cl: Record<string, unknown>) => (
              <HistoryRow
                key={cl.id as string}
                href={`/admin/cargo/${cl.id}`}
                badge={
                  <ReviewStatusBadge status={cl.review_status as string} />
                }
                primary={`${cl.commodity_name} · ${Number(cl.qty_max_mt).toLocaleString()} MT`}
                secondary={`${cl.load_zone} → ${cl.disch_zone} · ${cl.status}`}
                meta={fmt(cl.created_at as string)}
                icon={Package}
              />
            ))}
          </HistorySection>

          <HistorySection
            title="Vessel availability"
            icon={Ship}
            count={(vesselListings ?? []).length}
            empty="No vessel postings"
          >
            {(vesselListings ?? []).map((va: Record<string, unknown>) => {
              const vessel = va.vessel as Record<string, unknown> | null;
              return (
                <HistoryRow
                  key={va.id as string}
                  href={`/admin/vessel-availability/${va.id}`}
                  badge={
                    <ReviewStatusBadge status={va.review_status as string} />
                  }
                  primary={`${vessel?.vessel_name ?? "Unknown"} · ${vessel?.dwt_grain ? `${Number(vessel.dwt_grain).toLocaleString()} DWT` : "?"}`}
                  secondary={
                    <span>
                      Open:{" "}
                      {va.open_port_name && va.open_port_locode ? (
                        <Link
                          href={`/dashboard/ports/${va.open_port_locode as string}`}
                          className="font-semibold text-slate-700 hover:text-ocean-700 hover:underline"
                        >
                          {va.open_port_name as string}
                        </Link>
                      ) : (
                        ((va.open_port_name as string) ?? "?")
                      )}{" "}
                      ({(va.open_zone as string) ?? "?"}) · {(va.open_date as string) ?? "?"}
                    </span>
                  }
                  meta={fmt(va.created_at as string)}
                  icon={Ship}
                />
              );
            })}
          </HistorySection>

          {/* Queue history */}
          <HistorySection
            title="Review history"
            icon={Clock}
            count={(queueHistory ?? []).length}
            empty="No review history"
          >
            {(queueHistory ?? []).map((rq: Record<string, unknown>) => (
              <HistoryRow
                key={rq.id as string}
                href={`/admin/queue/${rq.id}`}
                badge={<ReviewStatusBadge status={rq.status as string} />}
                primary={`${(rq.listing_type as string).replace("_", " ")} · ${rq.action_taken ?? "pending"}`}
                secondary={(rq.review_reason as string) ?? "—"}
                meta={fmtFull(rq.reviewed_at as string | null)}
                icon={rq.listing_type === "cargo" ? Package : Ship}
              />
            ))}
          </HistorySection>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <UserControls user={u} />
        </div>
      </div>
    </div>
  );
}

function HistorySection({
  title,
  icon: Icon,
  count,
  empty,
  children,
}: {
  title: string;
  icon: React.ElementType;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-700">{title}</h3>
        </div>
        <span className="text-xs font-semibold text-slate-400">{count}</span>
      </div>
      {count === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-slate-400">{empty}</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">{children}</div>
      )}
    </div>
  );
}

function HistoryRow({
  href,
  badge,
  primary,
  secondary,
  meta,
  icon: Icon,
}: {
  href: string;
  badge: React.ReactNode;
  primary: string;
  secondary: React.ReactNode;
  meta: string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors group">
      <Icon className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          {badge}
          <Link
            href={href}
            className="text-xs font-semibold text-slate-700 truncate hover:text-ocean-700"
          >
            {primary}
          </Link>
        </div>
        <p className="text-xs text-slate-400 truncate">{secondary}</p>
        <p className="text-[11px] text-slate-300 mt-0.5">{meta}</p>
      </div>
      <Link
        href={href}
        className="text-slate-300 group-hover:text-ocean-400 shrink-0 transition-colors mt-0.5"
        aria-label="Open record"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
