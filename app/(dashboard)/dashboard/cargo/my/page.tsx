import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  Package,
  ArrowRight,
  MapPin,
  Weight,
  Calendar,
  Tag,
  Anchor,
} from "lucide-react";

import {
  CargoListingRow,
  CargoStatus,
  ReviewStatus,
} from "@/lib/schemas/cargo";
import { ProfileGuard } from "@/components/ProfileGuard";
import { cn } from "@/lib/utils";

export default async function MyCargoListingsPage() {
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

  // Get IDs of listings this user owns as primary
  const { data: ownership } = await supabase
    .from("listing_ownership")
    .select("listing_id")
    .eq("owner_user_id", user.id)
    .eq("listing_type", "cargo")
    .eq("is_current", true)
    .eq("role", "primary");

  const ids = (ownership ?? []).map(
    (o: { listing_id: string }) => o.listing_id,
  );

  const listings: CargoListingRow[] = [];
  if (ids.length) {
    const { data } = await supabase
      .from("cargo_listings")
      .select("*")
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (data) listings.push(...(data as CargoListingRow[]));
  }

  const groups = {
    pending: listings.filter((l) => l.review_status === "PENDING"),
    live: listings.filter(
      (l) => l.review_status === "APPROVED" && l.status === "IN",
    ),
    other: listings.filter(
      (l) =>
        l.status === "CLOSED" ||
        l.status === "PARTIAL" ||
        l.status === "OUT" ||
        (l.review_status !== "PENDING" && l.review_status !== "APPROVED"),
    ),
  };

  return (
    <ProfileGuard requires="cargo">
      <div className="space-y-8 py-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-asb-navy">
              My Cargo Listings
            </h1>
            <p className="text-sm text-asb-gray-500 mt-1">
              {listings.length} total · {groups.live.length} live ·{" "}
              {groups.pending.length} pending
            </p>
          </div>
          <Link
            href="/dashboard/cargo/create"
            className="flex items-center gap-2 bg-asb-blue hover:bg-asb-blue text-white font-semibold px-4 py-2.5 rounded text-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> New listing
          </Link>
        </div>

        {listings.length === 0 ? (
          <div className="text-center py-20 bg-white rounded border border-dashed border-asb-gray-200">
            <Package className="w-10 h-10 text-asb-gray-400 mx-auto mb-3" />
            <p className="text-asb-gray-500 font-semibold">No listings yet</p>
            <p className="text-asb-gray-400 text-sm mt-1">
              Post your first cargo to get started.
            </p>
            <Link
              href="/dashboard/cargo/create"
              className="mt-4 inline-flex items-center gap-2 bg-asb-blue text-white font-semibold px-5 py-2.5 rounded text-sm hover:bg-asb-blue transition-colors"
            >
              <Plus className="w-4 h-4" /> Post cargo
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            {groups.pending.length > 0 && (
              <Section
                title="Pending Review"
                count={groups.pending.length}
                listings={groups.pending}
              />
            )}
            {groups.live.length > 0 && (
              <Section
                title="Live"
                count={groups.live.length}
                listings={groups.live}
              />
            )}
            {groups.other.length > 0 && (
              <Section
                title="Closed / Other"
                count={groups.other.length}
                listings={groups.other}
              />
            )}
          </div>
        )}
      </div>
    </ProfileGuard>
  );
}

