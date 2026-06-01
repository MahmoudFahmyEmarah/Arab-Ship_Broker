import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  Plus,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Package,
  Ship,
  TrendingUp,
  Zap,
  ArrowUpRight,
  Star,
} from "lucide-react";

type TrustTier = "NEW" | "VERIFIED" | "FLAGGED";

interface CargoStats {
  total: number;
  pending: number;
  live: number;
  closed: number;
}

interface VesselStats {
  total: number;
  pending: number;
  open: number;
  fixed: number;
}

export default async function DashboardPage() {
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
  if (!user) redirect("/auth/login");

  const { data: appUser } = await supabase
    .from("users")
    .select(
      "id, full_name, role, trust_tier, clean_posts, strike_count, is_active",
    )
    .eq("supabase_user_id", user.id)
    .single();

  if (!appUser) redirect("/auth/login");
  if (!appUser.is_active) redirect("/auth/login?error=account_suspended");

  const role = appUser.role as string;
  const showCargo = role === "cargo_owner" || role === "broker";
  const showVessel = role === "vessel_owner" || role === "broker";
  const tier = appUser.trust_tier as TrustTier;

  const cargoStats: CargoStats = { total: 0, pending: 0, live: 0, closed: 0 };
  if (showCargo) {
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
    const { data: listings } = ids.length
      ? await supabase
          .from("cargo_listings")
          .select("status, review_status")
          .in("id", ids)
      : { data: [] };

    cargoStats.total = listings?.length ?? 0;
    cargoStats.pending =
      listings?.filter(
        (l: { review_status: string }) => l.review_status === "PENDING",
      ).length ?? 0;
    cargoStats.live =
      listings?.filter(
        (l: { status: string; review_status: string }) =>
          l.review_status === "APPROVED" &&
          (l.status === "IN" || l.status === "PARTIAL"),
      ).length ?? 0;
    cargoStats.closed =
      listings?.filter((l: { status: string }) => l.status === "CLOSED")
        .length ?? 0;
  }

  const vesselStats: VesselStats = {
    total: 0,
    pending: 0,
    open: 0,
    fixed: 0,
  };
  let postAvailabilityHref = "/dashboard/vessels";

  if (showVessel) {
    const { data: latestVessel } = await supabase
      .from("v_my_vessels")
      .select("id")
      .order("claimed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestVessel?.id) {
      postAvailabilityHref = `/dashboard/vessels/${latestVessel.id}/availability/new`;
    }

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
    const { data: listings } = ids.length
      ? await supabase
          .from("vessel_availability")
          .select("status, review_status")
          .in("id", ids)
      : { data: [] };

    vesselStats.total = listings?.length ?? 0;
    vesselStats.pending =
      listings?.filter(
        (l: { review_status: string }) => l.review_status === "PENDING",
      ).length ?? 0;
    vesselStats.open =
      listings?.filter(
        (l: { status: string; review_status: string }) =>
          l.review_status === "APPROVED" && l.status === "OPEN",
      ).length ?? 0;
    vesselStats.fixed =
      listings?.filter((l: { status: string }) => l.status === "FIXED")
        .length ?? 0;
  }

  const totalPending = cargoStats.pending + vesselStats.pending;
  const firstName = appUser.full_name?.split(" ")[0] ?? "there";

  return (
    <div className="space-y-6 py-2 max-w-5xl">
      <div className="flex items-start justify-between gap-4 max-sm:flex-col">
        <div>
          <p className="text-label text-ocean-500 mb-1.5">Operations Center</p>
          <h1 className="text-[26px] font-bold text-ocean-950 tracking-tight leading-none">
            Good {getGreeting()},{" "}
            <span className="text-ocean-500">{firstName}</span>
          </h1>
          <p className="text-[13px] text-slate-500 mt-2 leading-relaxed max-w-md">
            {role === "broker"
              ? "Your cargo listings and vessel availability across the MENA market."
              : showCargo
                ? "Post cargo and track matching vessel availability."
                : "Post vessel availability and track cargo opportunities."}
          </p>
        </div>

        <div className="flex gap-2 shrink-0 max-sm:w-full">
          {showCargo && (
            <Link
              href="/dashboard/cargo/create"
              className="group flex items-center gap-2 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold px-4 py-2.5 rounded-xl transition-all text-sm shadow-[0_1px_4px_rgba(45,109,168,0.3)] hover:shadow-[0_2px_8px_rgba(45,109,168,0.35)] hover:-translate-y-px"
            >
              <Plus className="w-4 h-4" />
              Post cargo
            </Link>
          )}
          {showVessel && (
            <Link
              href={postAvailabilityHref}
              className="group flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 hover:border-ocean-200 text-slate-700 font-semibold px-4 py-2.5 rounded-xl transition-all text-sm hover:-translate-y-px"
            >
              <Ship className="w-4 h-4 text-ocean-500" />
              Post position
            </Link>
          )}
        </div>
      </div>

      <TrustTierBanner
        tier={tier}
        cleanPosts={appUser.clean_posts}
        strikeCount={appUser.strike_count}
      />

      {totalPending > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200/80 rounded-2xl px-5 py-4">
          <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">
              {totalPending} submission{totalPending > 1 ? "s" : ""} pending
              review
            </p>
            <p className="text-xs text-amber-700/80 mt-0.5 leading-relaxed">
              Our team reviews new submissions within 2 hours. You&apos;ll be
              notified of any corrections or approvals.
            </p>
          </div>
        </div>
      )}

      {showCargo && (
        <section>
          {role === "broker" && (
            <SectionLabel icon={Package} label="Cargo Listings" />
          )}
          <div className="grid grid-cols-4 max-lg:grid-cols-2 gap-3">
            <KpiCard
              label="Total"
              value={cargoStats.total}
              icon={Package}
              href="/dashboard/cargo/my"
            />
            <KpiCard
              label="Live"
              value={cargoStats.live}
              icon={CheckCircle2}
              accent="green"
              href="/dashboard/cargo/my"
            />
            <KpiCard
              label="Under review"
              value={cargoStats.pending}
              icon={Clock}
              accent="amber"
            />
            <KpiCard
              label="Closed"
              value={cargoStats.closed}
              icon={TrendingUp}
              accent="slate"
            />
          </div>
        </section>
      )}

      {showVessel && (
        <section>
          {role === "broker" && (
            <SectionLabel icon={Ship} label="Vessel Availability" />
          )}
          <div className="grid grid-cols-4 max-lg:grid-cols-2 gap-3">
            <KpiCard
              label="Total"
              value={vesselStats.total}
              icon={Ship}
              href="/dashboard/vessels"
            />
            <KpiCard
              label="Open"
              value={vesselStats.open}
              icon={CheckCircle2}
              accent="green"
              href="/dashboard/vessels"
            />
            <KpiCard
              label="Under review"
              value={vesselStats.pending}
              icon={Clock}
              accent="amber"
            />
            <KpiCard
              label="Fixed"
              value={vesselStats.fixed}
              icon={TrendingUp}
              accent="foam"
            />
          </div>
        </section>
      )}

      <section>
        <SectionLabel label="Quick Actions" />
        <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-3">
          {showCargo && (
            <>
              <ActionCard
                href="/dashboard/cargo/my"
                icon={Package}
                title="My cargo listings"
                description="Review, track, and manage your submitted cargo postings."
                cta="View listings"
              />
              <ActionCard
                href="/dashboard/cargo/create"
                icon={Plus}
                title="Post new cargo"
                description="Submit a cargo listing and let the matching engine find you a vessel."
                cta="Start posting"
                primary
              />
            </>
          )}
          {showVessel && (
            <>
              <ActionCard
                href="/dashboard/vessels"
                icon={Ship}
                title="My availability"
                description="Track your posted vessel availability positions."
                cta="View postings"
              />
              <ActionCard
                href={postAvailabilityHref}
                icon={Zap}
                title="Post position"
                description="Select your vessel and post a new open position for matching."
                cta="Post now"
                primary
              />
            </>
          )}

          <ActionCard
            href="/dashboard/vessels/browse"
            icon={Star}
            title="Browse open vessels"
            description="Explore all approved, open vessel positions across the MENA market."
            cta="Browse market"
          />
          <ActionCard
            href="/dashboard/cargo"
            icon={Package}
            title="Browse cargo market"
            description="Explore all active cargo listings looking for vessel matches."
            cta="View cargo"
          />
        </div>
      </section>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

function SectionLabel({
  icon: Icon,
  label,
}: {
  icon?: React.ElementType;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {Icon && <Icon className="w-3.5 h-3.5 text-slate-400" />}
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.16em]">
        {label}
      </p>
    </div>
  );
}

