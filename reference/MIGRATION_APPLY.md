# Migration apply runbook (this session's backend)

Apply in **timestamp order** (the filename number). Every migration here is
**idempotent** — `CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
`ON CONFLICT DO NOTHING`, `CREATE OR REPLACE` — so re-running or applying over a
partially-present schema is safe. Supabase tracks applied versions and skips
them, so you can also just `supabase db push` once the PRs are merged.

> Where they live now: `…000600`–`…000710`, `…000810`, `…000820` are on **main**.
> `…000800`, `…000830`, `…000840`, `…000850` are on **PR #3** (post-cargo).
> `…000860` is on **PR #4** (map). Merging both PRs puts them all on main; or run
> the SQL files straight from the branches now.

| Order | Migration | Unlocks | Verify (SQL editor) |
|---|---|---|---|
| 1 | `…000600_prod_vessel_contact_firewall` | Vessel **contact firewall** — PII columns revoked, masked `v_vessel_detail` gated on admin/owner | `SELECT pic_name FROM vessels LIMIT 1;` → permission error (good). `SELECT * FROM v_vessel_detail LIMIT 1;` works. |
| 2 | `…000700`–`…000705` (classification) | Cargo **classification engine** — `imsbc_codes`/`css_categories`/`grain_list`/`commodity_map`, resolver + guard RPCs, DG hard-block, 92 unmapped resolved | `SELECT public.resolve_cargo_classification('Wheat', true, true);` → GRAIN. `SELECT count(*) FROM commodity_map;` → ~118. |
| 3 | `…000710_ports_coordinates_full_backfill` | **Map coordinates** (fixes the spaced-locode bug → 0 matches) | `SELECT count(*) FROM ports WHERE latitude IS NOT NULL;` → ~275. |
| 4 | `…000800_org_model` | **Org model** — `organizations` + `organization_members` + `fn_my_org_ids()` + `listing_ownership.owner_org_id` + firewall extended to membership | `SELECT public.fn_my_org_ids();` → `{}`. `\d organizations`. |
| 5 | `…000810_public_stats_rpc` | **Landing counter** real counts (anon-safe) | `SELECT public.get_public_stats();` → `{cargo_count, vessel_count, zone_count}`. |
| 6 | `…000820_bunker_prices` | **Bunker** tables + `get_bunker_ticker()` + `bunker_ingest()` + admin credential RPC | `SELECT public.get_bunker_ticker();` → `[]`. `\d bunker_suppliers`. |
| 7 | `…000830_cargo_css_packing` | Break-bulk **CSS packing** persists + trust-tier auto-approve fix | `\d cargo_listings` shows `css_category`. |
| 8 | `…000840_org_seed` | **80 real companies** into `organizations` | `SELECT count(*) FROM organizations;` → 80. |
| 9 | `…000850_cargo_multiport` | **Multi-port** (`load_ports`/`disch_ports` jsonb) persists | `\d cargo_listings` shows `load_ports`, `disch_ports`. |
| 10 | `…000860_port_routes` | **Stored ECDIS routes** (map draws exact + distance matrix source) | `SELECT count(*) FROM port_routes;` → 20. |
| 11 | `…000870_org_vessel_link` | **Vessel → company link** — backfills `vessels.owner_org_id`/`manager_org_id` from `owner_company`/`manager_company` name-match (100% over the workbook); re-publishes `v_vessel_detail` with the gated org link + registry facts. Requires `…000840` (orgs) first. | `SELECT count(*) FROM vessels WHERE owner_org_id IS NOT NULL;` → >0. `SELECT owner_org_name, owner_org_fleet FROM v_vessel_detail WHERE owner_org_id IS NOT NULL LIMIT 1;` (as admin) returns the firm. |
| 12 | `…000880_org_member_claim` | **Member claim-on-signup** — `organization_members.status` + RPCs `fn_search_organizations` / `fn_request_org_membership` / `fn_my_membership` (self) and `fn_pending_membership_requests` / `fn_decide_org_membership` (admin). Requests are PENDING (is_current=false → no firewall access) until an admin approves. Requires `…000840`. | `SELECT public.fn_search_organizations('ship');` returns rows. `\d organization_members` shows `status`. |
| 13 | `…000890_org_member_domain_match` | **Email-domain hint + distributed approval** — `organizations.email_domains`, `organization_members.requested_email_domain`, `fn_is_org_admin`; pending list adds a `domain_match` hint and is visible to a company's own active admin (not just the platform admin). Requires `…000880`. | `SELECT domain_match FROM public.fn_pending_membership_requests() LIMIT 1;` (as admin). |
| 14 | `…000900_market_insights_query` | **Public Market Insights — firewall query** — `fn_build_market_insights(from,to)` (service_role only): aggregates-only jsonb, ≥5 floor → "Other", bands not exact. | `SELECT public.fn_build_market_insights(current_date-7, current_date-1);` (as service role) returns jsonb; no rows. |
| 15 | `…000910_market_insights_editions` | **Frozen weekly editions** — `market_insights_editions` (immutable once published, narrative editable), `fn_publish_market_insights_edition` (service_role), `fn_set_market_insights_narrative`, and anon read RPCs `get_latest_market_insights` / `_edition` / `_archive`. | `SELECT public.get_latest_market_insights();` (anon) → null until first publish. |
| 16 | `…000920_market_insights_subscribers` | **Weekly email capture** — `market_insights_subscribers` + anon `fn_market_insights_subscribe(email)`. *(Note: the public newsletter UI was later removed; the table + RPC remain available but are currently unused.)* | `SELECT public.fn_market_insights_subscribe('x@y.com');` → `{ok:true}`. |
| 17 | `…000930_public_stats_live` | **Landing live counters** — redefines `get_public_stats()` to the precise hero metrics: cargo = active listings with laycan overlapping today ±7d; vessels = OPEN+APPROVED availability; zones = distinct zones with ≥5 such cargoes. Server-side `CURRENT_DATE` (rolls daily), anon. | `SELECT public.get_public_stats();` (anon) → `{cargo_count, vessel_count, zone_count}` integers. |
| 18 | `…000940_vessel_gt_scnrt` | **Vessel GT + SCNRT** — adds `vessels.scnrt`, widens the GT check to 200–80,000, persists GT + SCNRT through `register_vessel`, and grants both as readable non-PII specs (contact firewall untouched). | `\d vessels` shows `scnrt`; register a vessel with GT/SCNRT → values stored. |

**Market Insights cron:** `vercel.json` runs `GET /api/cron/market-insights` every Monday 06:00 UTC; it computes the trailing Mon–Sun, derives the ISO `week_id`, and calls `fn_publish_market_insights_edition` via the service role. Set `SUPABASE_SERVICE_ROLE_KEY` (already needed for admin) and optionally `CRON_SECRET` (the route also accepts Vercel's `x-vercel-cron` header). To publish the first edition immediately: `curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/cron/market-insights`.

## After applying
- **Landing**: hero shows the real cargo/vessel/zone counts (was the fallback 167/62/14).
- **Map**: ports plot; selecting a cargo draws the sea-following route (exact ECDIS where stored).
- **Post Cargo**: classification auto-fill, CSS packing, MOL, multi-port all persist.
- **Bunker**: add a supplier + credential in **/admin/bunker**; the ticker reads live and the DEMO label drops.
- **Org**: companies are real; members fill in as users sign up.
- **Vessel ownership**: the detail-panel Ownership card shows the vessel's real owner + commercial manager (from the company registry) to the owner/admin; non-owner market viewers see the brokered/masked card. No more DEMO `orgForVessel` stub, no fabricated desk email.
- **Company membership**: signed-in users get a **Company** tab in account settings to search the registry and request to join their firm; the request shows as pending until a platform admin confirms it in **/admin/org-members**. Approval is what opens the firm's fleet/desk to that person (firewall gate).

## Also confirm (Vercel)
Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`, anon key) are set for the **Production** scope — else the live site builds but can't read the DB.

## Bosun AI Smart Assistant (commercial switch)
The assistant is fully built but ships in a **"Coming soon"** marketing state by
default. It's a paid capability (server-side Claude calls), so turning it on is a
commercial decision — flip two env vars, no code change:
- `NEXT_PUBLIC_ASSISTANT_ENABLED=true` — switches the widget from the
  "coming soon" teaser to the live paste/Q88 composer (build-time public flag).
- `ANTHROPIC_API_KEY=…` — server key the `/api/circulars/parse` route needs to
  actually read circulars / Q88 PDFs.
Leave both unset to keep the polished teaser only. The GT/SCNRT and all form
fields work regardless — the assistant just fills them when enabled.
