# Arab ShipBroker — Admin Console Dashboard: design brief for Claude Design

Prepared 4 Sep 2026 from a full read of the codebase and the live Supabase project.
Paste the section **"The prompt"** into Claude Design as-is; the sections before it are the evidence behind it.

---

## 1 · Why the current dashboard shows zeros

The console home calls three database objects — `get_admin_stats()`, `get_admin_activity(30)` and the view `v_admin_queue_detail`. All three were defined in a pre-baseline migration (April 2026) and were never re-created when the database was rebuilt around the workbook model, so every call failed silently and the page rendered `?? 0` for every tile. They are restored today (migration `20260904193900`), so the existing page now shows real numbers. That fixes the plumbing, not the design: the page is still eight count tiles, a queue list and a bar chart, with no health, behaviour, performance or infrastructure signal at all.

## 2 · What the platform is (context Claude Design needs)

Arab ShipBroker is a dry-cargo chartering marketplace for the Arab Gulf, Red Sea, Mediterranean and Black Sea. Members post **cargoes** (commodity, quantity, load/discharge ports, laycan) and **open vessels** (type, DWT, open port and date). The platform matches them, draws sea routes on a chart with Suez-toll and war-risk alerts, estimates voyage costs, publishes weekly Market Insights, and ingests broker circulars automatically from email and WhatsApp through an LLM pipeline reviewed by admins.

Tiers: T1 free (7-day market window) to T4 (60-day archive). Roles: broker, cargo owner, vessel owner, admin. Admin tiers: super (owner) and sub-admins with per-section permissions (sales, broker, accountant, IT).

## 3 · Data inventory (live, 4 Sep 2026)

| Domain | Source | Volume / state |
|---|---|---|
| Cargo listings | `cargo_listings` | 1,628 total; ~1,016 live in last 60 days; 149 have a matching vessel |
| Vessel positions | `vessel_availability` | 69 total, 51 open; 53 carry no open port or zone (blank positions) |
| Vessel register | `vessels` | 153 (flags normalised; IMO mandatory on sync) |
| Match cache | `matches` | 201 pairs, refreshed by cron daily 05:00 UTC |
| Ports & routes | `ports` 345 · `port_routes` 38,231 (438 measured ECDIS + 37,793 computed) · chokepoints flagged | |
| Risk areas | `risk_areas` | 6 admin-drawn zones (war / high-risk / advisory) |
| Users | `users` 21 (12 brokers, 3 vessel owners, 1 cargo owner, 5 admin) · `auth.users` 22 · tiers T1 16 / T4 5 | |
| Companies | `organizations` 89 · `organization_members` 1 | company module is young |
| Review queue | `review_queue` | 0 rows (auto-approval rules mean most posts go live) |
| Ingestion | `sync_batch` 11 · `sync_staged_row` 4,413 · `commodity_review_queue` 59 · `vessel_review_queue` 75 | email last sync 2 Sep 23:00; upload last 7 Aug |
| WhatsApp | `whatsapp_message` 10 · `whatsapp_outbox` 14 · `whatsapp_runtime` | worker last seen **13 Jul** (state: pairing) — effectively down |
| LLM | `llm_credential` | 1 active key (vendor/model/key hint) |
| Group Mail | `groupmail_campaign` 18 (all done) · pg_cron `groupmail-dispatch` every 10 min | |
| Market Insights | `market_insights_editions` 15, latest 2026-W35 · subscribers 0 · cron Mondays 06:00 UTC | |
| Contact | `contact_messages` 4 | |
| Audit | `sync_commit_audit` 203 · `record_edit_audit` 1 · `port_locode_backfill` 44 · `flag_normalization_backfill` 10 | |

Scheduled jobs: Vercel crons `refresh-matches` (daily 05:00) and `market-insights` (Mon 06:00); pg_cron `groupmail-dispatch` (*/10 min). API routes: bunker ingest, circular parse, contact, two crons, group-mail dispatch, port search, email sync (SSE), workbook upload, WhatsApp webhook. No Supabase edge functions. Database size 48 MB, 99 SQL functions, 9 views.

Supabase advisories today: 8 **error-level** (security-definer views: `v_live_cargo`, `v_live_vessels`, `v_admin_queue`, `v_cargo_match_counts`, `v_vessel_match_counts`, `v_eligible_matches`, `v_my_vessels`, `v_vessel_detail`), 99 warnings (82 security-definer functions executable by anon/authenticated, 15 mutable search_path, leaked-password protection off), 172 multiple-permissive-policy warnings, 22 RLS init-plan warnings, 26 unindexed foreign keys, 24 unused indexes.

## 4 · What is NOT captured yet (the dashboard must show these honestly)

