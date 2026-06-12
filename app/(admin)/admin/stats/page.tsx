import { Package, Ship, Activity, Anchor, Clock, AlertTriangle, Boxes, Wrench } from "lucide-react";

import { requireAdmin, getAdminSupabaseClient } from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/dashboard/StatCard";
import { PublicStatsBar } from "@/components/PublicStatsBar";

export const dynamic = "force-dynamic";

type Bucket = { label: string; count: number };
type OpsStats = {
  generated_at: string;
  cargo: {
    total: number; live: number; pending: number; posted_7d: number; spot: number;
    by_status: Bucket[]; by_regime: Bucket[]; by_load_zone: Bucket[]; by_size_band: Bucket[];
  };
  vessels: {
    total: number; sanctioned: number; geared: number; open_positions: number;
    positions_pending: number; posted_7d: number;
    by_type: Bucket[]; by_open_zone: Bucket[]; by_age_band: Bucket[];
  };
};

const nf = new Intl.NumberFormat("en-US");

// A labelled horizontal bar list — the same readout used across the report.
function BreakdownCard({ title, items, accent = "ocean" }: { title: string; items: Bucket[]; accent?: "ocean" | "foam" }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const bar = accent === "foam" ? "bg-foam-500" : "bg-asb-blue";
  return (
    <div className="rounded-2xl border border-asb-gray-200 bg-white p-5">
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-asb-gray-500 mb-4">{title}</div>
      {items.length === 0 ? (
        <p className="text-sm text-asb-gray-400">No data yet.</p>
      ) : (
        <div className="space-y-2.5">
          {items.map((i) => (
            <div key={i.label} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-xs font-medium truncate text-asb-ink-soft">{i.label}</span>
              <div className="flex-1 h-2.5 rounded-full bg-asb-gray-100 overflow-hidden">
                <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.round((i.count / max) * 100)}%` }} />
              </div>
              <span className="w-10 shrink-0 text-right text-xs font-semibold text-asb-navy tabular-nums">{nf.format(i.count)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function AdminStatsPage() {
  await requireAdmin({ section: "stats" });
  const supabase = await getAdminSupabaseClient();
  const { data, error } = await supabase.rpc("get_admin_ops_stats");
  const s = (data ?? null) as OpsStats | null;

  if (error || !s) {
    return (
      <div>
        <AdminPageHeader title="Platform Stats" subtitle="Live cargo and vessel activity" />
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-800">
          Stats are unavailable. {error?.message?.includes("function") || error?.message?.includes("does not exist")
            ? "Run migration 20260601001050_admin_ops_stats.sql in the SQL editor, then reload."
            : error?.message ?? "Please try again."}
        </div>
      </div>
    );
  }

  const generated = new Date(s.generated_at).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div>
      <AdminPageHeader title="Platform Stats" subtitle="Live cargo and vessel activity, straight from the platform database">
        <span className="text-[11px] text-asb-gray-400">Updated {generated}</span>
      </AdminPageHeader>

      {/* ── Platform reach (whole-book totals) ── */}
      <PublicStatsBar className="mb-6" />

      {/* ── Headline stats bar ── */}
      <div className="grid grid-cols-4 max-lg:grid-cols-2 max-sm:grid-cols-1 gap-4 mb-8">
        <StatCard label="Cargo live" value={nf.format(s.cargo.live)} icon={Package} accent="ocean" hint={`${nf.format(s.cargo.total)} total · ${nf.format(s.cargo.spot)} spot`} href="/admin/cargo" />
        <StatCard label="Cargo pending" value={nf.format(s.cargo.pending)} icon={Clock} accent={s.cargo.pending > 0 ? "amber" : "slate"} hint="awaiting review" href="/admin/queue" />
        <StatCard label="Open positions" value={nf.format(s.vessels.open_positions)} icon={Anchor} accent="ocean" hint={`${nf.format(s.vessels.positions_pending)} pending review`} href="/admin/vessel-availability" />
        <StatCard label="Vessels tracked" value={nf.format(s.vessels.total)} icon={Ship} accent="ocean" hint={`${nf.format(s.vessels.geared)} geared`} href="/admin/vessels" />
        <StatCard label="Cargo posted 7d" value={nf.format(s.cargo.posted_7d)} icon={Activity} accent="green" hint="new this week" />
        <StatCard label="Positions posted 7d" value={nf.format(s.vessels.posted_7d)} icon={Activity} accent="green" hint="new this week" />
        <StatCard label="Sanctioned vessels" value={nf.format(s.vessels.sanctioned)} icon={AlertTriangle} accent={s.vessels.sanctioned > 0 ? "red" : "slate"} hint="blocked from posting" />
        <StatCard label="Geared vessels" value={nf.format(s.vessels.geared)} icon={Wrench} accent="slate" hint="crane-fitted" />
      </div>

      {/* ── Cargo-wise ── */}
      <div className="flex items-center gap-2 mb-4">
        <Package className="w-4 h-4 text-asb-blue" />
        <h2 className="text-sm font-bold uppercase tracking-[0.1em] text-asb-navy">Cargo</h2>
      </div>
      <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-4 mb-8">
        <BreakdownCard title="Live cargo by regime" items={s.cargo.by_regime} />
        <BreakdownCard title="Cargo by status (all)" items={s.cargo.by_status} accent="foam" />
        <BreakdownCard title="Live cargo by load zone" items={s.cargo.by_load_zone} />
        <BreakdownCard title="Live cargo by size band" items={s.cargo.by_size_band} accent="foam" />
      </div>

      {/* ── Vessel-wise ── */}
      <div className="flex items-center gap-2 mb-4">
        <Ship className="w-4 h-4 text-asb-blue" />
        <h2 className="text-sm font-bold uppercase tracking-[0.1em] text-asb-navy">Vessels</h2>
      </div>
      <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-4">
        <BreakdownCard title="Fleet by vessel type" items={s.vessels.by_type} />
        <BreakdownCard title="Fleet by age band" items={s.vessels.by_age_band} accent="foam" />
        <BreakdownCard title="Open positions by zone" items={s.vessels.by_open_zone} />
        <div className="rounded-2xl border border-asb-gray-200 bg-white p-5 flex flex-col justify-center gap-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-asb-gray-500">Fleet readiness</div>
          <div className="flex items-center gap-3 text-sm">
            <Boxes className="w-4 h-4 text-asb-gray-400" />
            <span className="text-asb-ink-soft">Geared (crane-fitted)</span>
            <span className="ml-auto font-semibold text-asb-navy tabular-nums">{nf.format(s.vessels.geared)} / {nf.format(s.vessels.total)}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <AlertTriangle className="w-4 h-4 text-asb-gray-400" />
            <span className="text-asb-ink-soft">Sanctioned (cannot post)</span>
            <span className="ml-auto font-semibold text-asb-navy tabular-nums">{nf.format(s.vessels.sanctioned)}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Anchor className="w-4 h-4 text-asb-gray-400" />
            <span className="text-asb-ink-soft">Open now / pending</span>
            <span className="ml-auto font-semibold text-asb-navy tabular-nums">{nf.format(s.vessels.open_positions)} / {nf.format(s.vessels.positions_pending)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
