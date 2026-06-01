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

import { VesselStatus, ReviewStatus } from "@/lib/schemas/vessel";
import { cn } from "@/lib/utils";
import { normalizeRole } from "@/lib/role";
import { type VesselCardData } from "@/components/vessels/VesselCard";
import { FleetBoard } from "@/components/vessels/FleetBoard";
import { type MapPoint } from "@/components/map/SharedMap";

// Production-shaped availability + joined vessel. Prod has no v_my_vessels and
// no direct vessel ownership — a user's fleet is the distinct vessels behind
// the availability positions they own (listing_ownership).
type MyAvailability = {
  id: string;
  vessel_id: string;
  status: VesselStatus;
  review_status: ReviewStatus;
  open_port_name: string | null;
  open_port_locode: string | null;
  open_zone: string | null;
  open_date: string | null;
  vlsfo_sea_mt_day: number | null;
  vlsfo_port_mt_day: number | null;
  lsmgo_sea_mt_day: number | null;
  lsmgo_port_mt_day: number | null;
  created_at: string;
  vessel: {
    id: string;
    vessel_name: string;
    imo_number: string | null;
    vessel_type: string;
    dwt_grain: number | null;
    build_year: number | null;
    flag: string | null;
    is_geared: boolean | null;
    max_loa_m: number | null;
    max_draft_m: number | null;
    owner_company: string | null;
    manager_company: string | null;
    preferred_zones: string[] | null;
  };
};

const numOrNull = (n: number | null) => (n != null ? String(n) : null);

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
 * One owned availability (+ joined vessel) → the canonical VesselCard.
 * Owner's OWN fleet, so the manager/owner company alias is shown. No personal
 * contact (pic/email/phone/website) is referenced. Prod columns throughout:
 * explicit vlsfo/lsmgo fuel, preferred_zones, no gross_tonnage.
 */
