import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { ArrowRight, Plus, Search, Ship } from "lucide-react";

import type { VesselRow } from "@/lib/schemas/vessel";
import { cn } from "@/lib/utils";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type BrowseVessel = Pick<
  VesselRow,
  | "id"
  | "vessel_name"
  | "imo_number"
  | "vessel_type"
  | "dwt_grain"
  | "build_year"
  | "flag"
  | "risk_level"
  | "scope"
  | "is_geared"
  | "is_sanctioned"
>;

const RISK_STYLE: Record<string, string> = {
  CLEAR: "bg-green-50 text-green-700 border-green-200",
  LOW: "bg-green-50 text-green-700 border-green-200",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
  HIGH: "bg-red-50 text-red-700 border-red-200",
};

const SCOPE_STYLE: Record<string, string> = {
  "In Scope": "bg-green-50 text-green-700 border-green-200",
  Marginal: "bg-amber-50 text-amber-700 border-amber-200",
  "Out of Scope": "bg-slate-100 text-slate-600 border-slate-200",
};

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
      "id, vessel_name, imo_number, vessel_type, dwt_grain, build_year, flag, risk_level, scope, is_geared, is_sanctioned",
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
        <div className="grid grid-cols-3 max-[1024px]:grid-cols-2 max-[768px]:grid-cols-1 gap-4">
          {vessels.map((v) => (
            <Link
              key={v.id}
              href={`/dashboard/vessels/${v.id}`}
              className="group rounded-2xl border border-slate-200 bg-white p-5 transition-all hover:border-ocean-300 hover:shadow-sm"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900 transition-colors group-hover:text-ocean-700">
                    {v.vessel_name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {v.vessel_type}
                    {v.imo_number && ` · IMO ${v.imo_number}`}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-lg border px-2 py-0.5 text-xs font-bold",
                    RISK_STYLE[v.risk_level] ??
                      "bg-slate-100 text-slate-600 border-slate-200",
                  )}
                >
                  {v.risk_level}
                </span>
              </div>

              <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5">
                  <p className="mb-0.5 font-semibold text-slate-400">DWT</p>
                  <p className="font-bold text-slate-700">
                    {v.dwt_grain ? `${v.dwt_grain.toLocaleString()} MT` : "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5">
                  <p className="mb-0.5 font-semibold text-slate-400">Built</p>
                  <p className="font-bold text-slate-700">
                    {v.build_year ?? "—"}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-xs font-semibold",
                    SCOPE_STYLE[v.scope] ??
                      "bg-slate-100 text-slate-600 border-slate-200",
                  )}
                >
                  {v.scope}
                </span>
                <ArrowRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-ocean-500" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
