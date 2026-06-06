import { notFound } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import {
  ArrowLeft,
  MapPin,
  Package,
  Ship,
  ArrowRight,
  Globe,
  Anchor,
  Calendar,
} from "lucide-react";

import { getPortActivity } from "@/sdk/app/ports";
import { CargoListingRow, ZONE_LABELS, ZoneCode } from "@/lib/schemas/cargo";
import { VesselAvailabilityWithVessel } from "@/lib/schemas/vessel";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

function CargoRow({
  cargo,
  locode,
}: {
  cargo: CargoListingRow;
  locode: string;
}) {
  const isLoad = cargo.load_port_locode === locode;
  const roleLabel = isLoad ? "Load" : "Discharge";
  const roleColor = isLoad
    ? "bg-asb-blue-light text-asb-blue border-asb-blue"
    : "bg-foam-50 text-foam-700 border-foam-200";

  return (
    <div className="flex items-center gap-4 dp-card dp-clickable px-5 py-4 group">
      <div className="w-8 h-8 rounded bg-asb-blue-light border border-asb-gray-200 flex items-center justify-center shrink-0">
        <Package className="w-4 h-4 text-asb-blue" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <Link
            href={`/dashboard/cargo/${cargo.id}`}
            className="text-sm font-bold text-asb-navy truncate hover:text-asb-blue transition-colors"
          >
            {cargo.commodity_name}
          </Link>
          <span
            className={cn(
              "shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide",
              roleColor,
            )}
          >
            {roleLabel}
          </span>
          {cargo.is_dg_cargo && (
            <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200 uppercase">
              DG
            </span>
          )}
        </div>
        <p className="text-xs text-asb-gray-500 truncate">
          <Link
            href={`/dashboard/ports/${cargo.load_port_locode}`}
            className="font-semibold text-asb-ink-soft hover:text-asb-blue hover:underline"
          >
            {cargo.load_port_name}
          </Link>
          <span className="text-asb-gray-400 mx-1.5">→</span>
          <Link
            href={`/dashboard/ports/${cargo.disch_port_locode}`}
            className="font-semibold text-asb-ink-soft hover:text-asb-blue hover:underline"
          >
            {cargo.disch_port_name}
          </Link>
          <span className="mx-1.5 text-asb-gray-400">·</span>
          {cargo.qty_min_mt.toLocaleString()}–
          {cargo.qty_max_mt.toLocaleString()} MT
          {cargo.stowage_factor && (
            <>
              <span className="mx-1.5 text-asb-gray-400">·</span>
              SF {cargo.stowage_factor} m³/t
            </>
          )}
        </p>
        <p className="text-xs text-asb-gray-400 mt-0.5">
          {cargo.is_spot
            ? "SPOT"
            : `Laycan: ${fmt(cargo.laycan_from)} – ${fmt(cargo.laycan_to)}`}
          {cargo.freight_idea_usd_mt && (
            <span className="ml-2 font-semibold text-asb-gray-700">
              ${cargo.freight_idea_usd_mt}/MT
            </span>
          )}
        </p>
      </div>
      <Link
        href={`/dashboard/cargo/${cargo.id}`}
        className="text-asb-gray-400 group-hover:text-asb-blue shrink-0 transition-colors"
        aria-label="View cargo details"
      >
        <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

function VesselRow({ listing }: { listing: VesselAvailabilityWithVessel }) {
  return (
    <div className="flex items-center gap-4 dp-card dp-clickable px-5 py-4 group">
      <div className="w-8 h-8 rounded bg-foam-50 border border-foam-100 flex items-center justify-center shrink-0">
        <Ship className="w-4 h-4 text-foam-600" />
      </div>
      <div className="flex-1 min-w-0">
        <Link
          href={`/dashboard/vessels/${listing.vessel_id}/availability/${listing.id}`}
          className="text-sm font-bold text-asb-navy truncate hover:text-asb-blue transition-colors"
        >
          {listing.vessel.vessel_name}
        </Link>
        <p className="text-xs text-asb-gray-500 truncate mt-0.5">
          {listing.vessel.vessel_type}
          {listing.vessel.dwt_grain &&
            ` · ${listing.vessel.dwt_grain.toLocaleString()} DWT`}
          {listing.vessel.build_year && ` · Built ${listing.vessel.build_year}`}
          {listing.vessel.flag && ` · ${listing.vessel.flag}`}
        </p>
        <p className="text-xs text-asb-gray-400 mt-0.5 flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          Open: {listing.open_date ? fmt(listing.open_date) : "SPOT / prompt"}
          {listing.freight_idea_usd_mt && (
            <span className="ml-2 font-semibold text-asb-gray-700">
              ${listing.freight_idea_usd_mt}/MT idea
            </span>
          )}
        </p>
      </div>
      <Link
        href={`/dashboard/vessels/${listing.vessel_id}/availability/${listing.id}`}
        className="text-asb-gray-400 group-hover:text-asb-blue shrink-0 transition-colors"
        aria-label="View availability details"
      >
        <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  empty,
  children,
}: {
  icon: React.ElementType;
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-asb-gray-400" />
        <h2 className="text-sm font-bold text-asb-ink-soft uppercase tracking-wider">
          {title}
        </h2>
        <span className="ml-1 text-xs text-asb-gray-400 font-medium">
          ({count})
        </span>
      </div>
      {count === 0 ? (
        <div className="dp-zone text-center py-12">
          <p className="text-asb-gray-400 text-sm">{empty}</p>
        </div>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  );
}

export default async function PortActivityPage({
  params,
}: {
  params: Promise<{ locode: string }>;
}) {
  const { locode } = await params;

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    },
  );

  const activity = await getPortActivity(supabase, locode.toUpperCase());
  if (!activity) notFound();

  const { port, cargos, vessels } = activity;
  const zoneLabel =
    ZONE_LABELS[port.zone as ZoneCode] ?? port.zone ?? "Unknown zone";

  return (
    <div className="space-y-8 max-w-4xl px-6 py-6 md:px-8">
      <Link
        href="/dashboard/cargo"
        className="inline-flex items-center gap-1.5 text-sm text-asb-gray-500 hover:text-asb-ink transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to marketplace
      </Link>

      <div className="dp-card p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded bg-asb-blue-light border border-asb-gray-200 flex items-center justify-center shrink-0">
            <Anchor className="w-6 h-6 text-asb-blue" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-asb-navy">
                {port.trade_name}
              </h1>
              <span className="text-xs tabular-nums font-bold text-asb-gray-400 bg-asb-gray-100 px-2 py-0.5 rounded">
                {port.locode}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-asb-gray-500 flex-wrap">
              <span className="flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-asb-gray-400" />
                {port.country}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-asb-gray-400" />
                {zoneLabel}
                <span className="text-asb-gray-400 font-mono text-xs ml-1">
                  ({port.zone})
                </span>
              </span>
              {port.port_type && (
                <span className="text-xs font-medium text-asb-gray-400">
                  {port.port_type}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-5 pt-5 border-t border-asb-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-asb-blue-light flex items-center justify-center shrink-0">
              <Package className="w-4 h-4 text-asb-blue" />
            </div>
            <div>
              <p className="text-xl font-black text-asb-navy tabular-nums leading-none">
                {cargos.length}
              </p>
              <p className="text-[11px] text-asb-gray-400 font-semibold uppercase tracking-wider">
                Active cargos
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-foam-50 flex items-center justify-center shrink-0">
              <Ship className="w-4 h-4 text-foam-600" />
            </div>
            <div>
              <p className="text-xl font-black text-asb-navy tabular-nums leading-none">
                {vessels.length}
              </p>
              <p className="text-[11px] text-asb-gray-400 font-semibold uppercase tracking-wider">
                Open vessels
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-asb-gray-500">
          Browse all activity in this zone:
        </span>
        <Link
          href={`/dashboard/cargo?zone=${port.zone}`}
          className="flex items-center gap-1.5 font-semibold text-asb-blue hover:text-asb-blue hover:underline"
        >
          <MapPin className="w-3.5 h-3.5" />
          {zoneLabel} cargos
        </Link>
        <span className="text-asb-gray-400">·</span>
        <Link
          href={`/dashboard/vessels?zone=${port.zone}`}
          className="flex items-center gap-1.5 font-semibold text-asb-blue hover:text-asb-blue hover:underline"
        >
          <Ship className="w-3.5 h-3.5" />
          {zoneLabel} vessels
        </Link>
      </div>

      <Section
        icon={Package}
        title="Active cargo listings"
        count={cargos.length}
        empty="No active cargo listings at this port right now."
      >
        {cargos.map((cargo) => (
          <CargoRow
            key={cargo.id}
            cargo={cargo}
            locode={locode.toUpperCase()}
          />
        ))}
      </Section>

      <Section
        icon={Ship}
        title="Open vessel positions"
        count={vessels.length}
        empty="No vessels currently open at this port."
      >
        {vessels.map((listing) => (
          <VesselRow key={listing.id} listing={listing} />
        ))}
      </Section>
    </div>
  );
}