- **User behaviour events**: no page-view, feature-use or funnel table exists. `auth.users.last_sign_in_at` is the only engagement signal. → Propose `platform_events` (user, session, event, target, meta, at).
- **Job run history**: crons write no run log. → Propose `job_runs` (job, started, finished, status, rows, error).
- **API/route metrics and Vercel data** (deployments, error rate, p75 latency, invocations, page views): available through the Vercel API/MCP, not stored. → Pull live or snapshot hourly.
- **Email ingest health**: only `sync_source_state.last_sync_at`; IMAP failures are not recorded.

## 5 · The prompt

> **Design an admin console dashboard for Arab ShipBroker, a dry-cargo chartering marketplace (Gulf, Red Sea, Mediterranean, Black Sea).** The dashboard is the home page of the admin console at `/admin/dashboard`, used daily by the owner (super admin) and occasionally by sub-admins (sales, broker, accountant, IT) whose visible sections are permission-gated.
>
> **Design system (mandatory).** Use the ASB design system tokens: primary navy `#0D2545`, steel blue `#2C5F8A`, blue `#24486B`, baby blue `#E6F1FB`, tonnage blue `#7BB8F0`, gray-50 canvas `#F5F7FA`, ink `#1A1A1A`, line `#DDE5F0`. Status ramp: green `#2E8B57`, amber `#A66A0C`, red `#A83A3A` with their tinted backgrounds. Font Inter with tabular numerals. Surfaces are "terminal cards": 2px ridge edge, 16px radius, soft navy-tinted shadow, 1px lift on hover. Buttons and inputs 10px radius with a blue focus ring; badges 11px/600 uppercase, tinted. The console has a navy left rail with white labels and a navy topbar. **No orange or yellow accents anywhere** — only the blue family for chrome, and amber/red/green strictly for status meaning. Density: 13px body, 11px labels; it is an operations screen, not a marketing page.
>
> **Purpose.** One screen that answers, in this order: *Is the platform healthy right now? What needs my action? How is the market doing? How are users behaving? How are performance and infrastructure?* The summary must read in five seconds; every number drills into the page that owns it.
>
> **Layout.** A fixed-height shell (rail + scrolling content). Top: a **command strip** of health chips. Then a two-column 12-grid: left 8 columns for market and operations, right 4 for actions and alerts, collapsing to one column under 1100 px and to a phone layout under 760 px where the rail becomes a top scroller. Give each section a header with a one-line explanation (tooltips are used throughout the product to educate users) and a time-range control (24h / 7d / 30d / 90d) that scopes the whole page. Show "as of" timestamps and a data-freshness indicator on every panel, and design explicit empty, loading and stale states (a stale panel greys and says how old its data is).
>
> **Section 1 — Command strip (health).** Chips with a state dot and a one-line detail: Database (Supabase reachable, size 48 MB, connections), Deployment (Vercel latest deploy, status, commit), Cron: match refresh (last run 05:00 UTC daily, rows written, age of the match cache), Cron: Market Insights (Mondays 06:00, latest edition 2026-W35), Group Mail dispatcher (pg_cron every 10 min), Email ingest (last sync 2 Sep 23:00; IMAP ok/fail), WhatsApp worker (last seen 13 Jul, state "pairing" → shown as DOWN), LLM credential (active vendor/model, key hint, last classification), Security advisories (8 error-level). Each chip opens a drawer with history and the fix link.
>
> **Section 2 — Needs your action.** A prioritised task list, not tiles: review queue with SLA (oldest item age, breach at 2 h), Manual Review queues (59 commodities to map, 75 vessels without IMO), rows needing fixing from the last sync batch, unread contact messages (4), pending company-membership requests, blank vessel positions that cannot match (53), listings expiring within 3 days, unverified ports, sanctioned or high-risk vessels touched this week. Each row: what, how many, how old, a primary action.
>
> **Section 3 — Market pulse.** Live cargo vs open tonnage over time (area chart, 7/30/90 d), posted per day (cargo, vessels, from email/WhatsApp vs members), matches available vs listings with no match, freshness mix (live 7 d / archive), zone heat (a small map or a ranked bar by trading zone: B.SEA, E.MED, R.SEA, AG…), size bands, top commodities, laycan horizon (how much cargo needs a ship this week/next), Suez and war-risk exposure (share of drawn routes raising an alert). Numbers must reflect the real scale: ~1,000 live cargoes, ~50 open vessels, ~200 matches.
>
> **Section 4 — Users & behaviour.** Sign-ups and activations over time, active users (daily/weekly), tier mix (T1 16, T4 5) and trust tiers (NEW/VERIFIED/FLAGGED), companies and seats, posting funnel (visited → posted → approved → matched → paired), feature usage (map routes drawn, estimates shown/declined, matches popup opened, voyage estimator runs, Suez calculator), retention cohorts, top members by activity, sessions by device. Be explicit that this section is fed by a new `platform_events` table; design it so it degrades gracefully to the sign-in data available today.
>
> **Section 5 — Ingestion & data quality.** Sync batches timeline (source, rows new/updated/invalid/errors, committed/undone), circular classification accuracy proxies (invalid rate, ignored rate), commodity and vessel review throughput, data-quality counters (unknown flags, ports not resolved to a LOCODE: 71 live cargoes, positions without zone, vessels without IMO), LLM spend/usage if the vendor reports it.
>
> **Section 6 — Growth & outreach.** Group Mail campaigns (18 sent; opens/bounces if available), Market Insights editions and subscribers (0 today — highlight as a gap), contact messages, public-site traffic (Vercel Web Analytics: views, top pages, referrers).
>
> **Section 7 — Performance & infrastructure.** Vercel: deployments with status, error rate, p75 response time per route, function invocations and duration, bandwidth; Supabase: database size and growth, connections, slow queries, table sizes, egress, auth sign-ins/failures; API route health (the ten routes listed above with request counts and error counts); cron run log (proposed `job_runs`); security posture (advisory counts by level with the top items and a "fix" link), RLS coverage, unused indexes, unindexed foreign keys.
>
> **Alerts.** A right-column alert feed with severities (critical/warn/info) and thresholds the design should make visible and editable in settings: worker silent > 1 h, cron missed, IMAP failure, queue SLA breach, error rate > 1 %, DB size growth, security advisory at error level, match cache older than 36 h.
>
> **Interaction.** Every tile is a link. Charts have hover values, a faint grid, and an emphasised last point. Use sparklines inside tiles for trend, and encode state in form (pill, stripe, dot), not only in colour. Provide a print/export of the top summary. Respect reduced motion.
>
> **Deliverables.** Desktop (1440), laptop (1280) and phone (390) layouts; component specs for chip, task row, tile with sparkline, chart card, alert item, freshness indicator; empty/stale/error states; a data-binding table listing for each widget its source (existing table/RPC, Vercel API, Supabase API, or proposed table).

