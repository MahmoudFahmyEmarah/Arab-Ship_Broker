// Pure view-model helpers for the console dashboard — no server imports so the
// client component can re-derive chips/alerts when thresholds are edited.
import type {
  Alert, DashboardFeed, DomainSnapshot, HealthChip, HistoryLine, Level, RangeKey, Task, ThresholdKey, Thresholds, VercelSnapshot,
} from "./types";

export const RANGE_DAYS: Record<RangeKey, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };
export const RANGE_LABEL: Record<RangeKey, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days", "90d": "90 days" };
export const RANGE_KEYS: RangeKey[] = ["24h", "7d", "30d", "90d"];

export function parseRange(v: string | undefined | null): RangeKey {
  return (RANGE_KEYS as string[]).includes(v ?? "") ? (v as RangeKey) : "7d";
}

// ── Alert thresholds (persisted in app_settings.admin_alert_thresholds) ──
export const DEFAULT_THRESHOLDS: Thresholds = {
  worker: 60,   // WhatsApp worker silent, minutes
  cron: 1,      // scheduled run missed by, hours
  email: 24,    // email sync age, hours
  sla: 120,     // review-queue SLA, minutes
  err: 1,       // error rate, % (needs Vercel metrics)
  dbGrowth: 10, // database growth per week, MB (needs snapshots)
  adv: 1,       // error-level security findings, count
  cache: 36,    // match cache age, hours
};
export const THRESHOLD_META: Record<ThresholdKey, { label: string; unit: string }> = {
  worker: { label: "Worker silent", unit: "min" },
  cron: { label: "Cron missed by", unit: "h" },
  email: { label: "Email sync age", unit: "h" },
  sla: { label: "Queue SLA", unit: "min" },
  err: { label: "Error rate", unit: "%" },
  dbGrowth: { label: "DB growth / wk", unit: "MB" },
  adv: { label: "Error findings", unit: "n" },
  cache: { label: "Match cache age", unit: "h" },
};
export const THRESHOLD_KEYS = Object.keys(THRESHOLD_META) as ThresholdKey[];

export function normalizeThresholds(raw: unknown): Thresholds {
  const out: Thresholds = { ...DEFAULT_THRESHOLDS };
  if (raw && typeof raw === "object") {
    for (const k of THRESHOLD_KEYS) {
      const v = Number((raw as Record<string, unknown>)[k]);
      if (Number.isFinite(v) && v >= 0) out[k] = v;
    }
  }
  return out;
}

// ── formatting ─────────────────────────────────────────────────────────
export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-GB"));
export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

