import Link from "next/link";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import type { AdminStats, ActivityDay, QueueItem } from "@/lib/admin/types";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Stat, StatGrid } from "@/components/admin/ui/Stat";
import { ActivityChart } from "@/components/admin/dashboard/ActivityChart";
import { TrustTierBadge } from "@/components/admin/AdminBadge";

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

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

export default async function AdminDashboardPage() {
  const admin = await requireAdmin({ section: "dashboard" });
  const supabase = await getAdminSupabaseClient();

  const [statsResult, activityResult, queueResult] = await Promise.all([
    supabase.rpc("get_admin_stats"),
    supabase.rpc("get_admin_activity", { p_days: 30 }),
    supabase
      .from("v_admin_queue_detail")
      .select(
        "id, listing_type, listing_id, created_at, review_reason, submitter_name, submitter_email, submitter_trust_tier, commodity_name, cargo_type, qty_max_mt, load_zone, vessel_name, vessel_type, dwt_grain, open_zone",
      )
      .eq("status", "PENDING")
      .order("created_at", { ascending: true })
      .limit(6),
  ]);

  const stats = (statsResult.data ?? {}) as AdminStats;
  const activity = (activityResult.data ?? []) as ActivityDay[];
  const oldestPending = (queueResult.data ?? []) as QueueItem[];

  const queueAgeStr = formatQueueAge(stats.queue_oldest_minutes);
  const slaBreached = stats.queue_pending > 0 && (stats.queue_oldest_minutes ?? 0) > 120;

  return (
    <div className="adm-page">
      <AdminPageHeader
        title={`Good ${getGreeting()}, ${admin.fullName.split(" ")[0]}`}
        subtitle="Overview of platform activity and pending actions"
        warn={
          slaBreached ? (
            <span>
              Oldest pending item is {queueAgeStr} old.{" "}
              <Link href="/admin/queue" className="adm-link">Go to queue →</Link>
            </span>
          ) : undefined
        }
      />

      {/* Platform health */}
      <StatGrid>
        <Stat
          label="Pending review"
          value={stats.queue_pending ?? 0}
          sub={stats.queue_pending > 0 ? `Oldest: ${queueAgeStr}` : "Queue is clear"}
          accent={(stats.queue_pending ?? 0) > 0 ? (slaBreached ? "red" : "amber") : "default"}
          href="/admin/queue"
        />
        <Stat label="Live cargo" value={stats.cargo_live ?? 0} sub={`${stats.cargo_pending ?? 0} pending`} href="/admin/cargo" />
        <Stat label="Open vessels" value={stats.vessel_open ?? 0} sub={`${stats.vessel_pending ?? 0} pending`} href="/admin/vessel-availability" />
        <Stat label="Active users" value={stats.users_active ?? 0} sub={`${stats.users_total ?? 0} total`} href="/admin/users" />
      </StatGrid>

      {/* Trust system */}
      <StatGrid>
        <Stat label="NEW tier" value={stats.users_new_tier ?? 0} sub="Posts go to queue" href="/admin/users?tier=NEW" />
        <Stat label="VERIFIED tier" value={stats.users_verified_tier ?? 0} accent="green" sub="Posts go live instantly" href="/admin/users?tier=VERIFIED" />
        <Stat
          label="FLAGGED tier"
          value={stats.users_flagged_tier ?? 0}
          accent={(stats.users_flagged_tier ?? 0) > 0 ? "red" : "default"}
          sub="Needs manual review"
          href="/admin/users?tier=FLAGGED"
        />
        <Stat label="New users (30d)" value={stats.users_new_30d ?? 0} sub={`${stats.cargo_total_30d ?? 0} cargo posted`} />
      </StatGrid>

      <div className="adm-cols-2">
        {/* Pending actions */}
        <div className="adm-card">
          <div className="adm-card__head">
            <span className="adm-card__title">Pending actions</span>
            <Link href="/admin/queue" className="adm-link">View all →</Link>
          </div>
          {oldestPending.length === 0 ? (
            <div style={{ padding: "20px 0", textAlign: "center", color: "var(--adm-muted)", fontSize: 12 }}>
              Queue is clear. All submissions reviewed.
            </div>
          ) : (
            <div className="adm-list">
              {oldestPending.map((item) => (
                <div key={item.id} className="adm-list__row">
                  <span className={`adm-list__icon ${item.listing_type === "cargo" ? "is-cargo" : "is-vessel"}`}>
                    {item.listing_type === "cargo" ? "C" : "V"}
                  </span>
                  <div className="adm-list__body">
                    <div className="adm-list__title">
                      {item.listing_type === "cargo"
                        ? `${item.commodity_name ?? "Cargo"} · ${item.qty_max_mt?.toLocaleString() ?? "?"} MT`
                        : `${item.vessel_name ?? "Vessel"} · ${item.dwt_grain?.toLocaleString() ?? "?"} DWT`}
                    </div>
                    <div className="adm-list__meta">
                      {item.submitter_name ?? item.submitter_email ?? "Unknown"}
                      {item.submitter_trust_tier ? <> · <TrustTierBadge tier={item.submitter_trust_tier} /></> : null}
                      {" · "}
                      {formatDate(item.created_at)}
                    </div>
                  </div>
                  <div className="adm-list__actions">
                    <Link href={`/admin/queue/${item.id}`} className="adm-btn small">Review →</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Platform activity */}
        <div className="adm-card">
          <div className="adm-card__head">
            <span className="adm-card__title">Platform activity</span>
            <span className="adm-card__sub">Last 30 days</span>
          </div>
          <ActivityChart data={activity} />
        </div>
      </div>

      {/* Register summary */}
      <StatGrid>
        <Stat label="Vessels in register" value={stats.vessels_total ?? 0} href="/admin/vessels" />
        <Stat
          label="Sanctioned vessels"
          value={stats.vessels_sanctioned ?? 0}
          accent={(stats.vessels_sanctioned ?? 0) > 0 ? "red" : "default"}
          href="/admin/vessels?sanctioned=true"
        />
        <Stat
          label="Unverified ports"
          value={stats.ports_unverified ?? 0}
          accent={(stats.ports_unverified ?? 0) > 0 ? "amber" : "default"}
          href="/admin/ports?filter=unverified"
        />
        <Stat
          label="Unread messages"
          value={stats.messages_unread ?? 0}
          accent={(stats.messages_unread ?? 0) > 0 ? "amber" : "default"}
          href="/admin/messages"
        />
      </StatGrid>
    </div>
  );
}