---

## 6 · Implementation notes for after the design

- `get_admin_stats()` / `get_admin_activity()` restored today; extend with sync, ingest, worker and advisory fields rather than adding client-side fan-out.
- Add `platform_events` and `job_runs` tables (RLS: admin read, service write), a `logEvent()` helper in the portal, and make the two crons plus the email sync and WhatsApp worker write `job_runs`.
- Snapshot Vercel deployment/analytics data hourly into `infra_snapshots` so the dashboard does not call the Vercel API on every load.
- Fix the 8 security-definer views (switch to `security_invoker`) — they are error-level advisories today.

---

## 7 · Implemented (4 Sep 2026)

The design returned from Claude Design (`Admin Dashboard.html`) is now live at `/admin/dashboard`:

- **Feed** — `get_admin_dashboard(p_days)` (migration `20260904203209`), one admin-only RPC returning health, action counters, market pulse, users, ingestion, security posture (computed from `pg_catalog`) and a per-bucket time series (hourly for 24 h, daily otherwise). `get_admin_stats()` stays for the rail badges.
- **Page** — `app/(admin)/admin/dashboard/page.tsx` + `components/admin/dashboard/*` (command strip with drawer, needs-your-action, alerts with owner-editable thresholds stored in `app_settings.admin_alert_thresholds`, market / users / ingestion / growth / infrastructure panels), styles in `app/(admin)/admin-dashboard.css`.
- **Honest gaps** — Deployment, error rate, latency, invocations and public-site traffic show *not connected* until `VERCEL_TOKEN` + `VERCEL_PROJECT_ID` are set (`lib/admin/dashboard/vercel.ts`); feature-usage rows that need `platform_events` show "—"; the cron log is built from the timestamps each job leaves behind until a `job_runs` table exists.
- **Rail** — sidebar icons replaced with the design system's glyphs and the logo brand block (`components/admin/shell/icons.tsx`, `lib/admin/nav.ts`).

## 8 · platform_events + job_runs (5 Sep 2026)

- **Tables** — migration `20260904212310_platform_events_job_runs.sql`: `platform_events` (member-written through RLS, own uid only; admin read) and `job_runs` (service-role written; admin read), pruned nightly by pg_cron (`ops-tables-prune`: events > 365 d, runs > 90 d). `get_admin_dashboard_events(p_days)` folds both into the dashboard.
- **Portal hooks** — `lib/portal/events.ts` (`logEvent`, fire-and-forget, only when the member accepted functional storage, dropped when signed out): `page_view` (dashboard layout), `route_drawn` / `estimate_shown` / `estimate_declined` (chart), `match_popup`, `voyage_estimate`, `suez_calc` / `suez_export`.
- **Job hooks** — `lib/jobs/runs.ts` (`withJobRun`, `startJobRun`, `finishJobRun`): refresh-matches and market-insights crons, Group Mail dispatch tick, email sync (settled by the stream's done/error event, so IMAP/LLM failures are recorded), WhatsApp webhook, bunker ingest.
- **Dashboard** — Users panel shows sessions, page views, feature usage, top members and devices from events; the cron log, route runs/errors and the "Job failures" tile read job_runs; health-chip histories use job_runs when present and fall back to each job's own timestamps.
