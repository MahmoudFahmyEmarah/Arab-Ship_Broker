import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  Plus,
  Ship,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Anchor,
  AlertTriangle,
  MapPin,
  Calendar,
  Ruler,
  Waves,
  ClipboardCheck,
} from "lucide-react";

import {
  VesselAvailabilityWithVessel,
  VesselStatus,
  ReviewStatus,
  MyVesselRow,
} from "@/lib/schemas/vessel";
import { cn } from "@/lib/utils";

function getDateUrgency(openDate: string | null): {
  color: string;
  icon: React.ElementType | null;
  label: string | null;
} {
  if (!openDate) return { color: "", icon: null, label: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const open = new Date(openDate);
  const diffDays = Math.ceil(
    (open.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0)
    return { color: "text-red-600", icon: AlertTriangle, label: "Overdue" };
  if (diffDays <= 7)
    return {
      color: "text-amber-600",
      icon: AlertTriangle,
      label: "Due soon",
    };
  return { color: "text-green-600", icon: CheckCircle2, label: "On track" };
}

export default async function MyVesselsPage() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: appUser } = await supabase
    .from("users")
    .select("role")
    .eq("supabase_user_id", user.id)
    .single();

  const canAccessVesselPages =
    appUser?.role === "vessel_owner" || appUser?.role === "broker";
  if (!canAccessVesselPages) redirect("/dashboard");

  const { data: myVesselsData } = await supabase
    .from("v_my_vessels")
    .select("*")
    .order("claimed_at", { ascending: false });

  const myVessels = (myVesselsData ?? []) as MyVesselRow[];
  const quickPostHref = myVessels[0]
    ? `/dashboard/vessels/${myVessels[0].id}/availability/new`
    : "/dashboard/vessels/register";

  const { data: ownership } = await supabase
    .from("listing_ownership")
    .select("listing_id")
    .eq("owner_user_id", user.id)
    .eq("listing_type", "vessel_availability")
    .eq("is_current", true)
    .eq("role", "primary");

  const ids = (ownership ?? []).map(
    (o: { listing_id: string }) => o.listing_id,
  );

  const listings: VesselAvailabilityWithVessel[] = [];
  if (ids.length) {
    const { data } = await supabase
      .from("vessel_availability")
      .select(
        `*, vessel:vessels (vessel_name, imo_number, vessel_type, dwt_grain, build_year, flag, risk_level, is_sanctioned, is_geared, grain_certified, dg_certified, max_draft_m)`,
      )
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (data) listings.push(...(data as VesselAvailabilityWithVessel[]));
  }

  const groups = {
    pending: listings.filter((l) => l.review_status === "PENDING"),
    open: listings.filter(
      (l) => l.review_status === "APPROVED" && l.status === "OPEN",
    ),
    subs: listings.filter((l) => l.status === "ON SUBS"),
    closed: listings.filter(
      (l) => l.status === "FIXED" || l.status === "INACTIVE",
    ),
  };

  return (
    <div className="space-y-10 py-2">
      <section>
        <div className="flex items-center justify-between mb-6 max-[768px]:flex-col max-[768px]:items-start max-[768px]:gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              My Vessels
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {myVessels.length > 0
                ? `${myVessels.length} registered · Open vessel page to post a position`
                : "Register your vessels to start posting positions"}
            </p>
          </div>
          <div className="flex items-center gap-2 max-[768px]:w-full">
            {myVessels.length > 0 && (
              <Link
                href={quickPostHref}
                className="flex items-center gap-2 border border-slate-200 text-slate-700 font-semibold px-4 py-2.5 rounded-xl text-sm hover:border-ocean-300 hover:text-ocean-700 transition-colors"
              >
                <Plus className="w-4 h-4" /> Post position
              </Link>
            )}
            <Link
              href="/dashboard/vessels/register"
              className="flex items-center gap-2 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" /> Register vessel
            </Link>
          </div>
        </div>

        {myVessels.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
            <div className="w-16 h-16 bg-ocean-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Ship className="w-8 h-8 text-ocean-400" />
            </div>
            <p className="text-slate-700 font-semibold text-base">
              No vessels registered yet
            </p>
            <p className="text-slate-400 text-sm mt-1.5 max-w-xs mx-auto">
              Add your vessel to the register, then post its operational
              positions.
            </p>
            <Link
              href="/dashboard/vessels/register"
              className="mt-5 inline-flex items-center gap-2 bg-ocean-600 text-white font-semibold px-5 py-2.5 rounded-xl text-sm hover:bg-ocean-700 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" /> Register your first vessel
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-3 max-[1024px]:grid-cols-2 max-[768px]:grid-cols-1 gap-4">
            {myVessels.map((v) => (
              <VesselCard key={v.id} vessel={v} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-6 max-[768px]:flex-col max-[768px]:items-start max-[768px]:gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              Open Positions
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {listings.length} total · {groups.open.length} open ·{" "}
              {groups.pending.length} under review
            </p>
          </div>
          {myVessels.length > 0 && (
            <Link
              href={quickPostHref}
              className="flex items-center gap-2 border border-slate-200 text-slate-700 font-semibold px-4 py-2.5 rounded-xl text-sm hover:border-ocean-300 hover:text-ocean-700 transition-colors max-[768px]:w-full max-[768px]:justify-center"
            >
              <Plus className="w-4 h-4" /> Post position
            </Link>
          )}
        </div>

        {listings.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-200">
            <Anchor className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-semibold">No open positions</p>
            {myVessels.length > 0 ? (
              <>
                <p className="text-slate-400 text-sm mt-1">
                  Go to a vessel&apos;s page and post a position to get started.
                </p>
                <div className="mt-4 flex gap-3 justify-center flex-wrap">
                  {myVessels.slice(0, 3).map((v) => (
                    <Link
                      key={v.id}
                      href={`/dashboard/vessels/${v.id}`}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-ocean-600 hover:text-ocean-700 px-3 py-1.5 rounded-lg border border-ocean-200 hover:border-ocean-300 transition-colors"
                    >
                      <Ship className="w-3.5 h-3.5" />
                      {v.vessel_name}
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-slate-400 text-sm mt-1">
                Register a vessel first, then post its operational positions.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {groups.pending.length > 0 && (
              <PositionSection
                title="Under Arab ShipBroker Review"
                count={groups.pending.length}
                listings={groups.pending}
              />
            )}
            {groups.open.length > 0 && (
              <PositionSection
                title="Open — in match results"
                count={groups.open.length}
                listings={groups.open}
              />
            )}
            {groups.subs.length > 0 && (
              <PositionSection
                title="On subs"
                count={groups.subs.length}
                listings={groups.subs}
              />
            )}
            {groups.closed.length > 0 && (
              <PositionSection
                title="Fixed / Inactive"
                count={groups.closed.length}
                listings={groups.closed}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function VesselCard({ vessel: v }: { vessel: MyVesselRow }) {
  const showRiskBadge = v.risk_level === "HIGH" || v.risk_level === "MEDIUM";
  const RISK_STYLE: Record<string, string> = {
    MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
    HIGH: "bg-red-50 text-red-700 border-red-200",
  };

  const currentYear = new Date().getFullYear();
  const vesselAge = v.build_year ? currentYear - v.build_year : null;
  const isInReview = v.vessel_review_status === "IN_REVIEW";

  return (
    <Link
      href={`/dashboard/vessels/${v.id}`}
      className="group bg-white border border-slate-200 rounded-2xl p-5 hover:border-ocean-300 hover:shadow-md transition-all"
    >
      {isInReview && (
        <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 mb-3 -mt-1">
          <ClipboardCheck className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />
          <p className="text-[11px] font-semibold text-orange-700 leading-snug">
            Vessel under review — tap to see details
          </p>
        </div>
      )}

      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-ocean-50 border border-ocean-100 flex items-center justify-center shrink-0 mt-0.5">
            <Ship className="w-4.5 h-4.5 text-ocean-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 group-hover:text-ocean-700 transition-colors truncate">
              {v.vessel_name}
            </p>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {v.vessel_type}
              {v.flag && ` · ${v.flag}`}
            </p>
          </div>
        </div>
        {showRiskBadge && (
          <span
            className={cn(
              "text-[10px] font-bold px-2 py-0.5 rounded-lg border shrink-0 uppercase tracking-wide",
              RISK_STYLE[v.risk_level],
            )}
          >
            {v.risk_level}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        <StatPill
          label="DWT"
          value={v.dwt_grain ? `${v.dwt_grain.toLocaleString()} MT` : "—"}
        />
        <StatPill
          label="Built"
          value={
            v.build_year
              ? vesselAge
                ? `${v.build_year} (${vesselAge} yrs)`
                : String(v.build_year)
              : "—"
          }
        />
        {v.max_loa_m && (
          <StatPill label="LOA" value={`${v.max_loa_m} m`} icon={Ruler} />
        )}
        {v.max_draft_m && (
          <StatPill
            label="Draft — Summer"
            value={`${v.max_draft_m} m`}
            icon={Waves}
          />
        )}
      </div>

      {(v.open_port_name || v.open_date) && (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs space-y-1 mb-3">
          {v.open_port_name && (
            <div className="flex items-center gap-1.5 text-slate-600">
              <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
              <span>
                <span className="font-semibold text-slate-700">
                  {v.open_port_name}
                </span>
                {v.open_zone && (
                  <span className="text-slate-400 ml-1">({v.open_zone})</span>
                )}
              </span>
            </div>
          )}
          {v.open_date && (
            <div className="flex items-center gap-1.5 text-slate-600">
              <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
              <span>{v.open_date}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-slate-100">
        {v.open_availability_count > 0 ? (
          <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
            {v.open_availability_count} open position
            {v.open_availability_count > 1 ? "s" : ""}
          </span>
        ) : (
          <span className="text-xs text-slate-400 italic">
            No open positions
          </span>
        )}
        <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-ocean-500 group-hover:translate-x-0.5 transition-all" />
      </div>
    </Link>
  );
}
function StatPill({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="bg-slate-50 rounded-lg px-2.5 py-2 border border-slate-100">
      <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-0.5">
        {label}
      </p>
      <div className="flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3 text-slate-400" />}
        <p className="text-xs font-bold text-slate-700">{value}</p>
      </div>
    </div>
  );
}

function PositionSection({
  title,
  count,
  listings,
}: {
  title: string;
  count: number;
  listings: VesselAvailabilityWithVessel[];
}) {
  return (
    <div>
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
        {title}{" "}
        <span className="ml-1 text-slate-300 font-normal normal-case">
          ({count})
        </span>
      </h3>
      <div className="grid grid-cols-3 max-[1024px]:grid-cols-2 max-[640px]:grid-cols-1 gap-4">
        {listings.map((l) => (
          <PositionRow key={l.id} listing={l} />
        ))}
      </div>
    </div>
  );
}

const REVIEW_ICONS: Record<ReviewStatus, React.ElementType> = {
  PENDING: Clock,
  APPROVED: CheckCircle2,
  REJECTED: AlertCircle,
  FLAGGED: AlertCircle,
};

const REVIEW_COLORS: Record<ReviewStatus, string> = {
  PENDING: "text-amber-500",
  APPROVED: "text-green-500",
  REJECTED: "text-red-500",
  FLAGGED: "text-red-500",
};

const STATUS_LABELS: Record<VesselStatus, string> = {
  OPEN: "Open",
  FIXED: "Fixed",
  "ON SUBS": "On subs",
  INACTIVE: "Inactive",
};

function PositionRow({ listing }: { listing: VesselAvailabilityWithVessel }) {
  const ReviewIcon = REVIEW_ICONS[listing.review_status];
  const isPending = listing.review_status === "PENDING";

  const urgency = getDateUrgency(listing.open_date);
  const UrgencyIcon = urgency.icon;

  return (
    <Link
      href={`/dashboard/vessels/${listing.vessel_id}/availability/${listing.id}`}
      className="group bg-white border border-slate-200 rounded-2xl p-5 hover:border-ocean-300 hover:shadow-md transition-all flex flex-col gap-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-ocean-50 border border-ocean-100 flex items-center justify-center shrink-0 mt-0.5">
            <Ship className="w-4 h-4 text-ocean-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 group-hover:text-ocean-700 transition-colors truncate">
              {listing.vessel.vessel_name}
            </p>
            <p className="text-xs text-slate-400 truncate mt-0.5">
              {listing.vessel.vessel_type}
              {listing.vessel.dwt_grain
                ? ` · ${listing.vessel.dwt_grain.toLocaleString()} DWT`
                : ""}
            </p>
          </div>
        </div>
        {isPending ? (
          <span className="shrink-0 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
            Under Review
          </span>
        ) : (
          <span className="shrink-0 text-xs font-semibold text-slate-500">
            {STATUS_LABELS[listing.status]}
          </span>
        )}
      </div>

      {/* Open port */}
      {listing.open_port_name && (
        <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="font-semibold text-slate-700 truncate">
            {listing.open_port_name}
            {listing.open_zone ? ` (${listing.open_zone})` : ""}
          </span>
        </div>
      )}

      {/* Open date */}
      {listing.open_date && (
        <div
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border",
            urgency.color
              ? "bg-amber-50 border-amber-100"
              : "bg-slate-50 border-slate-100",
            urgency.color || "text-slate-600",
          )}
        >
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span>{listing.open_date}</span>
          {UrgencyIcon && <UrgencyIcon className="w-3 h-3 ml-auto" />}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-100 mt-auto">
        <div className={cn("flex items-center gap-1.5", REVIEW_COLORS[listing.review_status])}>
          <ReviewIcon className="w-3.5 h-3.5" />
          <span className="text-[11px] font-semibold">
            {listing.review_status === "PENDING" ? "Pending Review" : listing.review_status}
          </span>
        </div>
        <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-ocean-500 group-hover:translate-x-0.5 transition-all" />
      </div>
    </Link>
  );
}
