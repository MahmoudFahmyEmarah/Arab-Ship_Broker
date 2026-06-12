import Link from "next/link";
import {
  Activity, Ship, Boxes, Route, Lock, ArrowRight, ShieldCheck, CalendarDays,
} from "lucide-react";
import {
  getLatestEdition, getEdition, getArchive, formatRange,
  SIZE_BAND_ORDER, type InsightBucket, type InsightEdition,
} from "@/lib/market-insights";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { FuelPanelMember, FuelTeaserPublic } from "@/components/market-insights/FuelPanel";

// Session-gated fuel panel reads cookies → must render per request.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Market Insights — Arab ShipBroker",
  description:
    "Weekly regional dry bulk & break-bulk activity intelligence (AG / R.Sea / E.Med / B.Sea / A.Sea, sub-66K). Aggregated data only.",
};

const nf = new Intl.NumberFormat("en-US");

function weekLabel(weekId: string) {
  const m = weekId.match(/W(\d+)/);
  return m ? `Week ${parseInt(m[1], 10)}` : weekId;
}

// Public-facing regime labels. DISPLAY ONLY — the underlying regime value stays
// "Dry bulk (IMSBC)" / "Break-bulk (CSS)" in the data, DB and member views; the
// public page just shows friendlier terms (no "IMSBC" jargon).
function publicRegimeLabel(label: string): string {
  if (/IMSBC/i.test(label)) return "Bulk Cargos";
  if (/Break-?bulk/i.test(label)) return "Break-bulk";
  return label; // Grain · Other
}

// ── Small presentational pieces (server-rendered) ──
function SnapshotCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 text-slate-500 mb-3">
        <Icon className="w-4 h-4 text-ocean-600" />
        <span className="text-[11px] font-bold uppercase tracking-[0.1em]">{label}</span>
      </div>
      <div className="text-3xl font-bold text-ocean-950 tabular-nums tracking-tight">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

