import { Suspense } from "react";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  Plus,
  Package,
  ShieldAlert,
  Zap,
  BarChart3,
  Layers,
  Clock,
  ShieldCheck,
  Infinity as InfinityIcon,
} from "lucide-react";

import { CargoBoard } from "@/components/cargo/CargoBoard";
import { type MapPoint } from "@/components/map/SharedMap";
import { CargoFilterBar } from "@/components/cargo/CargoFilterBar";
import { CargoFilterTransitionProvider } from "@/components/cargo/CargoFilterTransitionProvider";
import { CargoResultsShell } from "@/components/cargo/CargoResultsShell";
import { getCargos } from "@/sdk/app/cargos";
import {
  CargoListingFilters,
  CargoListingRow,
  ZoneCode,
  CargoType,
} from "@/lib/schemas/cargo";
import { getTemporalAccess } from "@/lib/temporal";

interface MarketStats {
  total: number;
  dryBulk: number;
  breakBulk: number;
  spot: number;
  dg: number;
}

function computeStats(listings: CargoListingRow[]): MarketStats {
  return {
    total: listings.length,
    dryBulk: listings.filter((l) => l.cargo_type === "Dry Bulk").length,
    breakBulk: listings.filter((l) => l.cargo_type === "Break Bulk").length,
    spot: listings.filter((l) => l.is_spot).length,
    dg: listings.filter((l) => l.is_dg_cargo).length,
  };
}

function StatItem({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 flex-1 min-w-27.5">
      <div
        className={cn(
          "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
          accent ?? "bg-ocean-50",
        )}
      >
        <Icon
          className={cn("w-4 h-4", accent ? "text-white" : "text-ocean-600")}
        />
      </div>
      <div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-none mb-0.5">
          {label}
        </p>
        <p className="text-xl font-black text-slate-900 leading-none tabular-nums">
          {value}
        </p>
      </div>
    </div>
  );
}

function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

function StatsBar({ stats }: { stats: MarketStats }) {
  return (
    <div className="w-full bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex flex-wrap divide-x divide-slate-100">
        <StatItem
          icon={BarChart3}
          label="Active listings"
          value={stats.total}
        />
        <StatItem icon={Layers} label="Dry bulk" value={stats.dryBulk} />
        <StatItem icon={Package} label="Break bulk" value={stats.breakBulk} />
        <StatItem icon={Zap} label="Spot" value={stats.spot} />
        <StatItem
          icon={ShieldAlert}
          label="DG cargo"
          value={stats.dg}
          accent={stats.dg > 0 ? "bg-red-500" : undefined}
        />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="col-span-4 text-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
      <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
      <p className="text-slate-500 font-semibold">
        No active listings match your filters.
      </p>
      <Link
        href="/dashboard/cargo"
        className="mt-3 inline-block text-ocean-600 hover:underline font-bold text-sm"
      >
        Clear all filters
      </Link>
    </div>
  );
}

function TemporalAccessBanner({
  archiveLabel,
  isAdmin,
}: {
  archiveLabel: string;
  isAdmin: boolean;
}) {
  if (isAdmin) {
    return (
      <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3">
        <div className="w-7 h-7 rounded-lg bg-slate-200 flex items-center justify-center shrink-0">
          <InfinityIcon className="w-3.5 h-3.5 text-slate-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-600">
            Admin — unlimited archive access
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            All historical listings are visible across all three temporal layers.
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
          <span className="bg-ocean-50 text-ocean-600 border border-ocean-100 rounded-full px-2 py-0.5">Layer 1 — Future</span>
          <span className="bg-amber-50 text-amber-600 border border-amber-100 rounded-full px-2 py-0.5">Layer 2 — ≤ 7 days</span>
          <span className="bg-slate-100 text-slate-500 border border-slate-200 rounded-full px-2 py-0.5">Layer 3 — Archive ∞</span>
        </div>
      </div>
    );
  }

  const isVerified = archiveLabel.includes("3 month");

  return (
    <div
      className={cn(
        "flex items-center gap-3 border rounded-2xl px-5 py-3",
        isVerified
          ? "bg-emerald-50 border-emerald-200/80"
          : "bg-blue-50 border-blue-200/80",
      )}
    >
      <div
        className={cn(
          "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
          isVerified ? "bg-emerald-100" : "bg-blue-100",
        )}
      >
        {isVerified ? (
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
        ) : (
          <Clock className="w-3.5 h-3.5 text-blue-600" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-xs font-semibold",
            isVerified ? "text-emerald-800" : "text-blue-800",
          )}
        >
          {isVerified ? "Verified account" : "Standard access"} — {archiveLabel}
        </p>
        <p
          className={cn(
            "text-[11px] mt-0.5",
            isVerified ? "text-emerald-600/80" : "text-blue-600/80",
          )}
        >
          {isVerified
            ? "You can browse cargo listings up to 3 months back."
            : "You can browse cargo listings up to 1 month back. Verify your account for 3-month access."}
        </p>
      </div>
      <div className="hidden sm:flex items-center gap-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
        <span className="bg-ocean-50 text-ocean-600 border border-ocean-100 rounded-full px-2 py-0.5">Layer 1 — Future</span>
        <span className="bg-amber-50 text-amber-600 border border-amber-100 rounded-full px-2 py-0.5">Layer 2 — ≤ 7 days</span>
        <span
          className={cn(
            "border rounded-full px-2 py-0.5",
            isVerified
              ? "bg-emerald-50 text-emerald-600 border-emerald-100"
              : "bg-blue-50 text-blue-600 border-blue-100",
          )}
        >
          Layer 3 — {archiveLabel}
        </span>
      </div>
    </div>
  );
}