/** "12 m", "3 h 20 m", "2 d 4 h", "53 d" — how long ago `iso` was. */
export function ageOf(iso: string | null | undefined, now: Date): string {
  if (!iso) return "never";
  const ms = now.getTime() - new Date(iso).getTime();
  if (ms < MIN) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MIN)} m`;
  if (ms < 2 * DAY) {
    const h = Math.floor(ms / HOUR), m = Math.floor((ms % HOUR) / MIN);
    return m > 0 && h < 12 ? `${h} h ${m} m` : `${h} h`;
  }
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR);
  return d < 7 && h > 0 ? `${d} d ${h} h` : `${d} d`;
}
export function ageMs(iso: string | null | undefined, now: Date): number {
  return iso ? now.getTime() - new Date(iso).getTime() : Number.POSITIVE_INFINITY;
}

/** "2 Sep 23:00" in UTC (the platform's operational clock). */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).replace(",", "");
}
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
export function fmtClock(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
/** Same instant on the Cairo clock (Africa/Cairo, DST-aware) — the office time. */
export function fmtClockCairo(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Cairo" }).format(d);
  } catch {
    return fmtClock(new Date(d.getTime() + 2 * 3_600_000));
  }
}
export function fmtBucket(iso: string, hourly: boolean): string {
  const d = new Date(iso);
  return hourly ? `${String(d.getUTCHours()).padStart(2, "0")}:00` : fmtDay(iso);
}

// ── sparklines ─────────────────────────────────────────────────────────
export function sparkPoints(arr: number[], w = 80, h = 24) {
  if (arr.length === 0) return { points: "", lastX: "0", lastY: String(h - 2) };
  const mn = Math.min(...arr), mx = Math.max(...arr);
  const span = mx - mn || 1;
  const pts = arr.map((v, i) => [
    arr.length > 1 ? (i / (arr.length - 1)) * w : w,
    h - 2 - ((v - mn) / span) * (h - 4),
  ]);
  const last = pts[pts.length - 1];
  return { points: pts.map((p) => p.map((x) => x.toFixed(1)).join(",")).join(" "), lastX: last[0].toFixed(1), lastY: last[1].toFixed(1) };
}

// ── health chips ───────────────────────────────────────────────────────
const SUPABASE_URL = "https://supabase.com/dashboard/project/rezfejaxbmdzkslrrefr";

function chip(
  id: string, name: string, level: Level, state: string, detail: string, sub: string,
  drawer: HealthChip["drawer"],
): HealthChip {
  return { id, name, level, state, detail, sub, drawer };
}

const hist = (level: Level, when: string, text: string): HistoryLine => ({ level, when, text });

/** job_runs rows for one job (newest first), from the events feed. */
export function runsFor(feed: DashboardFeed, job: string, limit = 5): HistoryLine[] {
  const rows = feed.events?.job_runs.recent.filter((r) => r.job === job).slice(0, limit) ?? [];
  return rows.map((r) => hist(
    r.status === "succeeded" ? "ok" : r.status === "failed" ? "crit" : "warn",
    fmtWhen(r.started_at),
    r.status === "failed" ? `failed · ${r.error ?? "no error text"}` : r.status === "running" ? "running…" : `${r.rows ?? "—"} rows · ${r.trigger ?? ""}`.trim(),
  ));
}
export function lastRun(feed: DashboardFeed, job: string) {
  return feed.events?.job_runs.last_by_job.find((r) => r.job === job) ?? null;
}

export function domainLevel(d: DomainSnapshot): { level: Level; state: string; why: string[] } {
  const why: string[] = [];
  let level: Level = "ok";
  const bump = (l: Level, reason: string) => { why.push(reason); if (l === "crit" || (l === "warn" && level !== "crit")) level = l; };
  if (d.days_left != null && d.days_left < 14) bump("crit", `expires in ${d.days_left} d`);
  else if (d.days_left != null && d.days_left < 60) bump("warn", `expires in ${d.days_left} d`);
  if (!d.spf.present) bump("crit", "no SPF record");
  if (!d.dkim.present) bump("crit", `no DKIM key at selector ${d.dkim.selector}`);
  if (!d.dmarc.present) bump("warn", "no DMARC record");
  else if (d.dmarc.policy === "none") bump("warn", "DMARC p=none");
  if (d.smtp.host && d.smtp.reachable === false) bump("crit", `SMTP ${d.smtp.host}:${d.smtp.port} unreachable`);
  if (d.mx.length === 0) bump("crit", "no MX records");
  if (d.namecheap.expired) bump("crit", "domain expired at Namecheap");
  if (d.namecheap.auto_renew === false) bump("warn", "auto-renew is off");
  const state = level === "ok" ? "OK" : level === "crit" ? (d.days_left != null && d.days_left < 14 ? "EXPIRING" : "FAIL") : "CHECK";
  return { level, state, why };
}

export function buildChips(feed: DashboardFeed, th: Thresholds, now: Date, vercel: VercelSnapshot | null, domain: DomainSnapshot | null = null): HealthChip[] {
  const chips: HealthChip[] = [];
  const db = feed.db;

  // Database — reachable (the feed itself proves it)
  chips.push(chip("db", "Database", "ok", "OK",
    `Supabase reachable · ${db.size_mb} MB`, `${db.connections} / ${db.max_connections} connections`, {
      subtitle: "Supabase project · production",
      current: `Reachable. ${db.size_mb} MB on disk, ${db.connections} of ${db.max_connections} connections in use, ${db.functions} SQL functions, ${db.views} views, ${db.tables} tables.`,
      threshold: `Alert when unreachable, or growth > ${th.dbGrowth} MB / week (growth needs hourly size snapshots — not recorded yet).`,
      source: "pg_database_size() · pg_stat_activity · information_schema — read live by get_admin_dashboard()",
      fix: { label: "Open Supabase", href: SUPABASE_URL, external: true },
      secondary: { label: "Database reports", href: `${SUPABASE_URL}/reports/database`, external: true },
      history: [hist("ok", fmtClock(now), `Health check ok · ${db.size_mb} MB`)],
    }));

  // Deployment — Vercel, only when a token is configured
  if (vercel) {
    const level: Level = vercel.state === "READY" ? "ok" : vercel.state === "ERROR" || vercel.state === "CANCELED" ? "crit" : "warn";
    chips.push(chip("deploy", "Deployment", level, vercel.state,
      `Production · ${ageOf(vercel.ready_at ?? vercel.created_at, now)} ago`, `${vercel.sha?.slice(0, 7) ?? "—"} · ${vercel.branch ?? "—"}`, {
        subtitle: "Vercel · production",
        current: `Latest deployment ${vercel.state} from commit ${vercel.sha?.slice(0, 7) ?? "—"}${vercel.branch ? ` (${vercel.branch})` : ""}${vercel.message ? `: "${vercel.message}"` : ""}.`,
        threshold: "Alert on ERROR or CANCELED state.",
        source: "Vercel API · GET /v6/deployments?target=production (fetched on page load)",
        fix: vercel.inspector_url ? { label: "Open Vercel", href: vercel.inspector_url, external: true } : null,
        secondary: vercel.url ? { label: "View deployment", href: `https://${vercel.url}`, external: true } : null,
        history: [hist(level, fmtWhen(vercel.created_at), `${vercel.state} · ${vercel.sha?.slice(0, 7) ?? ""} ${vercel.message ?? ""}`.trim())],
      }));
  } else {
    chips.push(chip("deploy", "Deployment", "info", "N/A", "Vercel not connected", "set VERCEL_TOKEN + VERCEL_PROJECT_ID", {
      subtitle: "Vercel · production",
      current: "No Vercel token is configured on the server, so deployment state, error rate, latency and traffic cannot be shown. Add VERCEL_TOKEN and VERCEL_PROJECT_ID (optionally VERCEL_TEAM_ID) to the environment and this chip goes live.",
      threshold: "Alert on ERROR or CANCELED state once connected.",
      source: "Vercel API · GET /v6/deployments?target=production",
      fix: { label: "Open Vercel", href: "https://vercel.com/dashboard", external: true },
      secondary: null,
      history: [],
    }));
  }

  // Cron · matches
  const cacheAge = ageMs(feed.matches.computed_at, now);
  const cacheLevel: Level = cacheAge > th.cache * HOUR ? "crit" : cacheAge > (th.cache - 12) * HOUR ? "warn" : "ok";
  chips.push(chip("cron1", "Cron · matches", cacheLevel, cacheLevel === "ok" ? "OK" : cacheLevel === "warn" ? "AGING" : "STALE",
    `Refreshed ${fmtWhen(feed.matches.computed_at)} · ${fmtInt(feed.matches.n)} pairs`, `cache ${ageOf(feed.matches.computed_at, now)} old`, {
      subtitle: "Vercel cron · refresh-matches · daily 05:00 UTC",
      current: `Match cache holds ${fmtInt(feed.matches.n)} cargo–vessel pairs covering ${fmtInt(feed.matches.cargo_matched)} cargoes, last computed ${fmtWhen(feed.matches.computed_at)} UTC (${ageOf(feed.matches.computed_at, now)} ago).`,
      threshold: `Alert when the cache is older than ${th.cache} h.`,
      source: "max(matches.computed_at) · the cron writes no run log yet (proposed job_runs table)",
      fix: { label: "Run now", href: "/api/cron/refresh-matches", external: true },
      secondary: { label: "Analytics", href: "/admin/stats" },
      history: runsFor(feed, "refresh-matches").length ? runsFor(feed, "refresh-matches") : [hist(cacheLevel, fmtWhen(feed.matches.computed_at), `${fmtInt(feed.matches.n)} pairs computed`)],
    }));

  // Cron · Market Insights (Mondays 06:00 UTC)
  const insAge = ageMs(feed.insights.last_published_at, now);
  const insLevel: Level = insAge > (7 * 24 + th.cron) * HOUR ? "warn" : "ok";
  chips.push(chip("cron2", "Cron · insights", insLevel, insLevel === "ok" ? "OK" : "MISSED",
    `${feed.insights.last_week ?? "no edition"} · ${fmtDay(feed.insights.last_published_at)}`,
    `${fmtInt(feed.insights.editions)} editions · ${fmtInt(feed.insights.subscribers)} subscribers`, {
      subtitle: "Vercel cron · market-insights · Mondays 06:00 UTC",
      current: `Edition ${feed.insights.last_week ?? "—"} published ${fmtWhen(feed.insights.last_published_at)} UTC. ${fmtInt(feed.insights.editions)} editions in total; ${fmtInt(feed.insights.subscribers)} subscribers.`,
      threshold: `Alert when the Monday run is missed by more than ${th.cron} h (no edition within 7 days + ${th.cron} h of the last).`,
      source: "market_insights_editions.published_at · market_insights_subscribers",
      fix: { label: "Run now", href: "/api/cron/market-insights", external: true },
      secondary: { label: "Open Insights", href: "/insights" },
      history: runsFor(feed, "market-insights").length ? runsFor(feed, "market-insights") : [hist("ok", fmtWhen(feed.insights.last_published_at), `${feed.insights.last_week ?? ""} published`)],
    }));

  // Group Mail dispatcher (pg_cron */10)
  const gm = feed.cron_groupmail;
  const gmAge = ageMs(gm?.last_start, now);
  const gmLevel: Level = !gm || !gm.active ? "crit" : gm.failed_24h > 0 ? "warn" : gmAge > 20 * MIN ? "warn" : "ok";
  chips.push(chip("gm", "Group Mail", gmLevel, gmLevel === "ok" ? "OK" : gmLevel === "warn" ? "AGING" : "OFF",
    gm ? `Dispatcher every 10 min` : "pg_cron job missing", gm ? `last ${fmtClock(new Date(gm.last_start ?? 0))} · ${fmtInt(feed.groupmail.queued)} queued` : "—", {
      subtitle: "pg_cron · groupmail-dispatch · */10 * * * *",
      current: gm
        ? `Last tick ${fmtWhen(gm.last_start)} UTC (${gm.last_status ?? "—"}), ${fmtInt(gm.runs_24h)} runs in 24 h, ${fmtInt(gm.failed_24h)} failed. ${fmtInt(feed.groupmail.campaigns)} campaigns total, ${fmtInt(feed.groupmail.queued)} queued.`
        : "The groupmail-dispatch job is not scheduled in pg_cron.",
      threshold: "Alert when two consecutive ticks are missed (> 20 min silent) or any run fails.",
      source: "cron.job · cron.job_run_details · groupmail_campaign.status",
      fix: { label: "Open Group Mail", href: "/admin/group-mail" },
      secondary: { label: "Cron jobs", href: `${SUPABASE_URL}/integrations/cron/jobs`, external: true },
      history: runsFor(feed, "groupmail-dispatch").length ? runsFor(feed, "groupmail-dispatch") : gm ? [hist(gm.last_status === "succeeded" ? "ok" : "crit", fmtWhen(gm.last_start), `tick · ${gm.last_msg ?? ""}`)] : [],
    }));

  // Email ingest
  const emailAge = ageMs(feed.email.last_sync_at, now);
  const emailFailed = feed.events?.job_runs.email_failed_range ?? 0;
  const lastEmailRun = lastRun(feed, "email-sync");
  const emailLevel: Level = feed.email.enabled === false ? "info"
    : lastEmailRun?.status === "failed" ? "crit"
    : emailAge > th.email * HOUR * 3 ? "crit" : emailAge > th.email * HOUR ? "warn" : "ok";
  const emailBatches = feed.ingest.batches.filter((b) => b.source === "email").slice(0, 4);
  chips.push(chip("email", "Email ingest", emailLevel, emailLevel === "ok" ? "OK" : emailLevel === "warn" ? "AGING" : emailLevel === "crit" ? "STALE" : "OFF",
    lastEmailRun?.status === "failed" ? `Last run failed · ${fmtWhen(lastEmailRun.started_at)}` : `Last sync ${fmtWhen(feed.email.last_sync_at)}`,
    `${feed.email.enabled === false ? "disabled" : "IMAP on"} · ${ageOf(feed.email.last_sync_at, now)} ago${emailFailed ? ` · ${emailFailed} failed` : ""}`, {
      subtitle: "Email sync · IMAP · circ@ inbox",
      current: `Last successful sync ${fmtWhen(feed.email.last_sync_at)} UTC (${ageOf(feed.email.last_sync_at, now)} ago). Last batch ${fmtWhen(feed.email.last_batch_at)} is ${feed.email.last_batch_status ?? "—"}. Workbook upload last ${fmtWhen(feed.upload.last_sync_at)}.`,
      threshold: `Warn when the last sync is older than ${th.email} h; critical past ${th.email * 3} h or when the last run failed (IMAP/LLM errors land in job_runs).`,
      source: "sync_source_state.last_sync_at (email) · sync_batch · job_runs (email-sync)",
      fix: { label: "Data Sync", href: "/admin/data-sync" },
      secondary: { label: "Batches", href: "/admin/data-sync" },
      history: runsFor(feed, "email-sync").length ? runsFor(feed, "email-sync") : emailBatches.map((b) => hist(b.status === "undone" ? "crit" : b.errors > 0 ? "warn" : "ok", fmtWhen(b.created_at), `${b.new} new · ${b.updated} updated · ${b.invalid} invalid · ${b.status}`)),
    }));

  // WhatsApp worker
  const wa = feed.whatsapp;
  const waAge = ageMs(wa?.worker_seen, now);
  const waLevel: Level = !wa ? "info" : waAge > th.worker * MIN ? "crit" : wa.state === "connected" || wa.state === "ready" ? "ok" : "warn";
  chips.push(chip("wa", "WhatsApp worker", waLevel, waLevel === "ok" ? "OK" : waLevel === "crit" ? "DOWN" : waLevel === "warn" ? wa?.state?.toUpperCase() ?? "?" : "N/A",
    wa ? `Last seen ${fmtDay(wa.worker_seen)} · ${wa.state ?? "—"}` : "No runtime row", wa ? `silent ${ageOf(wa.worker_seen, now)} · ${fmtInt(wa.messages)} messages` : "—", {
      subtitle: "whatsapp_runtime · bridge worker state",
      current: wa
        ? `Worker last seen ${fmtWhen(wa.worker_seen)} UTC, state "${wa.state ?? "—"}"${wa.linked_as ? ` linked as ${wa.linked_as}` : ""}. ${fmtInt(wa.messages)} circulars received in total, last ${fmtWhen(wa.last_message_at)}; ${fmtInt(wa.in_range)} in the selected range.`
        : "The WhatsApp runtime table has no row — the bridge has never started.",
      threshold: `Critical when the worker is silent for more than ${th.worker} min.`,
      source: "whatsapp_runtime.worker_seen, state · whatsapp_message",
      fix: { label: "Re-pair worker", href: "/admin/data-sync" },
      secondary: { label: "Inbox", href: "/admin/data-sync" },
      history: [
        ...(wa ? [hist(waLevel, fmtWhen(wa.updated_at), `state → ${wa.state ?? "—"}`)] : []),
        ...runsFor(feed, "whatsapp-webhook", 3),
        ...(wa?.last_message_at ? [hist("ok", fmtWhen(wa.last_message_at), "last circular received")] : []),
      ],
    }));

  // LLM credential
  const llm = feed.llm;
  chips.push(chip("llm", "LLM credential", llm ? "ok" : "crit", llm ? "OK" : "MISSING",
    llm ? `${llm.vendor} · ${llm.model}` : "No active key", llm ? `key …${llm.key_hint ?? "????"} · set ${fmtDay(llm.updated_at)}` : "classification will fail", {
      subtitle: "llm_credential · active key (secret in Vault)",
      current: llm
        ? `Active vendor ${llm.vendor}, model ${llm.model}, key hint …${llm.key_hint ?? "—"}, saved ${fmtWhen(llm.updated_at)} UTC. Last-used and spend are not recorded by the pipeline yet.`
        : "No active LLM credential — circular classification and email extraction cannot run.",
      threshold: "Warn when no active credential exists, or on a vendor 401 (not captured yet).",
      source: "llm_credential (vendor, model, key_hint, is_active)",
      fix: { label: "Manage keys", href: "/admin/data-sync" },
      secondary: null,
      history: llm ? [hist("ok", fmtWhen(llm.updated_at), `${llm.vendor} key saved`)] : [],
    }));

  // Security posture (computed from pg_catalog)
  const sec = feed.security;
  const errN = sec.definer_views.length + sec.rls_off_tables.length;
  const secLevel: Level = errN >= th.adv ? "crit" : sec.definer_fn_anon > 0 || sec.mutable_search_path > 0 ? "warn" : "ok";
  chips.push(chip("sec", "Security", secLevel, errN > 0 ? `${errN} ERR` : secLevel === "warn" ? "WARN" : "OK",
    `${errN} error-level finding${errN === 1 ? "" : "s"}`, `${sec.definer_fn_anon} definer fns open to anon · ${sec.mutable_search_path} mutable path`, {
      subtitle: "Security posture · computed from pg_catalog",
      current: `${sec.definer_views.length} security-definer view${sec.definer_views.length === 1 ? "" : "s"} (${sec.definer_views.join(", ") || "none"}); ${sec.rls_off_tables.length} table${sec.rls_off_tables.length === 1 ? "" : "s"} without RLS${sec.rls_off_tables.length ? ` (${sec.rls_off_tables.join(", ")})` : ""}; ${sec.definer_fn_anon} security-definer functions executable by anon; ${sec.mutable_search_path} definer functions without a pinned search_path.`,
      threshold: `Critical when error-level findings ≥ ${th.adv}. Run the Supabase advisors for the full list (performance findings are not computed here).`,
      source: "pg_class.reloptions (security_invoker) · pg_class.relrowsecurity · pg_proc.prosecdef + has_function_privilege('anon')",
      fix: { label: "Supabase advisors", href: `${SUPABASE_URL}/advisors/security`, external: true },
      secondary: { label: "Platform settings", href: "/admin/settings" },
      history: [hist(secLevel, fmtDay(now.toISOString()), `${errN} error · ${sec.definer_fn_anon} definer fns open to anon`)],
    }));

  // Domain & mail (Namecheap registry + DNS + SMTP)
  if (domain) {
    const dl = domainLevel(domain);
    const mark = (ok: boolean) => (ok ? "✓" : "✗");
    chips.push(chip("domain", "Domain & mail", dl.level, dl.state,
      `${domain.registrar ?? "Registrar"} · expires ${fmtDay(domain.expires_at)}${domain.days_left != null ? ` (${domain.days_left} d)` : ""}`,
      `SPF ${mark(domain.spf.present)} DKIM ${mark(domain.dkim.present)} DMARC ${domain.dmarc.policy ?? "—"} · SMTP ${domain.smtp.reachable == null ? "—" : domain.smtp.reachable ? "ok" : "down"}`, {
        subtitle: `${domain.domain} · ${domain.registrar ?? "registrar"} · ${domain.nameservers.length ? domain.nameservers.join(", ") : "nameservers unknown"}`,
        current: `${domain.domain} is registered with ${domain.registrar ?? "an unknown registrar"} until ${fmtDay(domain.expires_at)}${domain.days_left != null ? ` (${domain.days_left} days)` : ""}. ` +
          `SPF ${domain.spf.present ? `present (${domain.spf.all ?? "?"}all)` : "missing"}, DKIM ${domain.dkim.present ? `signed (selector ${domain.dkim.selector})` : "missing"}, DMARC ${domain.dmarc.present ? `p=${domain.dmarc.policy ?? "?"}${domain.dmarc.has_report ? " with reporting" : " without reporting"}` : "missing"}. ` +
          `${domain.mx.length} MX host${domain.mx.length === 1 ? "" : "s"}; SMTP ${domain.smtp.host ?? "—"}:${domain.smtp.port} ${domain.smtp.reachable == null ? "not probed" : domain.smtp.reachable ? `reachable in ${domain.smtp.ms} ms` : `unreachable (${domain.smtp.error ?? "?"})`}. ` +
          (domain.namecheap.connected ? `Namecheap API: auto-renew ${domain.namecheap.auto_renew ? "on" : "off"}, lock ${domain.namecheap.locked ? "on" : "off"}, WhoisGuard ${domain.namecheap.whois_guard ? "on" : "off"}.` : "Namecheap API not connected (registry data comes from RDAP).") +
          (dl.why.length ? ` Findings: ${dl.why.join("; ")}.` : ""),
        threshold: "Critical when the domain expires within 14 days, SPF or DKIM is missing, MX is empty or the SMTP host is unreachable; warn within 60 days of expiry, when DMARC is missing or p=none, or auto-renew is off.",
        source: "RDAP (Verisign) · DNS TXT/MX/NS · TCP probe of the SMTP host · Namecheap API when NAMECHEAP_API_USER / NAMECHEAP_API_KEY / NAMECHEAP_CLIENT_IP are set · cached 10 min",
        fix: { label: "Namecheap domains", href: "https://ap.www.namecheap.com/domains/list", external: true },
        secondary: domain.cpanel_host ? { label: "cPanel", href: `https://${domain.cpanel_host}:2083`, external: true } : null,
        history: [
          ...(domain.changed_at ? [hist("ok", fmtDay(domain.changed_at), "registry record last changed")] : []),
          ...(domain.registered_at ? [hist("ok", fmtDay(domain.registered_at), "domain registered")] : []),
          ...domain.errors.map((e) => hist("warn", fmtDay(domain.checked_at), e)),
        ],
      }));
  }

  return chips;
}

