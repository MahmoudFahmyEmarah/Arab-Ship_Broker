import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { Plus, Search, Ship } from "lucide-react";

import type { VesselRow } from "@/lib/schemas/vessel";
import { type VesselCardData } from "@/components/vessels/VesselCard";
import { FleetBoard } from "@/components/vessels/FleetBoard";
import { type MapPoint } from "@/components/map/SharedMap";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type BrowseVessel = Pick<
  VesselRow,
  | "id"
  | "vessel_name"
  | "imo_number"
  | "vessel_type"
  | "dwt_grain"
  | "gross_tonnage"
  | "build_year"
  | "flag"
  | "max_loa_m"
  | "max_draft_m"
  | "is_geared"
  | "is_sanctioned"
>;

/**
 * Tonnage Market is the public marketplace view → counterparty identity is
 * masked (the canonical VesselCard shows "Identity available to Tier 3 &
 * Partner"). Only non-PII vessel particulars are selected; no owner/manager
 * company or contact columns are queried.
 */
/** Latest circulated open position for a vessel (RLS permits non-owners to
 *  read APPROVED + OPEN + for_circulation rows only). Fuel consumption lives
 *  on the availability row, so the fuel block is sourced here. */
type OpenPosition = {
  vessel_id: string;
  open_port_name: string | null;
  open_port_locode: string | null;
  open_zone: string | null;
  open_date: string | null;
  me_consumption_mt_day: number | null;
  me_consumption_port_mt_day: number | null;
  aux_consumption_mt_day: number | null;
  aux_consumption_port_mt_day: number | null;
};

const numOrNull = (n: number | null) => (n != null ? String(n) : null);

function laycanDot(openDate: string | null): "green" | "amber" | "red" {
  if (!openDate) return "green";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((new Date(openDate).getTime() - today.getTime()) / 86_400_000);
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

function toCardData(v: BrowseVessel, pos: OpenPosition | undefined): VesselCardData {
  const hasPosition = !!pos?.open_port_name;
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
    status: "OPEN",
    fuel: pos
      ? {
          vs: numOrNull(pos.me_consumption_mt_day),
          vp: numOrNull(pos.me_consumption_port_mt_day),
          ls: numOrNull(pos.aux_consumption_mt_day),
          lp: numOrNull(pos.aux_consumption_port_mt_day),
        }
      : null,
    matches: hasPosition ? 0 : null,
    position: hasPosition
      ? {
          port: pos!.open_port_name as string,
          zone: pos!.open_zone,
          date: fmtOpenDate(pos!.open_date),
          lyc: laycanDot(pos!.open_date),
        }
      : null,
    href: `/dashboard/vessels/${v.id}`,
  };
}

export default async function BrowseVesselsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const rawQ = typeof params.q === "string" ? params.q : "";
  const q = rawQ.trim().slice(0, 60);
  const searchTerm = q.replace(/[,%_]/g, " ");

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

  const canUseVesselPages =
    appUser?.role === "cargo_owner" ||
    appUser?.role === "vessel_owner" ||
    appUser?.role === "broker" ||
    appUser?.role === "admin";

  if (!canUseVesselPages) redirect("/dashboard");

  let vesselsQuery = supabase
    .from("vessels")
    .select(
      "id, vessel_name, imo_number, vessel_type, dwt_grain, gross_tonnage, build_year, flag, max_loa_m, max_draft_m, is_geared, is_sanctioned",
    )
    .eq("is_sanctioned", false)
    .order("vessel_name", { ascending: true })
    .limit(120);

  if (searchTerm.length >= 2) {
    vesselsQuery = vesselsQuery.or(
      `vessel_name.ilike.%${searchTerm}%,imo_number.ilike.%${searchTerm}%`,
    );
  }

  const { data: vesselsData } = await vesselsQuery;
  const vessels = (vesselsData ?? []) as BrowseVessel[];

  // Enrich with each vessel's latest circulated open position (fuel + open
  // port). RLS limits this to APPROVED + OPEN + for_circulation rows, so only
  // tonnage genuinely in circulation is shown; identity stays masked.
  const posByVessel = new Map<string, OpenPosition>();
  if (vessels.length) {
    const { data: posData } = await supabase
      .from("vessel_availability")
      .select(
        "vessel_id, open_port_name, open_port_locode, open_zone, open_date, me_consumption_mt_day, me_consumption_port_mt_day, aux_consumption_mt_day, aux_consumption_port_mt_day, created_at",
      )
      .in("vessel_id", vessels.map((v) => v.id))
      .eq("status", "OPEN")
      .eq("review_status", "APPROVED")
      .order("created_at", { ascending: false });
    for (const p of (posData ?? []) as (OpenPosition & { created_at: string })[]) {
      if (!posByVessel.has(p.vessel_id)) posByVessel.set(p.vessel_id, p);
    }
  }

  // Resolve open-port coordinates for the market map.
  const locodes = Array.from(
    new Set(
      [...posByVessel.values()]
        .map((p) => p.open_port_locode)
        .filter((x): x is string => !!x),
    ),
  );
  const portCoord = new Map<string, { lat: number; lon: number }>();
  if (locodes.length) {
    const { data: portsData } = await supabase
      .from("ports")
      .select("locode, latitude, longitude")
      .in("locode", locodes);
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

  const cards = vessels.map((v) => toCardData(v, posByVessel.get(v.id)));
  const points: MapPoint[] = vessels.flatMap((v) => {
    const pos = posByVessel.get(v.id);
    const c = pos?.open_port_locode ? portCoord.get(pos.open_port_locode) : undefined;
    if (!c) return [];
    return [
      {
        id: v.imo_number ?? "—",
        name: v.vessel_name,
        lat: c.lat,
        lon: c.lon,
        kind: "vessel" as const,
        zone: pos?.open_zone ?? null,
      },
    ];
  });

  return (
    <div className="space-y-6 py-2">
      <div className="flex flex-row items-center justify-between gap-4 max-[768px]:flex-col max-[768px]:items-start">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Browse Vessels</h1>
          <p className="mt-1 text-sm text-slate-500">
            {vessels.length} vessel{vessels.length !== 1 ? "s" : ""}
            {searchTerm.length >= 2 ? ` found for "${q}"` : " in register"}
          </p>
        </div>
        {(appUser?.role === "vessel_owner" || appUser?.role === "broker") && (
          <Link
            href="/dashboard/vessels/register"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-ocean-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ocean-700"
          >
            <Plus className="h-4 w-4" /> Register vessel
          </Link>
        )}
      </div>

      <form
        action="/dashboard/vessels/browse"
        method="get"
        className="flex flex-row gap-2 max-[768px]:flex-col"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search by vessel name or IMO"
            className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-ocean-500"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-ocean-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-ocean-700"
          >
            Search
          </button>
          {q && (
            <Link
              href="/dashboard/vessels/browse"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-800"
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      {vessels.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <Ship className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="font-semibold text-slate-500">No vessels found</p>
          <p className="mt-1 text-sm text-slate-400">
            Try a different vessel name or IMO number.
          </p>
        </div>
      ) : (
        <FleetBoard vessels={cards} points={points} masked />
      )}
    </div>
  );
}
