import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Ship,
  MapPin,
  Anchor,
  DollarSign,
  User,
  ExternalLink,
  ShieldAlert,
  Package,
} from "lucide-react";

import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  ReviewStatusBadge,
  VesselStatusBadge,
  RiskLevelBadge,
  AdminBadge,
} from "@/components/admin/AdminBadge";
import { VesselAvailabilityStatusControls } from "@/components/admin/vessel/VesselAvailabilityStatusControls";
import type { AdminVesselRow } from "@/lib/admin/types";

type AvailabilityDetail = {
  id: string;
  ref: string | null;
  status: string;
  review_status: string;
  open_port_name: string | null;
  open_port_locode: string | null;
  open_zone: string | null;
  open_date: string | null;
  open_date_range_days: number | null;
  last_cargo: string | null;
  accepts_part_cargo: boolean;
  freight_idea_usd_mt: number | null;
  service_speed_kn: number | null;
  me_consumption_mt_day: number | null;
  aux_consumption_mt_day: number | null;
  goes_live_at: string | null;
  created_at: string;
  notes: string | null;
  vessel: AdminVesselRow | null;
};

type ListingOwnership = {
  owner_user_id: string | null;
};

type OwnerRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type ReviewQueueHistoryItem = {
  id: string;
  status: string;
  action_taken: string | null;
  amendment_detail: string | null;
  created_at: string | null;
  reviewed_at: string | null;
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminVesselAvailabilityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin({ section: "vesselavail" });
  const { id } = await params;
  const adminClient = getSupabaseAdminClient();

  const { data: availability, error } = await adminClient
    .from("vessel_availability")
    .select(`*, vessel:vessels(*)`)
    .eq("id", id)
    .single();

  if (error || !availability) notFound();

  const va = availability as AvailabilityDetail;
  const vessel = va.vessel;

  const { data: ownership } = await adminClient
    .from("listing_ownership")
    .select("owner_user_id, role, owned_from")
    .eq("listing_id", id)
    .eq("listing_type", "vessel_availability")
    .eq("is_current", true)
    .maybeSingle();

  const ownershipRow = ownership as ListingOwnership | null;

  let owner: OwnerRow | null = null;
  if (ownershipRow?.owner_user_id) {
    const { data: u } = await adminClient
      .from("users")
      .select("id, full_name, email, trust_tier")
      .eq("id", ownershipRow.owner_user_id)
      .maybeSingle();
    owner = (u as OwnerRow | null) ?? null;
  }

  const { data: queueItems } = await adminClient
    .from("review_queue")
    .select(
      "id, status, action_taken, review_reason, amendment_detail, created_at, reviewed_at",
    )
    .eq("listing_id", id)
    .eq("listing_type", "vessel_availability")
    .order("created_at", { ascending: false });

  const queueHistory = (queueItems ?? []) as ReviewQueueHistoryItem[];
  const pendingQueueItemId =
    queueHistory.find((rq) => rq.status === "PENDING")?.id ?? null;

  return (
    <div className="space-y-6 max-w-5xl">
      <Link
        href="/admin/vessel-availability"
        className="inline-flex items-center gap-1.5 text-sm text-asb-gray-500 hover:text-asb-ink transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Vessel availability
      </Link>

      {vessel?.is_sanctioned && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-300 rounded px-4 py-3">
          <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
          <p className="text-sm font-bold text-red-800">
            SANCTIONED VESSEL — This posting should not be live.
          </p>
        </div>
      )}

      <AdminPageHeader
        title={`${vessel?.vessel_name ?? "Vessel"} — Open ${va.open_port_name ?? "?"}`}
        subtitle={`${va.ref ? `${va.ref} · ` : ""}${va.open_date ?? "?"}`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <ReviewStatusBadge status={va.review_status} />
            <VesselStatusBadge status={va.status} />
            {vessel && <RiskLevelBadge level={vessel.risk_level} />}
            {vessel?.is_sanctioned && (
              <AdminBadge variant="sanctioned" label="SANCTIONED" />
            )}
          </div>

          {vessel && (
            <InfoCard title="Vessel" icon={Ship}>
              <Grid2>
                <Cell label="Name" value={vessel.vessel_name ?? "—"} />
                <Cell label="IMO" value={vessel.imo_number ?? "—"} />
                <Cell label="Type" value={vessel.vessel_type ?? "—"} />
                <Cell
                  label="DWT grain"
                  value={
                    vessel.dwt_grain !== null
                      ? `${Number(vessel.dwt_grain).toLocaleString()} MT`
                      : "—"
                  }
                />
                <Cell
                  label="Build year"
                  value={
                    vessel.build_year !== null ? String(vessel.build_year) : "—"
                  }
                />
                <Cell label="Flag" value={vessel.flag ?? "—"} />
                <Cell
                  label="Geared"
                  value={
                    vessel.is_geared === null
                      ? "—"
                      : vessel.is_geared
                        ? "Yes"
                        : "No"
                  }
                />
                <Cell
                  label="Grain cert"
                  value={
                    vessel.grain_certified === null
                      ? "—"
                      : vessel.grain_certified
                        ? "Yes"
                        : "No"
                  }
                />
                <Cell
                  label="DG cert"
                  value={
                    vessel.dg_certified === null
                      ? "—"
                      : vessel.dg_certified
                        ? "Yes"
                        : "No"
                  }
                />
                <Cell label="Scope" value={vessel.scope} />
              </Grid2>
              <div className="mt-3 flex justify-end">
                <Link
                  href={`/admin/vessels/${vessel.id}`}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-asb-blue hover:text-asb-blue"
                >
                  Open vessel record <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            </InfoCard>
          )}

          <InfoCard title="Open position" icon={MapPin}>
            <Grid2>
              <Cell
                label="Port"
                value={
                  va.open_port_name && va.open_port_locode ? (
                    <span>
                      <Link
                        href={`/dashboard/ports/${va.open_port_locode}`}
                        className="hover:text-asb-blue hover:underline"
                      >
                        {va.open_port_name}
                      </Link>
                      <span className="text-asb-gray-400">
                        {` (${va.open_port_locode})`}
                      </span>
                    </span>
                  ) : (
                    `${va.open_port_name ?? "—"} (${va.open_port_locode ?? "—"})`
                  )
                }
              />
              <Cell label="Zone" value={va.open_zone ?? "—"} />
              <Cell label="Open date" value={va.open_date ?? "—"} />
              <Cell
                label="Flexibility"
                value={
                  va.open_date_range_days !== null
                    ? `±${va.open_date_range_days} days`
                    : "—"
                }
              />
              <Cell label="Last cargo" value={va.last_cargo ?? "—"} />
              <Cell
                label="Part cargo"
                value={
                  va.accepts_part_cargo ? "Yes (±20% DWT)" : "No (±10% DWT)"
                }
              />
            </Grid2>
          </InfoCard>

          <InfoCard title="Commercial" icon={DollarSign}>
            <Grid2>
              <Cell
                label="Freight idea"
                value={
                  va.freight_idea_usd_mt !== null
                    ? `$${va.freight_idea_usd_mt}/MT`
                    : "—"
                }
              />
              <Cell
                label="Service speed"
                value={
                  va.service_speed_kn !== null
                    ? `${va.service_speed_kn} kn`
                    : "—"
                }
              />
              <Cell
                label="ME consumption"
                value={
                  va.me_consumption_mt_day !== null
                    ? `${va.me_consumption_mt_day} MT/day`
                    : "—"
                }
              />
              <Cell
                label="Aux consumption"
                value={
                  va.aux_consumption_mt_day !== null
                    ? `${va.aux_consumption_mt_day} MT/day`
                    : "—"
                }
              />
              <Cell label="Goes live" value={fmt(va.goes_live_at)} />
              <Cell label="Submitted" value={fmt(va.created_at)} />
            </Grid2>
          </InfoCard>

          {va.notes && (
            <InfoCard title="Notes" icon={Anchor}>
              <p className="text-sm text-asb-gray-700 leading-relaxed whitespace-pre-wrap">
                {va.notes}
              </p>
            </InfoCard>
          )}

          {queueHistory.length > 0 && (
            <InfoCard title="Review history" icon={Package}>
              <div className="space-y-2">
                {queueHistory.map((rq) => (
                  <Link
                    key={rq.id}
                    href={`/admin/queue/${rq.id}`}
                    className="flex items-start justify-between gap-3 p-2.5 rounded hover:bg-asb-gray-50 transition-colors border border-transparent hover:border-asb-gray-200"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <ReviewStatusBadge status={rq.status} />
                        {rq.action_taken && (
                          <span className="text-[11px] text-asb-gray-400 capitalize">
                            {rq.action_taken}
                          </span>
                        )}
                      </div>
                      {rq.amendment_detail && (
                        <p className="text-xs text-asb-gray-500">
                          {rq.amendment_detail}
                        </p>
                      )}
                      <p className="text-[11px] text-asb-gray-400 mt-0.5">
                        {fmt(rq.reviewed_at ?? rq.created_at)}
                      </p>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-asb-gray-400 shrink-0 mt-0.5" />
                  </Link>
                ))}
              </div>
            </InfoCard>
          )}
        </div>

        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          {owner && (
            <div className="dp-card p-5">
              <p className="text-xs font-bold text-asb-gray-400 uppercase tracking-wider mb-3">
                Owner
              </p>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-asb-blue-light rounded-full flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-asb-blue" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-asb-ink">
                    {owner.full_name || "—"}
                  </p>
                  <p className="text-xs text-asb-gray-400">{owner.email || "—"}</p>
                  <Link
                    href={`/admin/users/${owner.id}`}
                    className="text-xs font-semibold text-asb-blue hover:text-asb-blue mt-1 inline-flex items-center gap-1"
                  >
                    View user <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            </div>
          )}

          <VesselAvailabilityStatusControls
            availabilityId={id}
            currentStatus={va.status}
            currentReviewStatus={va.review_status}
            pendingQueueItemId={pendingQueueItemId}
          />
        </div>
      </div>
    </div>
  );
}

function InfoCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="dp-card p-5">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-asb-gray-100">
        <Icon className="w-4 h-4 text-asb-gray-400" />
        <h3 className="text-xs font-bold text-asb-gray-500 uppercase tracking-wider">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}
function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</div>;
}
function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-asb-gray-400 uppercase tracking-wider mb-0.5">
        {label}
      </p>
      <p className="text-sm font-semibold text-asb-ink">{value}</p>
    </div>
  );
}