function TrustTierBanner({
  tier,
  cleanPosts,
  strikeCount,
}: {
  tier: TrustTier;
  cleanPosts: number;
  strikeCount: number;
}) {
  if (tier === "VERIFIED") {
    return (
      <div className="flex items-center gap-3.5 bg-emerald-50 border border-emerald-200/80 rounded-2xl px-5 py-4">
        <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0 shadow-inner">
          <CheckCircle2 className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-emerald-900 leading-none">
            Verified account
          </p>
          <p className="text-xs text-emerald-700/80 mt-1">
            Your submissions go live immediately — no moderation delay.
          </p>
        </div>
        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-200/80 rounded-full px-2.5 py-1 uppercase tracking-wider shrink-0">
          Verified
        </span>
      </div>
    );
  }

  if (tier === "FLAGGED") {
    return (
      <div className="flex items-center gap-3.5 bg-red-50 border border-red-200/80 rounded-2xl px-5 py-4">
        <div className="w-8 h-8 rounded-xl bg-red-600 flex items-center justify-center shrink-0 shadow-inner">
          <AlertTriangle className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-900 leading-none">
            Account flagged
          </p>
          <p className="text-xs text-red-700/80 mt-1">
            Your submissions are held for review. Contact our support team to
            restore verified status.
          </p>
        </div>
      </div>
    );
  }

  const remaining = 5 - cleanPosts;

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
            <Clock className="w-3.5 h-3.5 text-amber-700" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 leading-none">
              Building your trust score
            </p>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed max-w-xs">
              {remaining > 0
                ? `${remaining} more clean submission${remaining !== 1 ? "s" : ""} needed to unlock instant publishing.`
                : "You're eligible for a Verified upgrade."}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">
            {cleanPosts}
            <span className="text-base text-slate-300 font-normal">/5</span>
          </p>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">
            clean posts
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              className={`flex-1 h-1.5 rounded-full transition-colors ${
                n <= cleanPosts ? "bg-ocean-500" : "bg-slate-100"
              }`}
            />
          ))}
        </div>
        {strikeCount > 0 && (
          <p className="text-[11px] text-amber-700 font-medium">
            {strikeCount} correction{strikeCount > 1 ? "s" : ""} recorded —{" "}
            {2 - strikeCount} more will flag your account.
          </p>
        )}
      </div>
    </div>
  );
}

