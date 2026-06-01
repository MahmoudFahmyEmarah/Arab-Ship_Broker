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
} from "lucide-react";

import {
  VesselAvailabilityWithVessel,
  VesselStatus,
  ReviewStatus,
  MyVesselRow,
} from "@/lib/schemas/vessel";
import { cn } from "@/lib/utils";
import { VesselCard, type VesselCardData } from "@/components/vessels/VesselCard";

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
    return { color: "text-amber-600", icon: AlertTriangle, label: "Due soon" };
  return { color: "text-green-600", icon: CheckCircle2, label: "On track" };
}

/** Date → laycan urgency dot (matches the cargo-card thresholds). */
function laycanDot(openDate: string | null): "green" | "amber" | "red" {
  if (!openDate) return "green";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil(
    (new Date(openDate).getTime() - today.getTime()) / 86_400_000,
  );
  if (diff < 0) return "red";
  if (diff <= 7) return "amber";
  return "green";
}

const fmtOpenDate = (s: string | null) => {
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

/**
 * MyVesselRow (vessel specs + latest open position) merged with the owner's
 * latest availability (fuel consumption) → the canonical VesselCard.
 * This is the owner's OWN fleet, so identity is NOT masked: the manager/owner
 * company alias is shown. No personal contact (email/phone/PIC) is referenced.
 */
function toCardData(
  v: MyVesselRow,
  av: VesselAvailabilityWithVessel | undefined,
): VesselCardData {
  const hasPosition = !!v.open_port_name;
  const dir = v.preferred_trading_areas?.length
    ? v.preferred_trading_areas.join(" / ")
    : null;
  const viaName = v.manager_company ?? v.owner_company ?? null;
  const viaRole = v.manager_company ? "manager" : v.owner_company ? "owner" : undefined;

  return {
    imo: v.imo_number ?? "—",
    name: v.vessel_name,
    flag: v.flag,
    type: v.vessel_type,
    built: v.build_year,
    dwt: v.dwt_grain != null ? v.dwt_grain.toLocaleString() : null,
    grt: v.gross_tonnage != null ? v.gross_tonnage.toLocaleString() : null,
    loa: v.max_loa_m != null ? String(v.max_loa_m) : null,
    draft: v.max_draft_m != null ? String(v.max_draft_m) : null,
    gear: v.is_geared == null ? null : v.is_geared ? "Geared" : "Gearless",
    status: v.vessel_review_status === "IN_REVIEW" ? "REVIEW" : "OPEN",
    fuel: av
      ? {
          vs: av.me_consumption_mt_day != null ? String(av.me_consumption_mt_day) : null,
          vp: av.me_consumption_port_mt_day != null ? String(av.me_consumption_port_mt_day) : null,
          ls: av.aux_consumption_mt_day != null ? String(av.aux_consumption_mt_day) : null,
          lp: av.aux_consumption_port_mt_day != null ? String(av.aux_consumption_port_mt_day) : null,
        }
      : null,
    // Match engine not yet wired: a declared position shows "0 matches"
    // (placeholder), an undeclared one shows "No position yet".
    matches: hasPosition ? 0 : null,
    position: hasPosition
      ? {
          port: v.open_port_name as string,
          zone: v.open_zone,
          date: fmtOpenDate(v.open_date),
          lyc: laycanDot(v.open_date),
        }
      : null,
    dir,
    via: viaName ? { name: viaName, role: viaRole } : null,
    href: `/dashboard/vessels/${v.id}`,
  };
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

  // Latest availability per vessel (listings are ordered created_at desc) —
  // sources the fuel-consumption block for each fleet card.
  const availByVessel = new Map<string, VesselAvailabilityWithVessel>();
  for (const l of listings) {
    if (!availByVessel.has(l.vessel_id)) availByVessel.set(l.vessel_id, l);
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
          <div className="mvb-cardhost">
            {myVessels.map((v) => (
              <VesselCard
                key={v.id}
                vessel={toCardData(v, availByVessel.get(v.id))}
              />
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