export default async function BrowseCargoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const params = await searchParams;

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: appUser } = user
    ? await supabase
        .from("users")
        .select("role, trust_tier")
        .eq("supabase_user_id", user.id)
        .single()
    : { data: null };

  const role = appUser?.role ?? "cargo_owner";
  const trustTier = appUser?.trust_tier ?? "NEW";
  const { archiveCutoff, archiveLabel } = getTemporalAccess(role, trustTier);
  const isAdmin = role === "admin";

  const filters: CargoListingFilters = {
    zone: (params.zone as ZoneCode) || null,
    cargo_type: (params.cargo_type as CargoType) || null,
    min_qty: params.min_qty ? Number(params.min_qty) : null,
    max_qty: params.max_qty ? Number(params.max_qty) : null,
    is_dg_only: params.is_dg_only === "true",
    laycan_from: (params.laycan_from as string) || null,
    laycan_to: (params.laycan_to as string) || null,
    sort: (params.sort as CargoListingFilters["sort"]) || "newest",
    archiveCutoff,
  };

  const cargos = await getCargos(supabase, filters);
  const stats = computeStats(cargos);

  // Resolve load-port coordinates for the market map.
  const cargoLocodes = Array.from(
    new Set(cargos.map((c) => c.load_port_locode).filter((x): x is string => !!x)),
  );
  const portCoord = new Map<string, { lat: number; lon: number }>();
  if (cargoLocodes.length) {
    const { data: portsData } = await supabase
      .from("ports")
      .select("locode, latitude, longitude")
      .in("locode", cargoLocodes);
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
  const scopeOf = (s: string): "in" | "partial" | "out" =>
    s === "PARTIAL" ? "partial" : s === "OUT" || s === "CLOSED" ? "out" : "in";
  const cargoPoints: MapPoint[] = cargos.flatMap((c) => {
    const coord = c.load_port_locode ? portCoord.get(c.load_port_locode) : undefined;
    if (!coord) return [];
    return [
      {
        id: c.id,
        name: c.commodity_name,
        lat: coord.lat,
        lon: coord.lon,
        kind: "cargo" as const,
        scope: scopeOf(c.status),
        zone: c.load_zone,
      },
    ];
  });

  return (
    <div className="space-y-4 py-2">
      <div className="flex flex-row justify-between items-center gap-4 max-[768px]:flex-col max-[768px]:items-start">
        <div>
          <h1 className="text-2xl font-bold text-ocean-900">
            Cargo Marketplace
          </h1>
          <p className="text-slate-500 mt-0.5 text-sm">
            {cargos.length} active listing{cargos.length !== 1 ? "s" : ""}
            {Object.values(filters).some(
              (v) => v !== null && v !== undefined && v !== false && v !== "",
            )
              ? " — filters applied"
              : ""}
          </p>
        </div>
        <Link
          href="/dashboard/cargo/create"
          className="flex-none max-[768px]:w-full flex items-center justify-center gap-2 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold px-5 py-2.5 rounded-xl shadow-sm transition-colors text-sm"
        >
          <Plus className="w-4 h-4" /> Post Cargo
        </Link>
      </div>

      <TemporalAccessBanner archiveLabel={archiveLabel} isAdmin={isAdmin} />

      <StatsBar stats={stats} />

      <CargoFilterTransitionProvider>
        <Suspense fallback={null}>
          <CargoFilterBar />
        </Suspense>

        <CargoResultsShell>
          {cargos.length === 0 ? (
            <div className="grid grid-cols-4">
              <EmptyState />
            </div>
          ) : (
            <CargoBoard cargos={cargos} points={cargoPoints} />
          )}
        </CargoResultsShell>
      </CargoFilterTransitionProvider>
    </div>
  );
}
