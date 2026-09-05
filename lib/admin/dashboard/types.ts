// Shape of the get_admin_dashboard(p_days) feed (supabase/migrations/
// 20260904203209_admin_dashboard_rpc.sql) plus the optional Vercel snapshot
// the page adds server-side when a token is configured.

export type RangeKey = "24h" | "7d" | "30d" | "90d";

export type SeriesPoint = { t: string; cargo: number; cargo_batch: number; vessels: number; signups: number };

export type BatchRow = {
  id: string;
  source: string;
  status: string;
  label: string | null;
  file_name: string | null;
  created_at: string;
  committed_at: string | null;
  undone_at: string | null;
  has_error: boolean;
  new: number;
  updated: number;
  invalid: number;
  errors: number;
};

export type DashboardFeed = {
  generated_at: string;
  range_days: number;
  hourly: boolean;
  db: { size_mb: number; connections: number; max_connections: number; functions: number; views: number; tables: number };
  cron_groupmail: {
    active: boolean; schedule: string; last_start: string | null; last_status: string | null;
    last_msg: string | null; runs_24h: number; failed_24h: number;
  } | null;
  groupmail: { campaigns: number; recipients: number; sent_ok: number; sent_fail: number; last_at: string | null; queued: number; in_range: number };
  matches: { n: number; computed_at: string | null; cargo_matched: number };
  insights: { editions: number; last_week: string | null; last_published_at: string | null; subscribers: number };
  email: { enabled: boolean | null; config_updated_at: string | null; last_sync_at: string | null; last_batch_at: string | null; last_batch_status: string | null };
  upload: { last_sync_at: string | null; last_batch_at: string | null };
  whatsapp: {
    state: string | null; worker_seen: string | null; linked_as: string | null; updated_at: string | null;
    messages: number; last_message_at: string | null; in_range: number;
  } | null;
  llm: { vendor: string; model: string; key_hint: string | null; is_active: boolean; updated_at: string } | null;
  security: { definer_views: string[]; definer_fn_anon: number; mutable_search_path: number; rls_off_tables: string[] };
  market: {
    cargo_live: number; cargo_total: number; cargo_in_range: number; cargo_batch_in_range: number; cargo_member_in_range: number;
    vessel_open: number; vessel_total: number; vessel_in_range: number; vessel_from_review: number; whatsapp_in_range: number;
    zones: { zone: string; n: number }[];
    laycan: { past: number; week: number; next: number; later: number; none: number };
    bands: { handy: number; supra: number; ultra: number; pmax: number; cape: number; unknown: number };
    commodities: { name: string; n: number }[];
    routes: { routes: number; suez: number; risk: number; risk_areas: number };
  };
  users: {
    total: number; active: number; admins: number; new_tier: number; verified_tier: number; flagged_tier: number;
    tiers: Record<string, number>; roles: Record<string, number>; signups_range: number;
    auth_total: number; active_d1: number; active_d7: number; active_d30: number; active_range: number;
    companies: number; seats: number; membership_pending: number; membership_oldest: string | null;
    posters_range: number; estimates_range: number;
  };
  ingest: {
    batches: BatchRow[]; batches_total: number; draft_batches: number; draft_oldest: string | null;
    staged_total: number; staged_invalid: number; staged_unchanged: number; staged_new: number; staged_updated: number;
    crq_pending: number; crq_oldest: string | null; crq_ignored: number; crq_resolved_range: number;
    vrq_pending: number; vrq_oldest: string | null; vrq_ignored: number; vrq_synced: number; vrq_resolved_range: number;
    unresolved_ports: number; blank_positions: number; blank_oldest: string | null; flag_issues: number;
    last_batch_fix: number | null; last_batch_at: string | null;
  };
  tasks: {
    queue_pending: number; queue_oldest: string | null; messages_unread: number; messages_oldest: string | null;
    expiring_3d: number; first_expiry: string | null; ports_unverified: number; ports_unverified_oldest: string | null;
    high_risk_7d: number; sanctioned: number; high_risk: number;
  };
  series: SeriesPoint[];
  thresholds: Partial<Record<ThresholdKey, number>> | null;
  /** get_admin_dashboard_events(p_days) — merged in by the page; null when the call failed */
  events?: EventsFeed | null;
};

export type JobRunRow = {
  id?: number; job: string; status: "running" | "succeeded" | "failed"; started_at: string; finished_at: string | null;
  rows: number | null; error: string | null; trigger: string | null;
};

export type EventsFeed = {
  first_event_at: string | null;
  events_total: number;
  range: { events: number; sessions: number; active_users: number; page_views: number; viewers: number };
  by_event: Record<string, number>;
  top_members: { name: string; company: string | null; n: number }[];
  devices: Record<string, number>;
  top_paths: { path: string; n: number }[];
  job_runs: { total: number; recent: JobRunRow[]; last_by_job: JobRunRow[]; failed_range: number; email_failed_range: number };
};

export type ThresholdKey = "worker" | "cron" | "email" | "sla" | "err" | "dbGrowth" | "adv" | "cache";
export type Thresholds = Record<ThresholdKey, number>;

/** Latest production deployment, when VERCEL_TOKEN + VERCEL_PROJECT_ID are set. */
export type VercelSnapshot = {
  state: string; // READY | ERROR | BUILDING | CANCELED | QUEUED
  created_at: string;
  ready_at: string | null;
  sha: string | null;
  message: string | null;
  branch: string | null;
  url: string | null;
  inspector_url: string | null;
};

/** Registry + DNS + SMTP facts about the platform domain (lib/admin/dashboard/domain.ts). */
export type DomainSnapshot = {
  domain: string;
  checked_at: string;
  registrar: string | null;
  registered_at: string | null;
  expires_at: string | null;
  changed_at: string | null;
  days_left: number | null;
  statuses: string[];
  nameservers: string[];
  dnssec: boolean | null;
  mx: { host: string; priority: number }[];
  spf: { present: boolean; record: string | null; all: string | null };
  dkim: { present: boolean; selector: string };
  dmarc: { present: boolean; policy: string | null; record: string | null; has_report: boolean };
  smtp: { host: string | null; port: number; reachable: boolean | null; ms: number | null; error: string | null };
  mailbox: string | null;
  cpanel_host: string | null;
  namecheap: { connected: boolean; auto_renew: boolean | null; locked: boolean | null; whois_guard: boolean | null; expired: boolean | null };
  errors: string[];
};

export type Level = "ok" | "warn" | "crit" | "info";

export type HistoryLine = { level: Level; when: string; text: string };

export type HealthChip = {
  id: string;
  name: string;
  state: string; // short upper-case state label (OK / AGING / DOWN / 8 ERR / N/A)
  level: Level;
  detail: string;
  sub: string;
  drawer: {
    subtitle: string;
    current: string;
    threshold: string;
    source: string;
    fix: { label: string; href: string; external?: boolean } | null;
    secondary: { label: string; href: string; external?: boolean } | null;
    history: HistoryLine[];
  };
};

export type Task = {
  id: string;
  section: string; // authorization id that owns the fix page
  what: string;
  n: number;
  age: string;
  level: Level;
  action: { label: string; href: string };
};

export type Alert = {
  id: string;
  level: "crit" | "warn" | "info";
  title: string;
  detail: string;
  when: string;
  chipId: string | null;
  href: string | null;
};
