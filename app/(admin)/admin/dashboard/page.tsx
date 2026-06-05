import Link from "next/link";
import {
  ClipboardList,
  Package,
  Ship,
  Users,
  Clock,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Mail,
  ShieldAlert,
  ArrowRight,
  TrendingUp,
} from "lucide-react";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import type { AdminStats, ActivityDay, QueueItem } from "@/lib/admin/types";
import { StatCard } from "@/components/admin/dashboard/StatCard";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ActivityChart } from "@/components/admin/dashboard/ActivityChart";
import { cn } from "@/lib/utils";

function formatQueueAge(minutes: number | null): string {
  if (!minutes || minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminDashboardPage() {
  // Guard: throws/redirects if not admin
  const admin = await requireAdmin();
  const supabase = await getAdminSupabaseClient();

  const [statsResult, activityResult, queueResult] = await Promise.all([
    // 1. All platform metrics in one RPC call
    supabase.rpc("get_admin_stats"),

    // 2. 30-day activity time series
    supabase.rpc("get_admin_activity", { p_days: 30 }),

    // 3. Oldest pending queue items (for the actionable list)
    supabase
      .from("v_admin_queue_detail")
      .select(
        "id, listing_type, listing_id, created_at, review_reason, submitter_name, submitter_email, submitter_trust_tier, commodity_name, cargo_type, qty_max_mt, load_zone, vessel_name, vessel_type, dwt_grain, open_zone",
      )
      .eq("status", "PENDING")
      .order("created_at", { ascending: true })
      .limit(5),
  ]);

  const stats = (statsResult.data ?? {}) as AdminStats;
  const activity = (activityResult.data ?? []) as ActivityDay[];
  const oldestPending = (queueResult.data ?? []) as QueueItem[];

  // ── Derived values ────────────────────────────────────────────
  const queueAgeStr = formatQueueAge(stats.queue_oldest_minutes);
  const slaBreached =
    stats.queue_pending > 0 && (stats.queue_oldest_minutes ?? 0) > 120;

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title={`Good ${getGreeting()}, ${admin.fullName.split(" ")[0]}`}
        subtitle="Here's what needs your attention today."
      />

      {slaBreached && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded px-5 py-4">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-900">
              Review SLA breached — oldest item is {queueAgeStr} old
            </p>
            <p className="text-xs text-red-700 mt-0.5">
              Target review time is 2 hours during business hours.{" "}
              <Link
                href="/admin/queue"
                className="font-semibold underline underline-offset-2"
              >
                Go to queue →
              </Link>
            </p>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-xs font-bold text-asb-gray-400 uppercase tracking-widest mb-3">
          Platform health
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Pending review"
            value={stats.queue_pending ?? 0}
            icon={ClipboardList}
            accent={
              (stats.queue_pending ?? 0) > 0
                ? slaBreached
                  ? "red"
                  : "amber"
                : "slate"
            }
            href="/admin/queue"
            hint={
              stats.queue_pending > 0
                ? `Oldest: ${queueAgeStr}`
                : "Queue is clear"
            }
            urgent={slaBreached}
          />
          <StatCard
            label="Live cargo"
            value={stats.cargo_live ?? 0}
            icon={Package}
            accent="ocean"
            href="/admin/cargo"
          />
          <StatCard
            label="Open vessels"
            value={stats.vessel_open ?? 0}
            icon={Ship}
            accent="ocean"
            href="/admin/vessel-availability"
          />
          <StatCard
            label="Active users"
            value={stats.users_active ?? 0}
            icon={Users}
            accent="ocean"
            href="/admin/users"
          />
        </div>
      </div>

      <div>
        <h2 className="text-xs font-bold text-asb-gray-400 uppercase tracking-widest mb-3">
          Trust system
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="NEW tier users"
            value={stats.users_new_tier ?? 0}
            icon={Clock}
            accent="slate"
            href="/admin/users?tier=NEW"
            hint="Posts go to queue"
          />
          <StatCard
            label="VERIFIED users"
            value={stats.users_verified_tier ?? 0}
            icon={CheckCircle2}
            accent="green"
            href="/admin/users?tier=VERIFIED"
            hint="Posts go live instantly"
          />
          <StatCard
            label="FLAGGED users"
            value={stats.users_flagged_tier ?? 0}
            icon={AlertTriangle}
            accent={(stats.users_flagged_tier ?? 0) > 0 ? "red" : "slate"}
            href="/admin/users?tier=FLAGGED"
            hint="Needs manual review"
            urgent={(stats.users_flagged_tier ?? 0) > 0}
          />
          <StatCard
            label="New users (30d)"
            value={stats.users_new_30d ?? 0}
            icon={TrendingUp}
            accent="ocean"
          />
        </div>
      </div>

      {((stats.ports_unverified ?? 0) > 0 ||
        (stats.vessels_high_risk ?? 0) > 0 ||
        (stats.messages_unread ?? 0) > 0) && (
        <div>
          <h2 className="text-xs font-bold text-asb-gray-400 uppercase tracking-widest mb-3">
            Needs attention
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {(stats.ports_unverified ?? 0) > 0 && (
              <StatCard
                label="Unverified ports"
                value={stats.ports_unverified}
                icon={MapPin}
                accent="amber"
                href="/admin/ports?filter=unverified"
                hint="User-submitted, need confirmation"
              />
            )}
            {(stats.vessels_high_risk ?? 0) > 0 && (
              <StatCard
                label="HIGH risk vessels"
                value={stats.vessels_high_risk}
                icon={ShieldAlert}
                accent="red"
                href="/admin/vessels?risk=HIGH"
              />
            )}
            {(stats.messages_unread ?? 0) > 0 && (
              <StatCard
                label="Unread messages"
                value={stats.messages_unread}
                icon={Mail}
                accent="coral"
                href="/admin/messages"
              />
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Activity chart */}
        <div className="lg:col-span-3 bg-white rounded border border-asb-gray-200 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-bold text-asb-navy">
                Platform activity
              </h2>
              <p className="text-xs text-asb-gray-400 mt-0.5">Last 30 days</p>
            </div>
          </div>
          <ActivityChart data={activity} />
        </div>

        <div className="lg:col-span-2 bg-white rounded border border-asb-gray-200 p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-asb-navy">
              Oldest pending items
            </h2>
            <Link
              href="/admin/queue"
              className="text-xs font-semibold text-asb-blue hover:text-asb-blue flex items-center gap-1"
            >
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {oldestPending.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-center py-8">
              <div>
                <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-asb-gray-700">
                  Queue is clear
                </p>
                <p className="text-xs text-asb-gray-400 mt-1">
                  All submissions reviewed
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2 flex-1">
              {oldestPending.map((item) => (
                <Link
                  key={item.id}
                  href={`/admin/queue/${item.id}`}
                  className="flex items-start gap-3 p-3 rounded hover:bg-asb-gray-50 transition-colors group border border-transparent hover:border-asb-gray-200"
                >
                  <div
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                      item.listing_type === "cargo"
                        ? "bg-asb-blue-light"
                        : "bg-foam-50",
                    )}
                  >
                    {item.listing_type === "cargo" ? (
                      <Package className="w-4 h-4 text-asb-blue" />
                    ) : (
                      <Ship className="w-4 h-4 text-foam-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-asb-navy truncate">
                      {item.listing_type === "cargo"
                        ? `${item.commodity_name ?? "Cargo"} · ${item.qty_max_mt?.toLocaleString() ?? "?"} MT`
                        : `${item.vessel_name ?? "Vessel"} · ${item.dwt_grain?.toLocaleString() ?? "?"} DWT`}
                    </p>
                    <p className="text-[11px] text-asb-gray-400 mt-0.5 truncate">
                      {item.submitter_name ?? item.submitter_email ?? "Unknown"}{" "}
                      · {item.review_reason ?? "—"}
                    </p>
                    <p className="text-[11px] text-asb-gray-400">
                      {formatDate(item.created_at)}
                    </p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-asb-gray-400 group-hover:text-asb-blue shrink-0 mt-1 transition-colors" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Register summary row ──────────────────────────────── */}
      <div>
        <h2 className="text-xs font-bold text-asb-gray-400 uppercase tracking-widest mb-3">
          Register
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Vessels in register"
            value={stats.vessels_total ?? 0}
            icon={Ship}
            accent="ocean"
            href="/admin/vessels"
          />
          <StatCard
            label="Sanctioned vessels"
            value={stats.vessels_sanctioned ?? 0}
            icon={ShieldAlert}
            accent={(stats.vessels_sanctioned ?? 0) > 0 ? "red" : "slate"}
            href="/admin/vessels?sanctioned=true"
          />
          <StatCard
            label="Cargo posted (30d)"
            value={stats.cargo_total_30d ?? 0}
            icon={Package}
            accent="ocean"
          />
          <StatCard
            label="Cargo pending"
            value={stats.cargo_pending ?? 0}
            icon={Clock}
            accent={(stats.cargo_pending ?? 0) > 0 ? "amber" : "slate"}
            href="/admin/cargo?review=PENDING"
          />
        </div>
      </div>
    </div>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}