function toCardData(av: MyAvailability): VesselCardData {
  const v = av.vessel;
  const hasPosition = !!av.open_port_name;
  const dir = v.preferred_zones?.length ? v.preferred_zones.join(" / ") : null;
  const viaName = v.manager_company ?? v.owner_company ?? null;
  const viaRole = v.manager_company ? "manager" : v.owner_company ? "owner" : undefined;
  const isOpen = av.status === "OPEN" && av.review_status === "APPROVED";

  return {
    imo: v.imo_number ?? "—",
    name: v.vessel_name,
    flag: v.flag,
    type: v.vessel_type,
    built: v.build_year,
    dwt: v.dwt_grain != null ? v.dwt_grain.toLocaleString() : null,
    grt: null, // prod has no gross_tonnage
    loa: v.max_loa_m != null ? String(v.max_loa_m) : null,
    draft: v.max_draft_m != null ? String(v.max_draft_m) : null,
    gear: v.is_geared == null ? null : v.is_geared ? "Geared" : "Gearless",
    status: isOpen ? "OPEN" : "REVIEW",
    fuel: {
      vs: numOrNull(av.vlsfo_sea_mt_day),
      vp: numOrNull(av.vlsfo_port_mt_day),
      ls: numOrNull(av.lsmgo_sea_mt_day),
      lp: numOrNull(av.lsmgo_port_mt_day),
    },
    matches: hasPosition ? 0 : null,
    position: hasPosition
      ? {
          port: av.open_port_name as string,
          zone: av.open_zone,
          date: fmtOpenDate(av.open_date),
          lyc: laycanDot(av.open_date),
        }
      : null,
    dir,
    via: viaName ? { name: viaName, role: viaRole } : null,
    href: `/dashboard/vessels/${av.vessel_id}`,
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
    .eq("id", user.id)
    .single();

  const role = normalizeRole(appUser?.role);
  const canAccessVesselPages = role === "vessel_owner" || role === "broker";
  if (!canAccessVesselPages) redirect("/dashboard");

  // Prod ownership model: the vessels you manage are the distinct vessels
  // behind the availability positions you own.
  const { data: ownership } = await supabase
    .from("listing_ownership")
    .select("listing_id")
    .eq("owner_user_id", user.id)
    .eq("listing_type", "vessel_availability")
    .eq("is_current", true)
    .eq("role", "primary");

  const ids = (ownership ?? []).map((o: { listing_id: string }) => o.listing_id);

  const listings: MyAvailability[] = [];
  if (ids.length) {
    const { data } = await supabase
      .from("vessel_availability")
      .select(
        `id, vessel_id, status, review_status, open_port_name, open_port_locode, open_zone, open_date, vlsfo_sea_mt_day, vlsfo_port_mt_day, lsmgo_sea_mt_day, lsmgo_port_mt_day, created_at, vessel:vessels ( id, vessel_name, imo_number, vessel_type, dwt_grain, build_year, flag, is_geared, max_loa_m, max_draft_m, owner_company, manager_company, preferred_zones )`,
      )
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (data) listings.push(...(data as unknown as MyAvailability[]));
  }

  // Latest availability per vessel → one fleet card per vessel.
  const availByVessel = new Map<string, MyAvailability>();
  for (const l of listings) {
    if (!availByVessel.has(l.vessel_id)) availByVessel.set(l.vessel_id, l);
  }

  const fleetEntries = [...availByVessel.values()].map((av) => ({
    av,
    data: toCardData(av),
  }));
  const myVessels = fleetEntries.map((e) => ({
    id: e.av.vessel_id,
    vessel_name: e.av.vessel.vessel_name,
  }));
  const quickPostHref = myVessels[0]
    ? `/dashboard/vessels/${myVessels[0].id}/availability/new`
    : "/dashboard/vessels/register";

  // Resolve open-port coordinates for the fleet map.
  const openLocodes = Array.from(
    new Set(
      fleetEntries
        .map((e) => e.av.open_port_locode)
        .filter((x): x is string => !!x),
    ),
  );
  const portCoord = new Map<string, { lat: number; lon: number }>();
  if (openLocodes.length) {
    const { data: portsData } = await supabase
      .from("ports")
      .select("locode, latitude, longitude")
      .in("locode", openLocodes);
    for (const p of (portsData ?? []) as {
      locode: string;
      latitude: number | null;
      longitude: number | null;
    }[]) {
      if (p.latitude != null && p.longitude != null) {
        portCoord.set(p.locode, { lat: Number(p.latitude), lon: Number(p.longitude) });
      }
    }
  }

  const fleetCards = fleetEntries.map((e) => e.data);
  const fleetPoints: MapPoint[] = fleetEntries.flatMap(({ av, data }) => {
    const c = av.open_port_locode ? portCoord.get(av.open_port_locode) : undefined;
    if (!c) return [];
    return [
      {
        id: data.imo,
        name: av.vessel.vessel_name,
        lat: c.lat,
        lon: c.lon,
        kind: "vessel" as const,
        zone: av.open_zone,
      },
    ];
  });

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
            <h1 className="text-2xl font-bold text-asb-navy tracking-tight">
              My Vessels
            </h1>
            <p className="text-sm text-asb-gray-500 mt-0.5">
              {myVessels.length > 0
                ? `${myVessels.length} registered · Open vessel page to post a position`
                : "Register your vessels to start posting positions"}
            </p>
          </div>
          <div className="flex items-center gap-2 max-[768px]:w-full">
            {myVessels.length > 0 && (
              <Link
                href={quickPostHref}
                className="flex items-center gap-2 border border-asb-gray-200 text-asb-ink-soft font-semibold px-4 py-2.5 rounded text-sm hover:border-asb-blue hover:text-asb-blue transition-colors"
              >
                <Plus className="w-4 h-4" /> Post position
              </Link>
            )}
            <Link
              href="/dashboard/vessels/register"
              className="flex items-center gap-2 bg-asb-blue hover:bg-asb-blue text-white font-semibold px-4 py-2.5 rounded text-sm transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" /> Register vessel
            </Link>
          </div>
        </div>

        {myVessels.length === 0 ? (
          <div className="text-center py-20 bg-white rounded border border-dashed border-asb-gray-200">
            <div className="w-16 h-16 bg-asb-blue-light rounded flex items-center justify-center mx-auto mb-4">
              <Ship className="w-8 h-8 text-asb-blue" />
            </div>
            <p className="text-asb-ink-soft font-semibold text-base">
              No vessels registered yet
            </p>
            <p className="text-asb-gray-400 text-sm mt-1.5 max-w-xs mx-auto">
              Add your vessel to the register, then post its operational
              positions.
            </p>
            <Link
              href="/dashboard/vessels/register"
              className="mt-5 inline-flex items-center gap-2 bg-asb-blue text-white font-semibold px-5 py-2.5 rounded text-sm hover:bg-asb-blue transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" /> Register your first vessel
            </Link>
          </div>
        ) : (
          <FleetBoard
            vessels={fleetCards}
            points={fleetPoints}
          />
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-6 max-[768px]:flex-col max-[768px]:items-start max-[768px]:gap-3">
          <div>
            <h2 className="text-xl font-bold text-asb-navy tracking-tight">
              Open Positions
            </h2>
            <p className="text-sm text-asb-gray-500 mt-0.5">
              {listings.length} total · {groups.open.length} open ·{" "}
              {groups.pending.length} under review
            </p>
          </div>
          {myVessels.length > 0 && (
            <Link
              href={quickPostHref}
              className="flex items-center gap-2 border border-asb-gray-200 text-asb-ink-soft font-semibold px-4 py-2.5 rounded text-sm hover:border-asb-blue hover:text-asb-blue transition-colors max-[768px]:w-full max-[768px]:justify-center"
            >
              <Plus className="w-4 h-4" /> Post position
            </Link>
          )}
        </div>

        {listings.length === 0 ? (
          <div className="text-center py-16 bg-white rounded border border-dashed border-asb-gray-200">
            <Anchor className="w-10 h-10 text-asb-gray-400 mx-auto mb-3" />
            <p className="text-asb-gray-500 font-semibold">No open positions</p>
            {myVessels.length > 0 ? (
              <>
                <p className="text-asb-gray-400 text-sm mt-1">
                  Go to a vessel&apos;s page and post a position to get started.
                </p>
                <div className="mt-4 flex gap-3 justify-center flex-wrap">
                  {myVessels.slice(0, 3).map((v) => (
                    <Link
                      key={v.id}
                      href={`/dashboard/vessels/${v.id}`}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-asb-blue hover:text-asb-blue px-3 py-1.5 rounded-lg border border-asb-blue hover:border-asb-blue transition-colors"
                    >
                      <Ship className="w-3.5 h-3.5" />
                      {v.vessel_name}
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-asb-gray-400 text-sm mt-1">
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
  listings: MyAvailability[];
}) {
  return (
    <div>
      <h3 className="text-xs font-bold text-asb-gray-400 uppercase tracking-widest mb-4">
        {title}{" "}
        <span className="ml-1 text-asb-gray-400 font-normal normal-case">
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

function PositionRow({ listing }: { listing: MyAvailability }) {
  const ReviewIcon = REVIEW_ICONS[listing.review_status];
  const isPending = listing.review_status === "PENDING";

  const urgency = getDateUrgency(listing.open_date);
  const UrgencyIcon = urgency.icon;

  return (
    <Link
      href={`/dashboard/vessels/${listing.vessel_id}/availability/${listing.id}`}
      className="group bg-white border border-asb-gray-200 rounded p-5 hover:border-asb-blue hover:shadow-md transition-all flex flex-col gap-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded bg-asb-blue-light border border-asb-gray-200 flex items-center justify-center shrink-0 mt-0.5">
            <Ship className="w-4 h-4 text-asb-blue" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-asb-navy group-hover:text-asb-blue transition-colors truncate">
              {listing.vessel.vessel_name}
            </p>
            <p className="text-xs text-asb-gray-400 truncate mt-0.5">
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
          <span className="shrink-0 text-xs font-semibold text-asb-gray-500">
            {STATUS_LABELS[listing.status]}
          </span>
        )}
      </div>

      {/* Open port */}
      {listing.open_port_name && (
        <div className="flex items-center gap-1.5 text-xs text-asb-gray-700 bg-asb-gray-50 rounded px-3 py-2 border border-asb-gray-100">
          <MapPin className="w-3.5 h-3.5 text-asb-gray-400 shrink-0" />
          <span className="font-semibold text-asb-ink-soft truncate">
            {listing.open_port_name}
            {listing.open_zone ? ` (${listing.open_zone})` : ""}
          </span>
        </div>
      )}

      {/* Open date */}
      {listing.open_date && (
        <div
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded border",
            urgency.color
              ? "bg-amber-50 border-amber-100"
              : "bg-asb-gray-50 border-asb-gray-100",
            urgency.color || "text-asb-gray-700",
          )}
        >
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span>{listing.open_date}</span>
          {UrgencyIcon && <UrgencyIcon className="w-3 h-3 ml-auto" />}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-asb-gray-100 mt-auto">
        <div className={cn("flex items-center gap-1.5", REVIEW_COLORS[listing.review_status])}>
          <ReviewIcon className="w-3.5 h-3.5" />
          <span className="text-[11px] font-semibold">
            {listing.review_status === "PENDING" ? "Pending Review" : listing.review_status}
          </span>
        </div>
        <ArrowRight className="w-4 h-4 text-asb-gray-400 group-hover:text-asb-blue group-hover:translate-x-0.5 transition-all" />
      </div>
    </Link>
  );
}
