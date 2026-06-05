import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import {
  Edit,
  Ship,
  MapPin,
  Calendar,
  Package,
  TrendingUp,
  CheckCircle2,
  Clock,
  Zap,
} from "lucide-react";

import {
  getAvailabilityById,
  getMatchesForAvailability,
} from "@/sdk/app/vessels";
import { VesselMatchResult } from "@/lib/schemas/vessel";

interface PageProps {
  params: Promise<{ vesselId: string; id: string }>;
}

export default async function AvailabilityDetailPage({ params }: PageProps) {
  const { vesselId, id } = await params;
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

  const availability = await getAvailabilityById(supabase, id);
  if (!availability) notFound();
  if (availability.vessel_id !== vesselId) {
    redirect(`/dashboard/vessels/${availability.vessel_id}/availability/${id}`);
  }

  // Fetch matches only for approved/open records
  let matches: VesselMatchResult[] = [];
  if (
    availability.review_status === "APPROVED" &&
    availability.status === "OPEN"
  ) {
    try {
      matches = await getMatchesForAvailability(supabase, id);
    } catch {
      // Non-fatal — show empty matches
    }
  }

  const vessel = availability.vessel;
  const isLive =
    availability.review_status === "APPROVED" && availability.status === "OPEN";

  return (
    <div className="space-y-8 px-6 py-6 md:px-8">
      {/* Header */}
      <div className="flex flex-row items-center justify-between gap-4 max-[768px]:flex-col max-[768px]:items-start">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/dashboard/vessels"
              className="text-sm text-asb-gray-500 hover:text-asb-ink-soft"
            >
              ← My postings
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-asb-navy">
            {vessel.vessel_name}
          </h1>
          <p className="text-sm text-asb-gray-500 mt-1">
            {vessel.vessel_type} · {vessel.dwt_grain?.toLocaleString() ?? "—"}{" "}
            MT DWT · {availability.ref ?? id.slice(0, 8)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge
            status={availability.status}
            reviewStatus={availability.review_status}
          />
          <Link
            href={`/dashboard/vessels/${vesselId}/availability/${id}/edit`}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-white border border-asb-gray-200 rounded hover:border-asb-blue transition-colors"
          >
            <Edit className="w-4 h-4" />
            Edit
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 max-[1024px]:grid-cols-1 gap-6">
        {/* Left: Posting details */}
        <div className="col-span-1 space-y-4">
          <div className="bg-white border border-asb-gray-200 rounded p-5 space-y-4">
            <h2 className="text-sm font-bold text-asb-gray-500 uppercase tracking-wider">
              Availability details
            </h2>
            <Detail
              icon={MapPin}
              label="Open at"
              value={
                availability.open_port_name && availability.open_port_locode ? (
                  <Link
                    href={`/dashboard/ports/${availability.open_port_locode}`}
                    className="hover:text-asb-blue hover:underline"
                  >
                    {availability.open_port_name}
                  </Link>
                ) : (
                  (availability.open_port_name ?? "—")
                )
              }
            />
            {(availability.ballast_port_name ||
              availability.ballast_port_locode) && (
              <Detail
                icon={MapPin}
                label="Ballast at"
                value={
                  availability.ballast_port_name &&
                  availability.ballast_port_locode ? (
                    <Link
                      href={`/dashboard/ports/${availability.ballast_port_locode}`}
                      className="hover:text-asb-blue hover:underline"
                    >
                      {availability.ballast_port_name}
                    </Link>
                  ) : (
                    (availability.ballast_port_name ??
                    availability.ballast_port_locode ??
                    "—")
                  )
                }
              />
            )}
            <Detail
              icon={MapPin}
              label="Zone"
              value={availability.open_zone ?? "—"}
            />
            <Detail
              icon={Calendar}
              label="Open date"
              value={availability.open_date ?? "—"}
            />
            <Detail
              icon={Calendar}
              label="Flexibility"
              value={`±${availability.open_date_range_days ?? 7} days`}
            />
            <Detail
              icon={Ship}
              label="Accepts part cargo"
              value={
                availability.accepts_part_cargo
                  ? "Yes (±20% DWT)"
                  : "No (±10% DWT)"
              }
            />
            {availability.last_cargo && (
              <Detail
                icon={Package}
                label="Last cargo"
                value={availability.last_cargo}
              />
            )}
            {availability.freight_idea_usd_mt && (
              <Detail
                icon={TrendingUp}
                label="Freight idea"
                value={`$${availability.freight_idea_usd_mt}/MT`}
              />
            )}
            {availability.service_speed_kn && (
              <Detail
                icon={Zap}
                label="Service speed"
                value={`${availability.service_speed_kn} kn`}
              />
            )}
            {availability.fuel_type && (
              <Detail
                icon={Zap}
                label="Fuel type"
                value={availability.fuel_type}
              />
            )}
            {availability.me_consumption_mt_day && (
              <Detail
                icon={TrendingUp}
                label="ME cons. sea"
                value={`${availability.me_consumption_mt_day} MT/day`}
              />
            )}
            {availability.me_consumption_port_mt_day && (
              <Detail
                icon={TrendingUp}
                label="ME cons. port"
                value={`${availability.me_consumption_port_mt_day} MT/day`}
              />
            )}
            {availability.aux_consumption_mt_day && (
              <Detail
                icon={TrendingUp}
                label="AUX cons. sea"
                value={`${availability.aux_consumption_mt_day} MT/day`}
              />
            )}
            {availability.aux_consumption_port_mt_day && (
              <Detail
                icon={TrendingUp}
                label="AUX cons. port"
                value={`${availability.aux_consumption_port_mt_day} MT/day`}
              />
            )}
          </div>

          <div className="bg-white border border-asb-gray-200 rounded p-5 space-y-4">
            <h2 className="text-sm font-bold text-asb-gray-500 uppercase tracking-wider">
              Vessel
            </h2>
            <Detail icon={Ship} label="Type" value={vessel.vessel_type} />
            <Detail
              icon={Ship}
              label="DWT (grain)"
              value={
                vessel.dwt_grain
                  ? `${vessel.dwt_grain.toLocaleString()} MT`
                  : "—"
              }
            />
            {vessel.build_year && (
              <Detail
                icon={Calendar}
                label="Built"
                value={String(vessel.build_year)}
              />
            )}
            {vessel.flag && (
              <Detail icon={Ship} label="Flag" value={vessel.flag} />
            )}
            <Detail
              icon={CheckCircle2}
              label="Geared"
              value={
                vessel.is_geared === true
                  ? "Yes"
                  : vessel.is_geared === false
                    ? "No"
                    : "Unknown"
              }
            />
            <Detail
              icon={CheckCircle2}
              label="Grain certified"
              value={
                vessel.grain_certified === true
                  ? "Yes"
                  : vessel.grain_certified === false
                    ? "No"
                    : "Unknown"
              }
            />
          </div>
        </div>

        {/* Right: Match results */}
        <div className="col-span-2 max-[1024px]:col-span-1 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-asb-navy mb-1">
              Matching cargoes
              {matches.length > 0 && (
                <span className="ml-2 text-sm font-semibold text-asb-blue bg-asb-blue-light px-2 py-0.5 rounded-md">
                  {matches.length}
                </span>
              )}
            </h2>
            {!isLive ? (
              <div className="bg-amber-50 border border-amber-200 rounded p-6 text-center">
                <Clock className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                <p className="text-sm font-semibold text-amber-900">
                  {availability.review_status === "PENDING"
                    ? "Pending review — match results available once approved"
                    : `This posting is ${availability.status.toLowerCase()} — matches hidden`}
                </p>
              </div>
            ) : matches.length === 0 ? (
              <div className="bg-asb-gray-50 border border-asb-gray-200 rounded p-10 text-center">
                <Package className="w-8 h-8 text-asb-gray-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-asb-gray-500">
                  No matching cargoes found
                </p>
                <p className="text-xs text-asb-gray-400 mt-1">
                  Match results refresh automatically as new cargo listings are
                  approved.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {matches.map((match) => (
                  <MatchCard key={match.cargo_id} match={match} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MatchCard({ match }: { match: VesselMatchResult }) {
  return (
    <div className="bg-white border border-asb-gray-200 rounded p-5 hover:border-asb-blue hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-asb-navy">
              {match.commodity_name}
            </p>
            {match.is_rate_aligned && (
              <span className="text-xs font-semibold bg-green-50 text-green-700 px-2 py-0.5 rounded-md border border-green-200">
                Rate aligned
              </span>
            )}
            {match.is_spot && (
              <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md">
                SPOT
              </span>
            )}
          </div>
          <p className="text-xs text-asb-gray-500 mt-0.5">
            {match.ref ?? "—"} · {match.cargo_type}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-asb-navy">
            {match.qty_min_mt.toLocaleString()} –{" "}
            {match.qty_max_mt.toLocaleString()} MT
          </p>
          <p className="text-xs text-asb-gray-400">
            DWT delta: {match.dwt_delta.toLocaleString()} MT
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 max-[1024px]:grid-cols-2 max-[768px]:grid-cols-1 gap-3 text-xs">
        <div>
          <p className="text-asb-gray-400 font-medium">Load port</p>
          <p className="font-semibold text-asb-ink-soft mt-0.5">
            {match.load_port_name}{" "}
            <span className="text-asb-gray-400">({match.load_zone})</span>
          </p>
        </div>
        <div>
          <p className="text-asb-gray-400 font-medium">Disch port</p>
          <p className="font-semibold text-asb-ink-soft mt-0.5">
            {match.disch_port_name}{" "}
            <span className="text-asb-gray-400">({match.disch_zone})</span>
          </p>
        </div>
        <div>
          <p className="text-asb-gray-400 font-medium">Laycan</p>
          <p className="font-semibold text-asb-ink-soft mt-0.5">
            {match.is_spot
              ? "SPOT"
              : match.laycan_from
                ? `${match.laycan_from} → ${match.laycan_to ?? "?"}`
                : "—"}
          </p>
        </div>
        <div>
          <p className="text-asb-gray-400 font-medium">Freight idea</p>
          <p className="font-semibold text-asb-ink-soft mt-0.5">
            {match.freight_idea_usd_mt
              ? `$${match.freight_idea_usd_mt}/MT`
              : "—"}
          </p>
        </div>
      </div>

      {/* Special requirements */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {match.requires_geared && (
          <span className="text-xs bg-orange-50 text-orange-700 px-2 py-0.5 rounded border border-orange-200">
            Geared required
          </span>
        )}
        {match.is_grain_cargo && (
          <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded border border-amber-200">
            Grain cert required
          </span>
        )}
        {match.is_dg_cargo && (
          <span className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded border border-red-200">
            DG cargo
          </span>
        )}
        {match.max_vessel_age_yr && (
          <span className="text-xs bg-asb-gray-100 text-asb-gray-700 px-2 py-0.5 rounded">
            Max age: {match.max_vessel_age_yr} yr
          </span>
        )}
        {match.max_draft_m && (
          <span className="text-xs bg-asb-gray-100 text-asb-gray-700 px-2 py-0.5 rounded">
            Max draft: {match.max_draft_m}m
          </span>
        )}
        {match.max_loa_m && (
          <span className="text-xs bg-asb-gray-100 text-asb-gray-700 px-2 py-0.5 rounded">
            Max LOA: {match.max_loa_m}m
          </span>
        )}
        {match.load_terms && (
          <span className="text-xs bg-asb-gray-100 text-asb-gray-700 px-2 py-0.5 rounded">
            {match.load_terms}
          </span>
        )}
      </div>
    </div>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-4 h-4 text-asb-gray-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-xs text-asb-gray-400">{label}</p>
        <p className="text-sm font-semibold text-asb-ink">{value}</p>
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  reviewStatus,
}: {
  status: string;
  reviewStatus: string;
}) {
  if (reviewStatus === "PENDING") {
    return (
      <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded">
        <Clock className="w-3.5 h-3.5" /> Pending review
      </span>
    );
  }
  if (status === "OPEN") {
    return (
      <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-green-50 text-green-700 border border-green-200 rounded">
        <CheckCircle2 className="w-3.5 h-3.5" /> Live
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-asb-gray-100 text-asb-gray-700 border border-asb-gray-200 rounded">
      {status}
    </span>
  );
}