function Section({
  title,
  count,
  listings,
}: {
  title: string;
  count: number;
  listings: CargoListingRow[];
}) {
  return (
    <div>
      <h2 className="text-sm font-bold text-asb-gray-500 uppercase tracking-wider mb-4">
        {title}{" "}
        <span className="ml-1 text-asb-gray-400 font-normal normal-case">
          ({count})
        </span>
      </h2>
      <div className="grid grid-cols-3 max-[1024px]:grid-cols-2 max-[640px]:grid-cols-1 gap-4">
        {listings.map((l) => (
          <CargoCard key={l.id} listing={l} />
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

const REVIEW_BG: Record<ReviewStatus, string> = {
  PENDING: "bg-amber-50 border-amber-200",
  APPROVED: "bg-green-50 border-green-200",
  REJECTED: "bg-red-50 border-red-200",
  FLAGGED: "bg-red-50 border-red-200",
};

const REVIEW_LABEL: Record<ReviewStatus, string> = {
  PENDING: "Pending Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  FLAGGED: "Flagged",
};

const STATUS_LABELS: Record<CargoStatus, string> = {
  IN: "Active",
  PARTIAL: "Partial",
  OUT: "Out of scope",
  CLOSED: "Closed",
};

const STATUS_COLORS: Record<CargoStatus, string> = {
  IN: "text-green-700 bg-green-50 border-green-200",
  PARTIAL: "text-amber-700 bg-amber-50 border-amber-200",
  OUT: "text-asb-gray-500 bg-asb-gray-50 border-asb-gray-200",
  CLOSED: "text-asb-gray-400 bg-asb-gray-50 border-asb-gray-100",
};

function CargoCard({ listing }: { listing: CargoListingRow }) {
  const ReviewIcon = REVIEW_ICONS[listing.review_status];

  return (
    <Link
      href={`/dashboard/cargo/${listing.id}`}
      className="group bg-white border border-asb-gray-200 rounded p-5 hover:border-asb-blue hover:shadow-md transition-all flex flex-col gap-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded bg-asb-blue-light border border-asb-gray-200 flex items-center justify-center shrink-0 mt-0.5">
            <Package className="w-4 h-4 text-asb-blue" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-asb-navy group-hover:text-asb-blue transition-colors truncate">
              {listing.commodity_name}
            </p>
            <p className="text-xs text-asb-gray-400 mt-0.5 capitalize">
              {listing.cargo_type ?? "Cargo"}
            </p>
          </div>
        </div>
        {/* Status badge */}
        <span
          className={cn(
            "shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-lg border uppercase tracking-wide",
            STATUS_COLORS[listing.status],
          )}
        >
          {STATUS_LABELS[listing.status]}
        </span>
      </div>

      {/* Route */}
      <div className="flex items-center gap-1.5 text-xs text-asb-gray-700 bg-asb-gray-50 rounded px-3 py-2 border border-asb-gray-100">
        <MapPin className="w-3.5 h-3.5 text-asb-gray-400 shrink-0" />
        <span className="font-semibold text-asb-ink-soft truncate">
          {listing.load_port_name}
        </span>
        <ArrowRight className="w-3 h-3 text-asb-gray-400 shrink-0" />
        <span className="font-semibold text-asb-ink-soft truncate">
          {listing.disch_port_name}
        </span>
      </div>

      {/* Data pills */}
      <div className="grid grid-cols-2 gap-2">
        <DataPill
          icon={Weight}
          label="Quantity"
          value={`${listing.qty_min_mt.toLocaleString()}–${listing.qty_max_mt.toLocaleString()} MT`}
        />
        <DataPill
          icon={Calendar}
          label="Laycan"
          value={listing.is_spot ? "SPOT" : (listing.laycan_from ?? "—")}
        />
        {listing.freight_idea_usd_mt != null && (
          <DataPill
            icon={Anchor}
            label="Freight Idea"
            value={`$${listing.freight_idea_usd_mt}/MT`}
          />
        )}
        {listing.ref && (
          <DataPill icon={Tag} label="Ref" value={listing.ref} />
        )}
      </div>

      {/* Footer */}
      <div
        className={cn(
          "flex items-center justify-between pt-3 border-t border-asb-gray-100 mt-auto",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border",
            REVIEW_BG[listing.review_status],
            REVIEW_COLORS[listing.review_status],
          )}
        >
          <ReviewIcon className="w-3 h-3" />
          {REVIEW_LABEL[listing.review_status]}
        </div>
        <ArrowRight className="w-4 h-4 text-asb-gray-400 group-hover:text-asb-blue group-hover:translate-x-0.5 transition-all" />
      </div>
    </Link>
  );
}

function DataPill({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-asb-gray-50 rounded-lg px-2.5 py-2 border border-asb-gray-100">
      <p className="text-[10px] text-asb-gray-400 font-semibold uppercase tracking-wide mb-0.5">
        {label}
      </p>
      <div className="flex items-center gap-1">
        <Icon className="w-3 h-3 text-asb-gray-400 shrink-0" />
        <p className="text-xs font-bold text-asb-ink-soft truncate">{value}</p>
      </div>
    </div>
  );
}