// ── needs-your-action tasks ─────────────────────────────────────────────
export function buildTasks(feed: DashboardFeed, th: Thresholds, now: Date): Task[] {
  const t = feed.tasks, ing = feed.ingest, us = feed.users;
  const rows: Task[] = [];
  const add = (r: Task) => { if (r.n > 0 || r.id === "queue") rows.push(r); };

  const queueAge = ageMs(t.queue_oldest, now);
  add({ id: "queue", section: "review", what: `Review queue · SLA ${th.sla} min`, n: t.queue_pending,
    age: t.queue_pending > 0 ? `oldest ${ageOf(t.queue_oldest, now)}` : "clear · auto-approval rules",
    level: t.queue_pending === 0 ? "ok" : queueAge > th.sla * MIN ? "crit" : "warn",
    action: { label: "Queue", href: "/admin/queue" } });
  add({ id: "blank", section: "vesselavail", what: "Blank vessel positions (cannot match)", n: ing.blank_positions,
    age: `oldest ${ageOf(ing.blank_oldest, now)}`, level: "crit", action: { label: "Fix positions", href: "/admin/vessel-availability" } });
  add({ id: "vrq", section: "datasync", what: "Vessels without an IMO", n: ing.vrq_pending,
    age: `Manual Review · ${ageOf(ing.vrq_oldest, now)}`, level: "warn", action: { label: "Review", href: "/admin/data-sync" } });
  add({ id: "crq", section: "datasync", what: "Commodities to map", n: ing.crq_pending,
    age: `Manual Review · ${ageOf(ing.crq_oldest, now)}`, level: "warn", action: { label: "Map", href: "/admin/data-sync" } });
  add({ id: "drafts", section: "datasync", what: "Sync batches still in draft", n: ing.draft_batches,
    age: `oldest ${ageOf(ing.draft_oldest, now)}`, level: "warn", action: { label: "Commit or discard", href: "/admin/data-sync" } });
  add({ id: "fix", section: "datasync", what: "Rows needing a fix · last batch", n: ing.last_batch_fix ?? 0,
    age: fmtWhen(ing.last_batch_at), level: "warn", action: { label: "Open batch", href: "/admin/data-sync" } });
  add({ id: "msgs", section: "messages", what: "Unread contact messages", n: t.messages_unread,
    age: `oldest ${ageOf(t.messages_oldest, now)}`, level: ageMs(t.messages_oldest, now) > 2 * DAY ? "warn" : "info",
    action: { label: "Reply", href: "/admin/messages" } });
  add({ id: "ports", section: "cargo", what: "Live cargo without a LOCODE", n: ing.unresolved_ports,
    age: "port name did not resolve", level: "info", action: { label: "Resolve", href: "/admin/cargo" } });
  add({ id: "expiring", section: "cargo", what: "Listings with laycan ending within 3 days", n: t.expiring_3d,
    age: `first on ${fmtDay(t.first_expiry)}`, level: "info", action: { label: "Extend", href: "/admin/cargo" } });
  add({ id: "unverified", section: "ports", what: "Unverified ports", n: t.ports_unverified,
    age: `oldest ${ageOf(t.ports_unverified_oldest, now)}`, level: "info", action: { label: "Verify", href: "/admin/ports?filter=unverified" } });
  add({ id: "risk", section: "vessels", what: "High-risk or sanctioned vessels touched this week", n: t.high_risk_7d,
    age: `${fmtInt(t.sanctioned)} sanctioned · ${fmtInt(t.high_risk)} high-risk in register`, level: "crit",
    action: { label: "Inspect", href: "/admin/vessels?risk=HIGH" } });
  add({ id: "members", section: "orgmembers", what: "Company membership requests", n: us.membership_pending,
    age: `${ageOf(us.membership_oldest, now)} ago`, level: "info", action: { label: "Approve", href: "/admin/org-members" } });
  add({ id: "flags", section: "vessels", what: "Vessels with an unknown flag", n: ing.flag_issues,
    age: "not in the flag-state registry", level: "info", action: { label: "Fix flags", href: "/admin/vessels" } });

  const order: Record<Level, number> = { crit: 0, warn: 1, info: 2, ok: 3 };
  return rows.sort((a, b) => order[a.level] - order[b.level] || b.n - a.n);
}