type KpiAccent = "green" | "amber" | "slate" | "ocean" | "foam";

const KPI_ACCENT_CONFIG: Record<
  KpiAccent,
  { icon: string; value: string; dot: string; pill: string }
> = {
  green: {
    icon: "text-emerald-600 bg-emerald-50",
    value: "text-emerald-700",
    dot: "bg-emerald-500",
    pill: "bg-emerald-50 text-emerald-600",
  },
  amber: {
    icon: "text-amber-600 bg-amber-50",
    value: "text-amber-700",
    dot: "bg-amber-400",
    pill: "bg-amber-50 text-amber-600",
  },
  slate: {
    icon: "text-slate-500 bg-slate-100",
    value: "text-slate-600",
    dot: "bg-slate-300",
    pill: "bg-slate-100 text-slate-500",
  },
  ocean: {
    icon: "text-ocean-600 bg-ocean-50",
    value: "text-ocean-800",
    dot: "bg-ocean-500",
    pill: "bg-ocean-50 text-ocean-600",
  },
  foam: {
    icon: "text-foam-600 bg-foam-50",
    value: "text-foam-700",
    dot: "bg-foam-500",
    pill: "bg-foam-50 text-foam-600",
  },
};

function KpiCard({
  label,
  value,
  icon: Icon,
  accent = "ocean",
  href,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  accent?: KpiAccent;
  href?: string;
}) {
  const cfg = KPI_ACCENT_CONFIG[accent];

  const inner = (
    <div
      className={`bg-white border border-slate-200/80 rounded-2xl p-5 space-y-3 transition-all ${
        href
          ? "hover:border-ocean-200 hover:shadow-[0_2px_8px_rgba(45,109,168,0.1)] hover:-translate-y-px cursor-pointer"
          : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div
          className={`w-8 h-8 rounded-xl flex items-center justify-center ${cfg.icon}`}
        >
          <Icon className="w-4 h-4" />
        </div>
        {value > 0 && (
          <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} aria-hidden />
        )}
      </div>
      <div>
        <p
          className={`text-2xl font-bold tabular-nums leading-none ${
            value > 0 ? cfg.value : "text-slate-200"
          }`}
        >
          {value}
        </p>
        <p className="text-xs text-slate-400 font-medium mt-1">{label}</p>
      </div>
    </div>
  );

  if (href && value > 0) {
    return <Link href={href}>{inner}</Link>;
  }
  return inner;
}

function ActionCard({
  href,
  icon: Icon,
  title,
  description,
  cta,
  primary = false,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
  cta: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex flex-col gap-4 rounded-2xl p-6 border transition-all duration-200 hover:-translate-y-px ${
        primary
          ? "bg-ocean-600 border-ocean-600 hover:bg-ocean-700 hover:border-ocean-700 shadow-[0_2px_8px_rgba(45,109,168,0.2)]"
          : "bg-white border-slate-200/80 hover:border-ocean-200 hover:shadow-[0_2px_8px_rgba(45,109,168,0.08)]"
      }`}
    >
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center ${
          primary ? "bg-white/15" : "bg-ocean-50"
        }`}
      >
        <Icon
          className={`w-5 h-5 ${primary ? "text-white" : "text-ocean-600"}`}
        />
      </div>
      <div className="flex-1">
        <p
          className={`font-semibold text-[14px] ${
            primary ? "text-white" : "text-slate-900"
          }`}
        >
          {title}
        </p>
        <p
          className={`text-[13px] mt-1.5 leading-relaxed ${
            primary ? "text-ocean-100/80" : "text-slate-500"
          }`}
        >
          {description}
        </p>
      </div>
      <div
        className={`flex items-center gap-1.5 text-[13px] font-semibold group-hover:gap-2 transition-all duration-150 ${
          primary ? "text-white/80" : "text-ocean-600"
        }`}
      >
        {cta}
        <ArrowUpRight className="w-3.5 h-3.5" />
      </div>
    </Link>
  );
}
