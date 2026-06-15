# Arab ShipBroker

A digital chartering & ship-brokering platform that connects **cargo owners**, **vessel owners**, and **brokers** — letting them list cargoes and vessel positions, discover counterparties through an authoritative matching engine, run voyage economics (P&L / TCE, Ports DA, Suez Canal toll), and consume a weekly market-insights edition. Counterparty contact details (the broker's core asset) are firewalled at the database layer so they are never leaked through the API or UI.

> Built with Next.js 16 (App Router) + React 19, Supabase (Postgres + Auth + RLS), and an optional Anthropic-powered document parser.

---

## Table of contents

1. [Overview](#overview)
2. [Objectives](#objectives)
3. [Features](#features)
4. [Technology stack](#technology-stack)
5. [Solution architecture](#solution-architecture)
6. [Design patterns](#design-patterns)
7. [Database & backend](#database--backend)
8. [Supabase services used](#supabase-services-used)
9. [Running locally](#running-locally)
10. [Running on the cloud (Supabase)](#running-on-the-cloud-supabase)
11. [Deploying to Vercel](#deploying-to-vercel)
12. [Connecting Vercel to a Namecheap domain](#connecting-vercel-to-a-namecheap-domain)
13. [CI/CD pipeline (GitHub → Vercel)](#cicd-pipeline-github--vercel)
14. [Environment variables](#environment-variables)
15. [Recommendations & roadmap](#recommendations--roadmap)

---

## Overview

Arab ShipBroker is a multi-tenant maritime marketplace and broker workbench. Three counterparty roles operate inside one portal:

- **Cargo owners** post cargo listings (commodity, quantity, laycan, load/discharge ports, DG/grain flags, draft limits).
- **Vessel owners** register vessels and publish open positions (open port/zone, open date, DWT, gear, certificates).
- **Brokers / admins** administer the marketplace, vet listings through a moderation queue, and broker introductions.

The platform's defining constraint is the **contact firewall**: a broker's value lives in who-knows-whom, so counterparty PII (owner/manager names, emails, phones) is never exposed to other members — enforced in Postgres via Row-Level Security, masked views, and `SECURITY DEFINER` RPCs, with a reproducible proof harness.

A public marketing site (home, services, market insights, contact) sits in front of an authenticated portal (`/dashboard/*`) and an admin console (`/admin/*`).

## Objectives

- **Replace spreadsheets & email circulars** with a structured, queryable marketplace for cargoes and vessel positions.
- **Authoritative matching** — one matching definition shared across every surface (cards, map, top-matches) so counts never disagree.
- **Protect the broker's book** — contact PII firewalled at the data layer, not just hidden in the UI.
- **Decision-support economics** — voyage P&L/TCE, port disbursement accounts (DA), and Suez Canal toll estimation in-app.
- **Market intelligence** — an immutable, dated weekly Market Insights edition generated automatically.
- **Trust & compliance** — email verification, role-based access, admin moderation, GDPR erasure/activity logging.

## Features

### Public site
- Marketing home with **live platform stats** (cargo/vessel/zone counts via a firewall-safe RPC, ISR-cached).
- Services, Market Insights (latest published edition), Contact form, Terms / Legal / Cookies pages.

### Authentication & onboarding
- Email + password signup with **OTP email verification**, password reset, account suspension handling.
- Role-aware routing in middleware (cargo owner / vessel owner / broker / admin).

### Member portal (`/dashboard`)
- **Cargo board** — browse, filter, create, edit, and manage "my" cargo listings.
- **Vessel registry** — register vessels, manage open positions/availability, browse counterparty vessels.
- **Matching engine** — Top Matches ranking and an interactive **Leaflet map** with cargo↔vessel pairing eligibility.
- **Voyage estimator** — voyage P&L / TCE calculator.
- **Ports DA** & **Suez Toll** calculators; **Ports** reference with coordinates and routes.
- **Circulars parser** — paste circular text or upload a Q88 PDF; an Anthropic model extracts structured cargo/vessel fields (optional feature).
- **Alerts**, **Team / org members**, and **Account** management.

### Admin console (`/admin`)
- Moderation **queue** for listing review/amend/strike, **users**, **org members**, **admins** (tiered sub-admins with per-section permissions).
- Reference data: **ports**, **commodities**, **cargo classification**, **safety questions**, **bunker prices**, **ETA**.
- **Dashboard / stats / ops stats**, contact **messages** inbox, vessel & vessel-availability administration.

### Automation
- **Weekly Market Insights cron** (`/api/cron/market-insights`, Mondays 06:00) calls a `SECURITY DEFINER` generator RPC that freezes an immutable, dated edition.

## Technology stack

### Frontend
| Concern | Technology |
|---|---|
| Framework | **Next.js 16** (App Router, RSC, route groups) |
| UI library | **React 19** |
| Styling | **Tailwind CSS v4** (`@tailwindcss/postcss`), `tw-animate-css` |
| Components | **shadcn/ui** + **Radix UI** primitives, `class-variance-authority`, `tailwind-merge`, `clsx` |
| Icons | **lucide-react** |
| Animation | **framer-motion**, `nextjs-toploader` |
| Forms & validation | **react-hook-form** + **zod** (`@hookform/resolvers`) |
| Maps | **Leaflet** + `leaflet.markercluster` |
| Notifications | **sonner** (toasts) |
| Spreadsheets | **xlsx** (data import/export) |

### Backend / platform
| Concern | Technology |
|---|---|
| Database | **Supabase Postgres** (RLS, views, RPCs, enums, triggers) |
| Auth | **Supabase Auth** (`@supabase/ssr`, `@supabase/supabase-js`) |
| Server logic | Next.js **Route Handlers** + **Server Actions** (Node runtime) |
| AI parsing | **Anthropic SDK** (`@anthropic-ai/sdk`, Claude Opus) — optional |
| Scheduling | **Vercel Cron** (`vercel.json`) |
| Tooling | **TypeScript 5**, **ESLint 9** (`eslint-config-next`), **tsx** for scripts, Python (seed generation) |

## Solution architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                            Browser                                 │
│   Public site  ·  Member portal (/dashboard)  ·  Admin (/admin)    │
└───────────────┬───────────────────────────────────┬──────────────┘
                │  HTTPS                              │
        ┌───────▼─────────────────────────────────────▼──────────────┐
        │                Next.js 16 on Vercel (Edge + Node)           │
        │                                                             │
        │  middleware.ts   →  auth gate, email-verify gate,           │
        │                     role-based routing, suspension check    │
        │                                                             │
        │  Route groups:   (public) (auth) (dashboard) (admin)        │
        │  Server Components / Server Actions  ─ lib/portal/actions   │
        │  Route Handlers  /api/* (circulars, ports, bunker, cron)    │
        │  SDK layer       sdk/* (typed data access over Supabase)    │
        └───────┬───────────────────────────────────────┬────────────┘
                │  anon key (RLS-scoped)                  │ service-role
                │                                         │ (server-only)
        ┌───────▼─────────────────────────────────────────▼──────────┐
        │                     Supabase Postgres                       │
        │  RLS policies · masked views (v_vessel_detail, cargos_*)    │
        │  SECURITY DEFINER RPCs (matching, stats, market insights)   │
        │  Contact firewall (PII admin/owner-only)                    │
        └─────────────────────────────────────────────────────────────┘
                │
        ┌───────▼────────────┐        ┌──────────────────────────────┐
        │  Anthropic API      │        │  Vercel Cron (weekly)         │
        │  (circular parser)  │        │  → /api/cron/market-insights  │
        └─────────────────────┘        └──────────────────────────────┘
```

### Key architectural decisions

- **Route groups by audience** — `(public)`, `(auth)`, `(dashboard)`, `(admin)` keep layouts, access rules, and shells isolated while sharing one Next.js app.
- **Three Supabase clients, by trust level** ([lib/supabase/](lib/supabase/)):
  - `browser.ts` — client components (anon key, RLS-scoped).
  - `server.ts` — server components/actions (cookie-bound session, anon key).
  - `admin.ts` — **service role**, server-only, bypasses RLS for trusted operations (signup, account deletion, cron). Never imported into client code.
- **Database is the source of truth for business rules.** Matching, public stats, and market-insights generation live in `SECURITY DEFINER` RPCs. Client-side logic ([lib/portal/matching.ts](lib/portal/matching.ts)) only *mirrors* the same hard gates for instant surfaces (map/top-matches); authoritative counts come from the DB RPCs (`get_matches_for_cargo` / `get_matches_for_availability`).
- **Contact firewall** ([supabase/tests/firewall/](supabase/tests/firewall/)) — counterparty PII is restricted at the role/RLS/grant level (masked `v_vessel_detail`, `cargos_access_view`, column grants), proven by a self-contained 12-check harness, not merely hidden in the UI.
- **Canonical user resolution** ([lib/app-user.ts](lib/app-user.ts)) — `public.users.id ≠ auth.uid()`; lookups resolve via `supabase_user_id` first to avoid login bounces.
- **Migrations as history** — ~70 ordered SQL migrations in [supabase/migrations/](supabase/migrations/) define the entire schema, RLS, RPCs, and firewall; a `seed/unified_dataset.sql` loads the real dataset (276 ports, 88 vessels, 27 open positions, 719 cargo).

### Repository layout

```
app/                 # App Router — route groups (public, auth, dashboard, admin) + /api
components/          # UI by domain (admin, portal, cargo, vessels, ui, market-insights …)
contexts/            # React context (DashboardContext — account + sidebar state)
lib/                 # Domain logic: portal/ (matching, econ, types), supabase/, schemas/, admin/
sdk/                 # Typed data-access layer over Supabase (auth, cargos, vessels, ports …)
supabase/            # migrations/ (ordered SQL), seed/, tests/firewall/ (proof harness)
scripts/             # Data import (xlsx → SQL) and seed generation
reference/           # Source workbooks, redesign prototype, dataset verification
middleware.ts        # Auth/role gate    vercel.json # cron config    next.config.ts
```

## Design patterns

- **Single Source of Truth** — one matching module + DB RPCs; every surface consumes them so counts never diverge.
- **Layered architecture** — UI (components) → SDK (data access) → Supabase (data + business rules), with clear boundaries.
- **Repository / Data-Access layer** — `sdk/*` wraps all Supabase queries behind typed functions (`submitCargo`, `getCurrentUser`, …).
- **Adapter pattern** — `lib/portal/adapters.ts` maps raw DB rows to portal "view" models (`CargoView`, `VesselView`).
- **Provider / Context** — `DashboardProvider` centralizes account + UI state for the portal.
- **Guard clauses** — `requireAdmin({ section, edit })` and middleware gates enforce access uniformly (tiered sub-admin permissions).
- **Schema-first validation** — zod schemas in `lib/schemas/*` validate forms and shape SDK payloads.
- **Strategy via SECURITY DEFINER RPCs** — privileged, firewall-safe operations are encapsulated in the database and invoked by name.
- **Defense in depth** — RLS + masked views + column grants + UI hiding all reinforce the contact firewall.

## Database & backend

The backend is **Postgres on Supabase**, defined entirely as code in [supabase/migrations/](supabase/migrations/) (~70 ordered files). The schema is **migration-driven** — there is no ORM; every table, enum, view, RLS policy, trigger, and RPC is plain SQL. Apply migrations in filename order, then seed with [supabase/seed/unified_dataset.sql](supabase/seed/unified_dataset.sql).

### Entity-relationship overview

```
                         auth.users (Supabase Auth)
                               │ supabase_user_id
                               ▼
        organizations ◄──┐  public.users ──┬───► profiles (cargo | vessel)
              │          │      │          │
   organization_members ┘      │           └──► user_activity_log (GDPR)
        (org_id, user_id)      │
              │                │ owner_user_id / owner_org_id
              ▼                ▼
        ┌───────────── listing_ownership ─────────────┐
        │  (polymorphic: listing_type + listing_id)   │
        └──────┬───────────────────────────┬──────────┘
               │                            │
        cargo_listings               vessel_availability
          │   │   │   │                  │        │
          │   │   │   └─ cargo_parcels   │        └─ FK vessel_id ─► vessels
          │   │   └───── cargo_safety_answers      │                   │
          │   └───────── FK commodity_id ─► commodities                └─ vessel_contacts
          │             FK load/disch_port_locode ─► ports ◄── FK open_port_locode
          │                                            │
          │                                            └─ port_routes (port-pair distances)
          └─ both cargo & vessel_availability ──► review_queue (moderation)

   commodities ─► commodity_map · grain_list · imsbc_codes · css_categories  (classification reference)
   bunker_prices ─► bunker_suppliers · bunker_ingest_accounts
   market_insights_editions · market_insights_subscribers      fuel_prices · voyage_estimates
   contact_messages (public contact form)
```

### Main tables

| Table | Purpose | Key columns / relationships |
|---|---|---|
| **users** | App-level user (≠ `auth.users`) | `id` (PK), `supabase_user_id` → `auth.uid()`, `role` (`user_role`), `access_tier`, `active` |
| **profiles** | Cargo/vessel persona per account | `account_id` → `users.id`, `profile_type` (cargo\|vessel), unique per `(account_id, profile_type)` |
| **organizations** | The company — carries subscription tier + **desk contact channel** | `org_type`, `subscription_tier`, `desk_email/phone` |
| **organization_members** | A person's seat in a company (M:N) | PK `(org_id, user_id)`, `member_role` (admin\|broker\|viewer) |
| **listing_ownership** | Polymorphic, durable ownership of a listing | `listing_type` + `listing_id`, `owner_user_id`, `owner_org_id`, `is_current`, one primary per listing |
| **cargo_listings** | A cargo on the market | `commodity_id` → commodities, `load/disch_port_locode` → ports, `qty_min/max_mt`, `laycan_*`, `review_status` |
| **cargo_parcels** | Multi-port parcels of a cargo | FK → `cargo_listings` |
| **cargo_safety_answers** | Answers to DG/grain safety questions | FK → `cargo_listings`, `question_id` → safety_questions |
| **vessels** | Admin-managed vessel **intelligence register** (owners don't insert here) | `imo_number` (unique), `vessel_type`, `dwt_grain/bale`, certs, **contact PII columns (firewalled)** |
| **vessel_availability** | An open position posted *against* a vessel | `vessel_id` → vessels, `open_port_locode` → ports, `open_date`, `status`, `review_status` |
| **vessel_contacts** | Per-vessel contact records (PII) | FK → vessels |
| **ports** | Port reference (LOCODE keyed) | `locode` (PK), `zone` (`zone_enum`), `latitude/longitude` |
| **port_routes** | Port-pair routing/distance | references ports |
| **commodities** | Canonical commodity catalogue | `imsbc_category`, `is_dg`, `is_grain`, `default_sf_m3t` |
| **commodity_map / grain_list / imsbc_codes / css_categories** | Cargo-classification reference data | feed `resolve_cargo_classification` |
| **safety_questions** | Configurable DG/grain question bank | `applies_to_cargo_type/categories`, `is_matchmaking_field` |
| **review_queue** | Moderation funnel for cargo & vessel listings | `listing_type` + `listing_id`, `status`, `action_taken` |
| **bunker_prices / bunker_suppliers / bunker_ingest_accounts** | Bunker (fuel) price feed + ingest auth | for the bunker ticker & voyage costs |
| **fuel_prices / voyage_estimates** | Voyage-estimator inputs & saved runs | — |
| **market_insights_editions** | Immutable, dated weekly editions | written by the cron RPC |
| **market_insights_subscribers** | Newsletter subscribers | — |
| **contact_messages** | Public contact-form submissions | — |
| **user_activity_log** | GDPR activity log / erasure trail | FK → users |
| *cargos* (legacy) | Original cargo table, superseded by `cargo_listings` | retained for migration history |

### Enums (controlled vocabularies)

`user_role` · `access_tier` · `access_granted_by` · `trust_tier_enum` · `zone_enum` (B.SEA, E.MED, AG, R.SEA, F.EAST …) · `port_type_enum` · `cargo_type_v2_enum` (Dry Bulk \| Break Bulk) · `imsbc_category_enum` · `answer_type_enum` · `vessel_type_enum` · `flag_category_enum` · `scope_enum` · `risk_level_enum` · `vessel_status_enum` (OPEN/FIXED/ON SUBS/INACTIVE) · `cargo_status_enum` · `cargo_priority_enum` · `review_status_enum` (PENDING/APPROVED/REJECTED/FLAGGED) · `load_terms_enum` · `ownership_role_enum` · `transfer_reason_enum` · `profile_type_enum`.

### Views (the firewall + read models)

| View | Role |
|---|---|
| `cargos_access_view` | Cargo rows with contact **NULLed unless admin or the listing's owner** ([20260601000100_…contact_firewall.sql](supabase/migrations/20260601000100_feature_columns_and_contact_firewall.sql)) |
| `v_vessel_detail` | Vessel specs visible to all members; contact PII masked to admin/owner ([20260601000600_prod_vessel_contact_firewall.sql](supabase/migrations/20260601000600_prod_vessel_contact_firewall.sql)) |
| `v_my_vessels` | The caller's own vessels + open positions |
| `v_account_profiles` | Account + its cargo/vessel profiles |
| `v_admin_queue` / `v_admin_queue_detail` | Moderation queue read models |

### RPCs (business logic in the database)

Privileged / firewall-safe logic lives in `SECURITY DEFINER` functions invoked by name. Notable ones (file → caller):

- **Matching:** `get_matches_for_cargo`, `get_matches_for_availability` — authoritative match funnel ([sdk/app/cargos.ts](sdk/app/cargos.ts), [sdk/app/vessels.ts](sdk/app/vessels.ts)).
- **Listings:** `create_cargo_listing`, `create_vessel_availability`, `register_vessel`, `set_listing_circulation`.
- **Classification:** `resolve_cargo_classification`, `validate_cargo_classification` ([sdk/app/classification.ts](sdk/app/classification.ts)).
- **Public stats (firewall-safe, anon):** `get_public_stats`, `get_public_platform_totals` ([app/(public)/page.tsx](app/(public)/page.tsx), [components/PublicStatsBar.tsx](components/PublicStatsBar.tsx)).
- **Market insights:** `fn_publish_market_insights_edition` (cron), `get_latest_market_insights`, `get_market_insights_edition`, `get_market_insights_archive` ([lib/market-insights.ts](lib/market-insights.ts), [app/api/cron/market-insights/route.ts](app/api/cron/market-insights/route.ts)).
- **Orgs / membership:** `fn_my_org_ids`, `fn_my_membership`, `fn_my_admin_org_id`, `fn_org_team`, `fn_org_manage_member`, `fn_search_organizations`, `fn_request_org_membership`, `fn_pending_membership_requests`, `fn_decide_org_membership` ([sdk/app/org.ts](sdk/app/org.ts), [app/(dashboard)/dashboard/account/company-actions.ts](app/(dashboard)/dashboard/account/company-actions.ts)).
- **Admin:** `get_admin_stats`, `get_admin_ops_stats`, `get_admin_activity`, `admin_set_bunker_credential`.
- **Bunker / positions:** `bunker_ingest`, `get_bunker_ticker`, `fn_position_checkin`.

### Backend guarantees to understand

- **`users.id ≠ auth.uid()`** — always resolve via `supabase_user_id` (see [lib/app-user.ts](lib/app-user.ts)). This is the single most common source of bugs.
- **RLS is on for every table**; the anon role can read only ports/commodities and the public-stats RPCs. Members read counterparty data through masked views, never base tables.
- **Listing review funnel** — new listings land `PENDING` in `review_queue`; admins approve/amend/strike (`goes_live_at` controls publication).
- **Triggers** — `fn_set_updated_at` maintains `updated_at`; `fn_va_port_autofill` derives port name/zone from LOCODE on insert/update.

## Supabase services used

This project uses Supabase as an integrated backend. Storage and Realtime are **not** used.

| Supabase service | Used? | Where (exact files) |
|---|---|---|
| **Postgres Database** | ✅ Core | All [supabase/migrations/](supabase/migrations/); data access throughout [sdk/](sdk/) and [lib/portal/data.ts](lib/portal/data.ts) |
| **Row-Level Security (RLS)** | ✅ Core | Policies in every migration; firewall in [20260601000100_…](supabase/migrations/20260601000100_feature_columns_and_contact_firewall.sql), [20260601000200_…](supabase/migrations/20260601000200_vessel_contact_firewall.sql); proof in [supabase/tests/firewall/](supabase/tests/firewall/) |
| **Database Functions / RPCs** (`SECURITY DEFINER`) | ✅ Core | Defined in migrations; called via `.rpc(...)` in [sdk/app/](sdk/app/), [lib/market-insights.ts](lib/market-insights.ts), [app/api/](app/api/), admin pages |
| **Auth — Email/Password** | ✅ | `signInWithPassword` ([sdk/auth.ts](sdk/auth.ts), [app/(dashboard)/dashboard/account/actions.ts](app/(dashboard)/dashboard/account/actions.ts)) |
| **Auth — Email OTP verification** | ✅ | `verifyOtp`, `resend` ([sdk/auth.ts](sdk/auth.ts), [app/(auth)/auth/verify-email/page.tsx](app/(auth)/auth/verify-email/page.tsx)) |
| **Auth — Password reset** | ✅ | `resetPasswordForEmail`, `updateUser` ([sdk/auth.ts](sdk/auth.ts)) |
| **Auth — Admin API** (service role) | ✅ | `auth.admin.createUser` / `deleteUser` ([sdk/auth.ts](sdk/auth.ts), [app/(dashboard)/dashboard/account/actions.ts](app/(dashboard)/dashboard/account/actions.ts)) |
| **Auth — Session in SSR** | ✅ | Cookie-bound session + middleware gate ([middleware.ts](middleware.ts), [lib/supabase/server.ts](lib/supabase/server.ts), [lib/admin/require-admin.ts](lib/admin/require-admin.ts)) |
| **Auth — client session/state** | ✅ | `getSession`, `onAuthStateChange` ([components/Navbar.tsx](components/Navbar.tsx), [components/footer-portal-link.tsx](components/footer-portal-link.tsx)) |
| **Supabase JS clients** (3, by trust level) | ✅ | browser anon ([lib/supabase/browser.ts](lib/supabase/browser.ts)), server cookie ([lib/supabase/server.ts](lib/supabase/server.ts)), service-role ([lib/supabase/admin.ts](lib/supabase/admin.ts)) |
| **Supabase SSR helper** (`@supabase/ssr`) | ✅ | [middleware.ts](middleware.ts), [lib/supabase/server.ts](lib/supabase/server.ts), [lib/admin/require-admin.ts](lib/admin/require-admin.ts) |
| **Storage** | ❌ | Not used — uploaded Q88 PDFs are streamed to the Anthropic API in-memory, not persisted |
| **Realtime / Channels** | ❌ | Not used — data refreshes via re-fetch / ISR |
| **Edge Functions** | ❌ | Not used — server logic runs as Next.js route handlers / server actions on Vercel |

## Running locally

**Prerequisites:** Node.js 20+, npm, and a Supabase project (free tier is fine).

```bash
# 1. Install dependencies
npm install

# 2. Configure environment — copy the template and fill in Supabase keys
cp .env.local.example .env.local   # then edit (see Environment variables below)

# 3. Set up the database (in the Supabase SQL editor):
#    a) run every file in supabase/migrations/ IN FILENAME ORDER (oldest → newest)
#    b) then run supabase/seed/unified_dataset.sql to load the real dataset

# 4. Run the dev server
npm run dev
```

Open <http://localhost:3000>.

- Public site: `/`, `/services`, `/market-insights`, `/contact`
- Sign up at `/auth/signup` → verify email (OTP) → `/dashboard`
- Admin tools under `/admin/*` (requires an admin-role account — see `supabase/seed/promote_admin.sql`)

> **Tip:** set the Supabase **Site URL** (Auth → URL Configuration) to `http://localhost:3000` so verification / reset links resolve in local dev.

**Useful scripts**

```bash
npm run build   # production build
npm start       # serve the production build
npm run lint    # eslint
```

See [RUN_LOCALLY.md](RUN_LOCALLY.md) for the detailed walkthrough.

## Running on the cloud (Supabase)

Supabase is the managed backend in every environment (there is no self-hosted DB step):

1. Create a project at [supabase.com](https://supabase.com).
2. **Apply migrations** — paste each file from `supabase/migrations/` into the SQL editor in order, or use the Supabase CLI:
   ```bash
   supabase link --project-ref <your-ref>
   supabase db push
   ```
3. **Seed** with `supabase/seed/unified_dataset.sql` (and `promote_admin.sql` to grant yourself admin).
4. Copy **Project Settings → API** keys into your `.env.local` (local) and into Vercel (production).
5. Under **Auth → URL Configuration**, set the **Site URL** to your production domain (and add localhost as an additional redirect for dev).

## Deploying to Vercel

The app is a standard Next.js project — Vercel is the recommended host (it also runs the cron in `vercel.json`).

### Option A — Dashboard (quickest)
1. Push the repo to GitHub.
2. In Vercel, **Add New → Project** and import the GitHub repo.
3. Framework preset auto-detects **Next.js** (build `next build`, output handled automatically).
4. Add **Environment Variables** (see the table below) for Production (and Preview/Development as needed).
5. **Deploy.** Vercel builds and assigns a `*.vercel.app` URL.

### Option B — Vercel CLI
```bash
npm i -g vercel
vercel login
vercel link            # link the local folder to a Vercel project
vercel env add NEXT_PUBLIC_SUPABASE_URL production   # repeat per variable
vercel --prod          # production deploy
```

### Cron note
`vercel.json` registers a weekly cron hitting `/api/cron/market-insights` (Mondays 06:00 UTC). Vercel Cron is available on its own plans; the route also accepts a manual `Authorization: Bearer <CRON_SECRET>` call so you can trigger it yourself. Set `CRON_SECRET` in Vercel to protect the endpoint.

### Post-deploy
- Set the Supabase **Site URL** to the Vercel/production domain so auth emails link correctly.
- Verify env vars are present for the **Production** environment (a missing `SUPABASE_SERVICE_ROLE_KEY` breaks signup/cron).

## Connecting Vercel to a Namecheap domain

Goal: serve the app on your custom domain (e.g. `arabshipbroker.com`) bought at Namecheap.

1. **In Vercel:** Project → **Settings → Domains → Add**. Enter your domain (add both `arabshipbroker.com` and `www.arabshipbroker.com`). Vercel shows the DNS records it needs.
2. **In Namecheap:** Dashboard → **Domain List → Manage → Advanced DNS**.
3. Add the records Vercel asks for. Typical setup:

   | Type | Host | Value | Notes |
   |---|---|---|---|
   | `A` | `@` | `76.76.21.21` | apex → Vercel (use the IP Vercel shows) |
   | `CNAME` | `www` | `cname.vercel-dns.com` | subdomain → Vercel |

   Remove Namecheap's default "parking"/URL-redirect records that conflict. Set **TTL** to Automatic.
   *(Alternatively, point Namecheap's **Custom DNS** / nameservers at Vercel's nameservers if you prefer Vercel to manage DNS entirely — Vercel will list them.)*
4. **Wait for propagation** (minutes to a few hours). Vercel auto-issues a **Let's Encrypt SSL** certificate once DNS validates.
5. In Vercel, choose the **primary** domain and let it redirect the other (e.g. `www` → apex or vice-versa).
6. Update the Supabase **Site URL** + redirect URLs to the final domain.

## CI/CD pipeline (GitHub → Vercel)

Yes — automatic deploys are straightforward. There are two clean approaches.

### Approach 1 — Vercel's native Git integration (recommended)
Vercel's GitHub app already gives you CI/CD with zero workflow code:

- **Push to `main`** → automatic **Production** deploy.
- **Open a PR / push to a branch** → automatic **Preview** deploy with a unique URL.
- Build logs, rollbacks, and instant promotion are in the Vercel dashboard.

Setup: connect the repo (see *Deploying to Vercel → Option A*). Optionally set Production Branch = `main` under **Settings → Git**. This is the least-maintenance option and what most Next.js teams use.

### Approach 2 — GitHub Actions (when you want gating: lint/tests/build before deploy)
Use this if you want to **block deploys on lint/build/tests** or add custom steps. Add `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Vercel
on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}

  deploy:
    needs: ci
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Vercel CLI
        run: npm i -g vercel
      - name: Pull Vercel env
        run: vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}
      - name: Build
        run: vercel build --prod --token=${{ secrets.VERCEL_TOKEN }}
      - name: Deploy
        run: vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
```

Add these **GitHub repo secrets** (Settings → Secrets and variables → Actions):
`VERCEL_TOKEN` (Vercel → Account → Tokens), `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (from `.vercel/project.json` after `vercel link`), plus any build-time `NEXT_PUBLIC_*` vars.

> If you use Approach 2, disable Vercel's automatic Git deploys for the production branch (Settings → Git → *Ignored Build Step* or disconnect auto-deploy) to avoid double-deploying.

## Environment variables

| Variable | Scope | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | ✅ | Anon key (RLS-scoped access) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client | ➖ | Newer publishable key (where used) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | ✅ | Privileged ops: signup, account deletion, cron. **Never expose to the client.** |
| `ANTHROPIC_API_KEY` | server | ➖ | Enables the AI circular/Q88 parser |
| `NEXT_PUBLIC_ASSISTANT_ENABLED` | client | ➖ | Set `true` to surface the assistant/parser UI |
| `CRON_SECRET` | server | ➖ | Bearer token guarding `/api/cron/market-insights` |

All secrets live only in `.env.local` (local) and in Vercel's Environment Variables (deployed) — `.env*` is git-ignored.

## Recommendations & roadmap

**Testing & quality**
- Add an automated test suite — currently the only formal test is the SQL firewall proof. Introduce unit tests for `lib/portal/matching.ts` and `econ.ts` (pure functions, high value), plus Playwright E2E for the auth → post → match flow.
- Wire the firewall proof (`supabase/tests/firewall/proof.sh`) into CI so a regression in RLS/grants fails the build.

**Type safety & DX**
- Generate TypeScript types from the Supabase schema (`supabase gen types typescript`) to replace the `Record<string, unknown>` casts in the SDK and `getAppUserRow`.
- Add a `CLAUDE.md` / `CONTRIBUTING.md` documenting the migration-order rule and the three-client trust model.

**Database & migrations**
- Adopt the Supabase CLI workflow (`supabase db diff` / `db push`) and a shadow database so migrations are validated in CI rather than pasted manually.
- Consider squashing the ~70 migrations into a baseline once the schema stabilizes (keep history in a tag).

**Performance & resilience**
- Add rate limiting + payload caps already partly present on `/api/circulars/parse`; extend to all route handlers.
- Cache the Anthropic system prompt (already using `cache_control`) and consider structured tool-use output instead of JSON-string extraction for the parser.
- Add observability (Vercel Analytics / Sentry) and structured logging on server actions and cron.

**Security**
- Move `next.config.ts`'s hardcoded `allowedDevOrigins` IP out of source / behind an env check.
- Add security headers (CSP, HSTS) via `next.config.ts` headers or middleware.
- Periodically re-run the firewall harness against the *live* schema, not just the migration SQL.

**Product**
- Promote the client-side matching mirror and DB RPC behind one typed SDK function to remove drift risk entirely.
- Add notifications/email on new matches (the `alerts` surface is a natural hook).
- Internationalization (Arabic/English) given the target market.

---

*Next.js 16 · React 19 · Tailwind v4 · Supabase · Anthropic — see [RUN_LOCALLY.md](RUN_LOCALLY.md) for the local setup walkthrough.*
