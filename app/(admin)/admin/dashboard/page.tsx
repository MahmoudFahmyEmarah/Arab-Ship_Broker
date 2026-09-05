// Console home — server side of the Admin Dashboard: gates the viewer, pulls
// the single get_admin_dashboard(range) feed, adds the optional Vercel
// snapshot, and works out which sections this admin may see. Rendering and
// interaction live in components/admin/dashboard/AdminDashboard.tsx.
import { requireAdmin, getAdminSupabaseClient } from "@/lib/admin/require-admin";
import { canAccess } from "@/lib/admin/sections";
import { RANGE_DAYS, parseRange } from "@/lib/admin/dashboard/model";
import { fetchVercelSnapshot } from "@/lib/admin/dashboard/vercel";
import { fetchDomainSnapshot } from "@/lib/admin/dashboard/domain";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const PLATFORM_DOMAIN = "arabshipbroker.com";

// Mail settings the domain card probes (host, port, mailbox, cPanel) — read
// with the service role because groupmail_config is owner-only.
async function mailSettings() {
  try {
    const { data } = await getSupabaseAdminClient()
      .from("groupmail_config").select("smtp_host, smtp_port, smtp_user, cpanel_host").eq("id", 1).maybeSingle();
    return { smtpHost: data?.smtp_host ?? null, smtpPort: data?.smtp_port ?? 465, mailbox: data?.smtp_user ?? null, cpanelHost: data?.cpanel_host ?? null };
  } catch {
    return { smtpHost: null, smtpPort: 465, mailbox: null, cpanelHost: null };
  }
}
import type { DashboardFeed, EventsFeed } from "@/lib/admin/dashboard/types";
import { AdminDashboard } from "@/components/admin/dashboard/AdminDashboard";

export const dynamic = "force-dynamic";

const TASK_SECTIONS = ["review", "vesselavail", "datasync", "messages", "cargo", "ports", "vessels", "orgmembers"];

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const admin = await requireAdmin({ section: "dashboard" });
  const { range: rangeParam } = await searchParams;
  const range = parseRange(rangeParam);
  const supabase = await getAdminSupabaseClient();

  const [feedResult, eventsResult, vercel, domain] = await Promise.all([
    supabase.rpc("get_admin_dashboard", { p_days: RANGE_DAYS[range] }),
    supabase.rpc("get_admin_dashboard_events", { p_days: RANGE_DAYS[range] }),
    fetchVercelSnapshot(),
    admin.tier === "super"
      ? mailSettings().then((m) => fetchDomainSnapshot({ domain: PLATFORM_DOMAIN, ...m })).catch(() => null)
      : Promise.resolve(null),
  ]);
  const feed = (feedResult.error ? null : (feedResult.data as DashboardFeed | null)) ?? null;
  if (feed) feed.events = eventsResult.error ? null : ((eventsResult.data as EventsFeed | null) ?? null);
  const error = feedResult.error?.message ?? null;

  const can = (id: string) => canAccess(id, admin.tier, admin.perms) !== "none";
  const show = {
    market: can("cargo") || can("vesselavail") || can("stats"),
    users: can("users") || can("orgmembers"),
    ingest: can("datasync"),
    growth: can("groupmail") || can("messages"),
    perf: admin.tier === "super",
  };
  const taskAccess = Object.fromEntries(TASK_SECTIONS.map((id) => [id, can(id)]));

  return (
    <AdminDashboard
      feed={feed}
      error={error}
      vercel={vercel}
      domain={domain}
      range={range}
      show={show}
      taskAccess={taskAccess}
      canEditThresholds={admin.tier === "super"}
      loadedAt={new Date().toISOString()}
    />
  );
}
