import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  Edit,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertCircle,
  Ship,
} from "lucide-react";

import { CargoListingRow } from "@/lib/schemas/cargo";
import { getMatchesForCargo, CargoMatchResult } from "@/sdk/app/cargos";

export default async function CargoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  const { data: cargo, error } = await supabase
    .from("cargo_listings")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !cargo) notFound();
  const listing = cargo as CargoListingRow;

  let isOwner = false;
  const { data: ownership } = await supabase
    .from("listing_ownership")
    .select("id")
    .eq("listing_id", id)
    .eq("owner_user_id", user.id)
    .eq("is_current", true)
    .single();
  isOwner = !!ownership;

  let matches: CargoMatchResult[] = [];
  if (
    listing.review_status === "APPROVED" &&
    (listing.status === "IN" || listing.status === "PARTIAL")
  ) {
    try {
      matches = await getMatchesForCargo(supabase, id);
    } catch {
      // Non-fatal
    }
  }

  const reviewCfg = {
    PENDING: {
      label: "Pending review",
      icon: Clock,
      cls: "bg-amber-50 text-amber-700 border-amber-200",
    },
    APPROVED: {
      label: "Live",
      icon: CheckCircle2,
      cls: "bg-green-50 text-green-700 border-green-200",
    },
    REJECTED: {
      label: "Rejected",
      icon: AlertCircle,
      cls: "bg-red-50 text-red-700 border-red-200",
    },
    FLAGGED: {
      label: "Flagged",
      icon: AlertCircle,
      cls: "bg-red-50 text-red-700 border-red-200",
    },
  }[listing.review_status];
  const ReviewIcon = reviewCfg.icon;

  const isLive =
    listing.review_status === "APPROVED" &&
    (listing.status === "IN" || listing.status === "PARTIAL");

  return (
    <div className="space-y-8 py-2 max-w-5xl">
      {/* Header */}
      <div className="flex flex-row items-start justify-between gap-4 max-[768px]:flex-col">
        <div>
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="bg-ocean-100 text-ocean-800 px-3 py-1 rounded-lg text-sm font-bold uppercase border border-ocean-200">
              {listing.cargo_type}
            </span>
            {listing.is_dg_cargo && (
              <span className="bg-red-100 text-red-800 px-3 py-1 rounded-lg text-sm font-bold flex items-center gap-1 border border-red-200">
                <ShieldAlert className="w-3.5 h-3.5" /> DG
              </span>
            )}
            {listing.is_grain_cargo && (
              <span className="bg-amber-100 text-amber-800 px-3 py-1 rounded-lg text-sm font-bold border border-amber-200">
                Grain
              </span>
            )}
            {listing.is_spot && (
              <span className="bg-green-100 text-green-800 px-3 py-1 rounded-lg text-sm font-bold border border-green-200">
                SPOT
              </span>
            )}
            <span
              className={`px-3 py-1 rounded-lg text-sm font-bold border flex items-center gap-1.5 ${reviewCfg.cls}`}
            >
              <ReviewIcon className="w-3.5 h-3.5" /> {reviewCfg.label}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {listing.commodity_name}
          </h1>
          {listing.ref && (
            <p className="text-sm text-slate-400 font-mono mt-1">
              {listing.ref}
            </p>
          )}
        </div>
        {isOwner && listing.status !== "CLOSED" && (
          <Link
            href={`/dashboard/cargo/${id}/edit`}
            className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2.5 rounded-xl font-semibold text-sm hover:bg-slate-50 transition-colors shrink-0"
          >
            <Edit className="w-4 h-4" /> Edit listing
          </Link>
        )}
      </div>

      {listing.review_status === "PENDING" && isOwner && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex gap-4">
          <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">
              Your listing is under review
            </p>
            <p className="text-xs text-amber-700 mt-1">
              Reviews are completed within 2 hours during business hours. Once
              approved, your listing is included in vessel matchmaking
              automatically.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 max-[1024px]:grid-cols-1 gap-6">
        {/* Left: Listing details */}
        <div className="col-span-1 space-y-4">
          <DetailCard title="Route">
            <DetailRow
              label="Load port"
              value={
                <span>
                  <Link
                    href={`/dashboard/ports/${listing.load_port_locode}`}
                    className="hover:text-ocean-700 hover:underline"
                  >
                    {listing.load_port_name}
                  </Link>
                  <span className="text-slate-400">
                    {" "}
                    ({listing.load_port_locode})
                  </span>
                </span>
              }
            />
            <DetailRow label="Load zone" value={listing.load_zone} />
            <DetailRow
              label="Discharge port"
              value={
                <span>
                  <Link
                    href={`/dashboard/ports/${listing.disch_port_locode}`}
                    className="hover:text-ocean-700 hover:underline"
                  >
                    {listing.disch_port_name}
                  </Link>
                  <span className="text-slate-400">
                    {" "}
                    ({listing.disch_port_locode})
                  </span>
                </span>
              }
            />
            <DetailRow label="Discharge zone" value={listing.disch_zone} />
          </DetailCard>

          <DetailCard title="Specifications">
            <DetailRow label="Commodity" value={listing.commodity_name} />
            <DetailRow
              label="Quantity"
              value={`${listing.qty_min_mt.toLocaleString()} – ${listing.qty_max_mt.toLocaleString()} MT`}
            />
            {listing.stowage_factor && (
              <DetailRow
                label="Stowage factor"
                value={`${listing.stowage_factor} m³/t`}
              />
            )}
            <DetailRow
              label="Laycan"
              value={
                listing.is_spot
                  ? "SPOT (any date)"
                  : `${listing.laycan_from} – ${listing.laycan_to}`
              }
            />
          </DetailCard>

          {(listing.load_terms || listing.freight_idea_usd_mt) && (
            <DetailCard title="Commercial Terms">
              {listing.load_terms && (
                <DetailRow label="Load terms" value={listing.load_terms} />
              )}
              {listing.load_rate && (
                <DetailRow label="Load rate" value={listing.load_rate} />
              )}
              {listing.disch_rate && (
                <DetailRow label="Discharge rate" value={listing.disch_rate} />
              )}
              {listing.freight_idea_usd_mt && (
                <DetailRow
                  label="Freight idea"
                  value={`$${listing.freight_idea_usd_mt}/MT`}
                />
              )}
              {listing.commission_pct && (
                <DetailRow
                  label="Commission"
                  value={`${listing.commission_pct}%`}
                />
              )}
              {listing.demurrage_rate && (
                <DetailRow
                  label="Demurrage"
                  value={`$${listing.demurrage_rate.toLocaleString()}/day`}
                />
              )}
            </DetailCard>
          )}

          {(listing.requires_geared !== null ||
            listing.max_vessel_age_yr !== null) && (
            <DetailCard title="Vessel Requirements">
              {listing.requires_geared !== null && (
                <DetailRow
                  label="Geared required"
                  value={listing.requires_geared ? "Yes" : "No"}
                />
              )}
              {listing.max_vessel_age_yr !== null && (
                <DetailRow
                  label="Max vessel age"
                  value={`${listing.max_vessel_age_yr} years`}
                />
              )}
              {listing.max_loa_m !== null && (
                <DetailRow label="Max LOA" value={`${listing.max_loa_m} m`} />
              )}
              {listing.max_draft_m !== null && (
                <DetailRow
                  label="Max draft"
                  value={`${listing.max_draft_m} m`}
                />
              )}
            </DetailCard>
          )}

          {listing.notes && (
            <DetailCard title="Notes">
              <p className="text-sm text-slate-600 leading-relaxed">
                {listing.notes}
              </p>
            </DetailCard>
          )}
        </div>

        <div className="col-span-2 max-[1024px]:col-span-1 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2">
              Matching vessels
              {matches.length > 0 && (
                <span className="text-sm font-semibold text-ocean-600 bg-ocean-50 px-2 py-0.5 rounded-md">
                  {matches.length}
                </span>
              )}
            </h2>

            {!isOwner ? null : !isLive ? (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
                <Clock className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                <p className="text-sm font-semibold text-amber-900">
                  {listing.review_status === "PENDING"
                    ? "Match results available once listing is approved"
                    : `Listing is ${listing.status.toLowerCase()} — matches hidden`}
                </p>
              </div>
            ) : matches.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-10 text-center">
                <Ship className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-500">
                  No matching vessels found
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Arab ShipBroker will contact you when a matching vessel is
                  identified.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {matches.map((match) => (
                  <VesselMatchCard key={match.availability_id} match={match} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function VesselMatchCard({ match }: { match: CargoMatchResult }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-ocean-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-4 mb-3 max-[768px]:flex-col">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-slate-900">
              {match.vessel_name}
            </p>
            {match.is_rate_aligned && (
              <span className="text-xs font-semibold bg-green-50 text-green-700 px-2 py-0.5 rounded-md border border-green-200">
                Rate aligned
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {match.vessel_ref ?? "—"} · {match.vessel_type}
          </p>
        </div>
        <div className="text-right max-[768px]:text-left shrink-0">
          <p className="text-sm font-bold text-slate-900">
            {match.dwt_grain
              ? `${match.dwt_grain.toLocaleString()} MT DWT`
              : "DWT unknown"}
          </p>
          <p className="text-xs text-slate-400">
            DWT delta: {match.dwt_delta.toLocaleString()} MT
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 max-[1024px]:grid-cols-2 max-[768px]:grid-cols-1 gap-3 text-xs mb-3">
        <div>
          <p className="text-slate-400 font-medium">Open at</p>
          <p className="font-semibold text-slate-700 mt-0.5">
            {match.open_port_name}{" "}
            <span className="text-slate-400">({match.open_zone})</span>
          </p>
        </div>
        <div>
          <p className="text-slate-400 font-medium">Open date</p>
          <p className="font-semibold text-slate-700 mt-0.5">
            {match.open_date ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-slate-400 font-medium">Flag</p>
          <p className="font-semibold text-slate-700 mt-0.5">
            {match.flag ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-slate-400 font-medium">Freight idea</p>
          <p className="font-semibold text-slate-700 mt-0.5">
            {match.freight_idea_usd_mt
              ? `$${match.freight_idea_usd_mt}/MT`
              : "—"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span
          className={`text-xs px-2 py-0.5 rounded border ${
            match.risk_level === "HIGH"
              ? "bg-red-50 text-red-700 border-red-200"
              : match.risk_level === "MEDIUM"
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-green-50 text-green-700 border-green-200"
          }`}
        >
          {match.risk_level}
        </span>
        {match.is_geared && (
          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200">
            Geared
          </span>
        )}
        {match.grain_certified && (
          <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded border border-amber-200">
            Grain cert
          </span>
        )}
        {match.dg_certified && (
          <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded border border-purple-200">
            DG cert
          </span>
        )}
        {match.accepts_part_cargo && (
          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
            Part cargo OK
          </span>
        )}
        <span
          className={`text-xs px-2 py-0.5 rounded border ${
            match.scope === "In Scope"
              ? "bg-green-50 text-green-700 border-green-200"
              : match.scope === "Marginal"
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-slate-100 text-slate-600 border-slate-200"
          }`}
        >
          {match.scope}
        </span>
      </div>
    </div>
  );
}

function DetailCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6">
      <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider mb-4 pb-3 border-b border-slate-100">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-start gap-4">
      <p className="text-xs text-slate-500 font-semibold uppercase shrink-0">
        {label}
      </p>
      <p className="text-sm font-semibold text-slate-900 text-right wrap-break-word max-w-[68%] max-[768px]:max-w-[60%]">
        {value}
      </p>
    </div>
  );
}