// ── alerts (threshold breaches, newest first) ───────────────────────────
export function buildAlerts(chips: HealthChip[], feed: DashboardFeed, now: Date): Alert[] {
  const out: Alert[] = [];
  for (const c of chips) {
    if (c.level === "crit" || c.level === "warn") {
      out.push({ id: `chip-${c.id}`, level: c.level, title: `${c.name}: ${c.detail}`, detail: c.sub, when: c.state, chipId: c.id, href: null });
    }
  }
  if (feed.insights.subscribers === 0) {
    out.push({ id: "subs", level: "info", title: "Market Insights has 0 subscribers", detail: `${fmtInt(feed.insights.editions)} editions published to nobody`, when: feed.insights.last_week ?? "", chipId: "cron2", href: null });
  }
  if (ageMs(feed.upload.last_sync_at, now) > 14 * DAY) {
    out.push({ id: "upload", level: "info", title: `Workbook sync ${ageOf(feed.upload.last_sync_at, now)} old`, detail: `last upload ${fmtWhen(feed.upload.last_sync_at)}`, when: ageOf(feed.upload.last_sync_at, now), chipId: "email", href: "/admin/data-sync" });
  }
  if (feed.ingest.draft_batches > 0) {
    out.push({ id: "drafts", level: "info", title: `${feed.ingest.draft_batches} sync batch${feed.ingest.draft_batches === 1 ? "" : "es"} in draft`, detail: "staged rows never committed or discarded", when: ageOf(feed.ingest.draft_oldest, now), chipId: null, href: "/admin/data-sync" });
  }
  const order = { crit: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/** Zone label → design-token colour for the zone heat bars. */
export function zoneColor(zone: string): string {
  const key = zone.toUpperCase();
  const map: Record<string, string> = {
    "AG": "var(--zone-ag)", "E.MED": "var(--zone-emed)", "B.SEA": "var(--zone-bsea)", "R.SEA": "var(--zone-rsea-s)",
    "A.SEA": "var(--zone-asea)", "E.AFR": "var(--zone-eafr)", "ECAF": "var(--zone-eafr)", "C.MED": "var(--asb-steel)",
    "W.MED": "var(--asb-blue)", "ADRIATIC": "var(--asb-navy)",
  };
  return map[key] ?? "var(--asb-steel)";
}