function BarList({ items, accent = "ocean" }: { items: InsightBucket[]; accent?: "ocean" | "foam" }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const bar = accent === "foam" ? "bg-foam-500" : "bg-ocean-500";
  return (
    <div className="space-y-2.5">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-3">
          <span className={`w-28 shrink-0 text-xs font-medium truncate ${i.label === "Other" ? "text-slate-400 italic" : "text-slate-600"}`}>{i.label}</span>
          <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full ${i.label === "Other" ? "bg-slate-300" : bar}`} style={{ width: `${Math.round((i.count / max) * 100)}%` }} />
          </div>
          <span className="w-8 shrink-0 text-right text-xs font-semibold text-ocean-900 tabular-nums">{i.count}</span>
        </div>
      ))}
    </div>
  );
}

function RankTable({ title, items }: { title: string; items: InsightBucket[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">{title}</div>
      <div className="divide-y divide-slate-50">
        {items.map((i, idx) => (
          <div key={i.label} className="flex items-center gap-3 px-5 py-2.5">
            <span className="w-5 text-xs font-semibold text-slate-300 tabular-nums">{idx + 1}</span>
            <span className={`flex-1 text-sm ${i.label === "Other" ? "text-slate-400 italic" : "text-ocean-950 font-medium"}`}>{i.label}</span>
            <span className="text-sm font-semibold text-ocean-700 tabular-nums">{i.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const MEMBER_DEPTH = [
  { title: "Full lane matrix", blurb: "Every zone-pair with counts, size split and momentum, not just the headline lanes." },
  { title: "Zone-by-zone supply / demand balance", blurb: "Open tonnage vs. live cargo per zone, so you see where it's long and where it's tight." },
  { title: "Route distances & voyage economics", blurb: "ECDIS distances feeding TCE on the in-portal Voyage Estimator." },
  { title: "Live matching board", blurb: "Real-time cargo & position board with firewalled, broker-mediated introductions." },
];

export default async function MarketInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const [edition, archive] = await Promise.all([
    week ? getEdition(week).then((e) => e ?? getLatestEdition()) : getLatestEdition(),
    getArchive(),
  ]);
  const ed: InsightEdition = edition;
  const p = ed.payload;

  // ── Fuel-cost firewall (Pre_Final §11) ──
  // Resolve the session SERVER-SIDE. Only an authenticated member session
  // renders the real fuel panel; for everyone else the page emits the locked
  // teaser, so the FUEL_COST figures are never serialized into the public DOM.
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isMember = Boolean(user);

  // Order size bands consistently.
  const sizeBands = [...p.size_bands].sort(
    (a, b) => SIZE_BAND_ORDER.indexOf(a.label as never) - SIZE_BAND_ORDER.indexOf(b.label as never),
  );
  // Friendly public labels for the cargo-mix regimes (display only).
  const regimeMix = p.regime_mix.map((b) => ({ ...b, label: publicRegimeLabel(b.label) }));

  return (
    <div className="bg-slate-50 min-h-screen">
      <div className="container pt-28 max-lg:pt-24 pb-20">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-6 flex-wrap mb-8">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-ocean-600 mb-3">
              <Activity className="w-3.5 h-3.5" /> Market Insights
              {ed.sample && <span className="ml-1 text-[9px] text-slate-400 normal-case tracking-normal font-medium">(sample)</span>}
            </div>
            <h1 className="text-3xl max-sm:text-2xl font-bold text-ocean-950 tracking-tight">
              {weekLabel(ed.week_id)} · {formatRange(ed.range_from, ed.range_to)}
            </h1>
            <p className="text-sm text-slate-500 mt-2 max-w-2xl">
              Regional dry bulk &amp; break-bulk activity: AG / R.Sea / E.Med / B.Sea / A.Sea,
              sub-66K focus. <span className="font-semibold text-slate-700">Activity intelligence, not freight-rate data.</span>
            </p>
          </div>

          {/* Archive picker */}
          <div className="rounded-2xl border border-slate-200 bg-white p-3 min-w-[200px]">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400 px-1 pb-1.5">
              <CalendarDays className="w-3.5 h-3.5" /> Archive
            </div>
            <div className="flex flex-col">
              {archive.slice(0, 6).map((a) => {
                const active = a.week_id === ed.week_id;
                return (
                  <Link
                    key={a.week_id}
                    href={`/market-insights?week=${a.week_id}`}
                    className={`flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-lg text-sm transition-colors ${active ? "bg-ocean-50 text-ocean-700 font-semibold" : "text-slate-600 hover:bg-slate-50"}`}
                  >
                    <span>{weekLabel(a.week_id)}</span>
                    <span className="text-[11px] text-slate-400">{formatRange(a.range_from, a.range_to).replace(/ \d{4}$/, "")}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Snapshot cards ── */}
        <div className="grid grid-cols-4 max-lg:grid-cols-2 max-sm:grid-cols-1 gap-4 mb-6">
          <SnapshotCard icon={Activity} label="Cargoes live" value={nf.format(p.snapshot.cargoes_live)} sub="approved & circulating" />
          <SnapshotCard icon={Ship} label="Open tonnage" value={nf.format(p.snapshot.open_tonnage)} sub="positions in region" />
          <SnapshotCard icon={Boxes} label="Avg cargo size" value={p.snapshot.avg_cargo_size_mt != null ? `~${nf.format(p.snapshot.avg_cargo_size_mt)}` : "—"} sub="MT (rounded)" />
          <SnapshotCard icon={Route} label="Active lanes" value={nf.format(p.snapshot.active_lanes)} sub="zone-to-zone" />
        </div>

        {/* ── Charts ── */}
        <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-4 mb-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 mb-4">Cargo mix by regime</div>
            <BarList items={regimeMix} />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 mb-4">Size-band distribution</div>
            <BarList items={sizeBands} accent="foam" />
          </div>
        </div>

        {/* ── Tables ── */}
        <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-4 mb-6">
          <RankTable title="Top lanes" items={p.top_lanes} />
          <RankTable title="Top commodities" items={p.top_commodities} />
          <RankTable title="Top load zones" items={p.load_zones} />
          <RankTable title="Top discharge zones" items={p.disch_zones} />
        </div>

        {/* ── Handysize fuel-cost panel — members see figures, public sees the
              locked teaser only (no figures in the public DOM). Fuel cost,
              never a freight/hire quote. ── */}
        {isMember ? <FuelPanelMember /> : <FuelTeaserPublic />}

        {/* ── Narrative ── */}
        {ed.narrative && (
          <div className="rounded-2xl border border-ocean-100 bg-ocean-50/50 p-6 mb-6">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ocean-600 mb-2">The market read</div>
            <p className="text-[15px] leading-relaxed text-ocean-950/85">{ed.narrative}</p>
          </div>
        )}

        {/* ── Firewall footer line ── */}
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-12">
          <ShieldCheck className="w-3.5 h-3.5" />
          Aggregated data only. No individual cargo, counterparty, or broker detail. Groups under {p.floor} roll into “Other”; quantities shown as bands.
        </div>

        {/* ── Conversion: members see more ── */}
        <div className="relative overflow-hidden rounded-3xl border border-ocean-700/60 bg-gradient-to-br from-ocean-950 via-ocean-900 to-ocean-800 text-white p-10 max-sm:p-7 shadow-[0_8px_40px_rgba(8,20,38,0.35)]">
          {/* subtle glow so the panel reads as a feature, not a grey footnote */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full opacity-50"
            style={{ background: "radial-gradient(circle, rgba(16,163,188,0.28) 0%, transparent 70%)" }}
          />
          <div className="relative max-w-2xl">
            <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-foam-300 mb-4">
              <ShieldCheck className="w-3.5 h-3.5" /> This is a fraction of what members see
            </div>
            <h2 className="text-3xl max-sm:text-2xl font-extrabold tracking-tight text-white leading-tight mb-3">
              The public weekly is the headline.
              <br className="max-sm:hidden" /> Members work the whole board.
            </h2>
            <p className="text-ocean-100/85 text-[15px] leading-relaxed">
              The edition above is the aggregated teaser. Inside the portal the same data opens
              into the cuts that actually move a fixture, gated because that depth is the membership.
            </p>
          </div>

          <div className="relative grid grid-cols-2 max-sm:grid-cols-1 gap-3.5 mt-8 mb-8">
            {MEMBER_DEPTH.map((m) => (
              <div
                key={m.title}
                className="group flex items-start gap-3.5 rounded-2xl bg-white/[0.06] border border-white/12 p-4 transition-all duration-200 hover:bg-white/[0.1] hover:border-foam-400/40 hover:-translate-y-0.5"
              >
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-foam-400/15 border border-foam-400/25 shrink-0 transition-colors group-hover:bg-foam-400/25">
                  <Lock className="w-4 h-4 text-foam-300" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[15px] text-white">{m.title}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-foam-300/80 border border-foam-300/30 rounded px-1.5 py-0.5">Members</span>
                  </div>
                  <div className="text-[13px] text-ocean-100/75 mt-1 leading-relaxed">{m.blurb}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="relative flex items-center gap-3 flex-wrap">
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 h-12 px-8 rounded-xl bg-white text-ocean-950 font-bold text-sm hover:bg-slate-50 transition-all hover:-translate-y-0.5 shadow-[0_4px_20px_rgba(0,0,0,0.25)]"
            >
              Get Access <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/services" className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-white/8 border border-white/15 text-white font-semibold text-sm hover:bg-white/14 transition-colors">
              How membership works
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
