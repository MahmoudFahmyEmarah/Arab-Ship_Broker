# Developer Onboarding & Handover — Arab ShipBroker

> Read this **before** the README. The README describes the intended architecture; this doc tells you the **current reality**, the gotchas that will bite you, and exactly where the project stands today. Last updated: **2026-07-14**.

---

## 1. 60-second orientation

Arab ShipBroker is a **maritime chartering marketplace + broker workbench** built on **Next.js 16 (App Router, React 19)** and **Supabase (Postgres + Auth + RLS)**. Three audiences share one app behind route groups:

- **Public site** — marketing pages + live platform stats (`app/(public)`).
- **Member portal** (`/dashboard/*`) — cargo owners post cargoes, vessel owners post open positions, everyone runs matching + voyage economics.
- **Admin console** (`/admin/*`) — moderation, reference data, and **Data Sync** (the bulk data-ingestion pipeline — see §6; this is how most data actually enters the platform).

The defining constraint is the **contact firewall**: counterparty PII (owner/manager names, emails, phones) is masked at the Postgres layer (RLS + masked views + column grants), never just hidden in the UI.

**The single most important rule:** `public.users.id` **≠** `auth.uid()`. Always resolve a user via `supabase_user_id` (see `lib/app-user.ts`). This is the #1 source of bugs.

---

## 2. Access the owner must grant you

Ask the project owner for:

| Item | What you need |
|---|---|
| **GitHub** | Collaborator access to the repo (push + PR). Default branch is `main`. |
| **Supabase** | Access to the project (ref **`rezfejaxbmdzkslrrefr`**, region ap-northeast-1) — or your own throwaway project for local dev. |
| **Vercel** | Team/project access if you'll deploy or read logs. |
| **Secrets** | The `.env.local` values (below). The owner shares these **securely** (password manager / encrypted), never in chat or git. |
| **The CargoMap workbook** | `ArabShipBroker_UNIFIED_CargoMap_<date>.xlsx` — the authoritative data source for the Data Sync pipeline (see §6). |

Environment variables you'll be given (full list + purpose in the README):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (**server-only, privileged**), and optionally `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_ASSISTANT_ENABLED`, `CRON_SECRET`.

---

## 3. Local setup (quick)

```bash
npm install
cp .env.local.example .env.local      # fill in the Supabase keys the owner gave you
npm run dev                            # http://localhost:3000
npx tsc --noEmit                       # typecheck (do this before every commit)
npm run lint                           # eslint
```

- To point at the **shared** Supabase project, use its URL + keys. To run a **local** DB, create your own Supabase project and apply `supabase/migrations/` in filename order, then `supabase/seed/`.
- Set the Supabase **Auth → Site URL** to `http://localhost:3000` so email links resolve in dev.
- Admin pages need an admin-role account (`supabase/seed/promote_admin.sql`).

---

## 4. Must-know architecture (the 5 things that matter)

1. **Three Supabase clients, by trust level** (`lib/supabase/`):
   - `browser.ts` — client components, anon key, RLS-scoped.
   - `server.ts` — server components/actions, cookie-bound session, anon key.
   - `admin.ts` — **service role, server-only**, bypasses RLS. Never import into client code. The admin console + Data Sync use this.
2. **`users.id` ≠ `auth.uid()`** — resolve via `supabase_user_id` (`lib/app-user.ts`). Say it again because you'll forget.
3. **The database is the source of truth for business rules.** Matching, public stats, listing creation, and Data Sync commits are all `SECURITY DEFINER` RPCs invoked by name. Client TS only *mirrors* gates for instant UI.
4. **Contact firewall** — counterparty PII is masked via `v_vessel_detail` / `cargos_access_view` + column grants + `fn_is_vessel_owner` / `is_admin()`. If you add a column that could be PII, add it to the firewall's PII list. There's a proof harness in `supabase/tests/firewall/`.
5. **Route groups** — `(public)` `(auth)` `(dashboard)` `(admin)`. `middleware.ts` gates auth/role/verification. Admins are allowed on both `/dashboard` and `/admin`.

---

## 5. ⚠️ Current state — code ↔ DB drift (read this carefully)

The live database was **rebuilt around a baseline migration + the Data Sync / CargoMap model**, and in that rebuild several objects the front-end code expects were **dropped**. Some were restored this session; some are **still missing**. Do **not** assume the migration files fully match the live DB — **verify against the live schema** (Supabase dashboard / SQL editor) before building on any RPC/table/column.

| Area | Status | Notes |
|---|---|---|
| **Add Vessel** (`register_vessel`) | ✅ Restored this session | Migration `20260713165215`. Works end-to-end. |
| **Post Position** (`create_vessel_availability`) | ✅ Restored this session | Migration `20260713170729`. |
| **Vessel master / availability tables, `v_vessel_detail`, `v_my_vessels`, `vessel_claims`, `vessel_contacts`** | ✅ Restored this session | Were missing; rebuilt faithfully incl. the firewall. |
| **Add Cargo** (`create_cargo_listing`) | ❌ **Still missing on the live DB** | `submitCargo` → `create_cargo_listing` RPC does not exist → posting cargo via the portal fails. Also `cargo_listings` is missing ~7 code-expected columns (`packaging_type`, `css_category`, `volume_cbm`↔`volume_m3` mismatch, `tolerance_pct/holder`, `laytime_basis`, `commission_ttl_pct`). **This is the next big restore task** — mirror the Phase-1 vessel approach. |
| **Data Sync auto-approve** | ✅ Added this session | `commit_sync_batch` now marks synced cargo/availability `APPROVED` (mig `20260714110801`). |
| **02_VESSELS → availability ingestion** | ✅ Added this session | `sync_vessel_positions` RPC + "Post open positions" button (mig `20260714133126`). |

**Why the home-page counts can read 0 even with data loaded:** `get_public_stats()` counts only listings that are `review_status='APPROVED'` **and** "available this week" (laycan/open-date within ±7 days, or spot/undated posted within the configurable `spotActiveDays`/`vesselActiveDays`, default 14). Admin-synced data now auto-approves, but if its dates are historical it still won't count. This is by design ("available this week"), not a bug.

---

## 6. The Data Sync pipeline (`/admin/data-sync`) — central, and under-documented

Most real data enters the platform here, **not** through the portal forms. Flow:

1. **Upload** the CargoMap workbook (`.xlsx`). Sheets map to tables: `01_CARGO → cargo_listings`, `02_VESSELS → vessels`, `03_COMPANIES → organizations`, `04_PORTS → ports`, `05_CLASS_MARKET_NAME → commodities`.
2. **Stage & classify** — each row is parsed (`lib/sync/`), diffed against live data, and marked `new` / `updated` / `unchanged` / `invalid`, kept in `sync_staged_row` (with the full original `raw` row).
3. **Review** — the admin sees per-sheet diffs, edits invalid rows in place (re-validates), and commits. Checkboxes enable **row-by-row selective sync** (a selection toolbar shows "Sync N selected"); the big per-sheet button syncs all committable rows in that sheet.
4. **Manual Review** — three queues: unmapped **Commodities**, IMO-less **Vessels**, and (added this session) **"Needs fixing"** = invalid staged rows grouped by category (Cargo/Vessels/Ports/…), fixable in place.
5. **Commit** — `commit_sync_batch` RPC writes to live tables (reversible via `undo_batch`), now auto-approving marketplace listings.
6. **Vessels extra** — the "Post open positions" button turns `02_VESSELS` `STATUS=Open` rows into `vessel_availability` postings via `sync_vessel_positions`.

**Key files:** `lib/sync/sheets.ts` (the sheet→table registry + column transforms/validation — the practical "source of truth" mapping), `lib/sync/stage.ts`, `lib/sync/diff.ts`, `lib/sync/preview.ts`, `app/(admin)/admin/data-sync/actions.ts`, `components/admin/data-sync/*`.

**The workbook's `11_VALIDATION` and `09_VESSEL_FIELD_SPEC` tabs are the business "source of truth" for field rules** — check them when adding/adjusting validation. Note some code vocabularies have drifted from the workbook (e.g. `LOAD_TERMS` in `lib/schemas/cargo.ts` is missing `FIOS LSD` / `Liner Terms` that the DB enum + workbook use — such rows are routed to "Needs fixing" rather than silently dropped).

---

## 7. What changed this session, and what's UNCOMMITTED

⚠️ **A large amount of work is currently uncommitted in the working tree.** Before you start, sync with the owner and get this committed so you have a clean base. Summary:

**DB migrations applied to the live project _and_ saved as repo files** (`supabase/migrations/`):
- `20260713165215_restore_vessel_registration_subsystem.sql`
- `20260713170729_restore_vessel_availability_rpc.sql`
- `20260713171045_extend_vessel_status_and_zone_enums.sql`
- `20260713172155_harden_vessel_subsystem_functions.sql`
- `20260714110801_sync_commit_auto_approve_listings.sql`
- `20260714133126_sync_vessel_positions_rpc.sql`

**Code changed/added:**
- Add-vessel flow: `app/(dashboard)/dashboard/vessels/register/page.tsx` + `.../availability/new/page.tsx` (admin allowed on guard); `components/vessels/VesselCreateForm.tsx` + `lib/schemas/vessel.ts` (DWT→30k, required DWT/LOA/volume, IMO gate, name-prefix strip, CBM/CBFT toggle, FUEL/STATUS enum unions, `stripVesselNamePrefix`); `lib/geo/countries.ts` (new — flag/P&I lists); `sdk/app/vessels.ts` (grab/brob wiring).
- Data Sync: `components/admin/data-sync/ManualReviewView.tsx` ("Needs fixing" tab), `components/admin/data-sync/StagedEditDrawer.tsx` (new — shared editor), `DataSyncClient.tsx` ("Post open positions" button), `app/(admin)/admin/data-sync/actions.ts` (`listInvalidStaged`, `countInvalidStagedPending`, `syncVesselPositions`), `lib/sync/sheets.ts` (commodities `cargo_type`/`imsbc_category` derive).
- Marketing: `components/FoundersCarousel.tsx` (new — shared 3D carousel), `app/(public)/home-client.tsx` + `app/(public)/contact/page.tsx` (both use it now).

**A live data change:** 158 sync-committed cargo listings were bulk-approved (`review_status PENDING → APPROVED`) so the home count reflects them.

---

## 8. Known issues / suggested next tasks

1. **Restore the Add-Cargo subsystem** (highest priority) — recreate `create_cargo_listing` + the missing `cargo_listings` columns, mirroring the Phase-1 vessel restore. See §5.
2. **Reconcile code vocabularies with the workbook `10_ENUMS`/`11_VALIDATION`** — e.g. `LOAD_TERMS`, and confirm `vessel_type` "Cargo Ship" ↔ "General Cargo" aliasing end to end.
3. **"Needs fixing" tab batch scope** — it currently targets the latest _draft_ batch; broaden to include the most recent committed batch's remaining invalid rows.
4. **Type safety** — replace `Record<string, unknown>` casts with generated types (`supabase gen types typescript`).
5. See the README's **Recommendations & roadmap** for the broader backlog (tests, CI firewall proof, observability, i18n).

---

## 9. Working conventions

- **Migrations:** timestamped SQL in `supabase/migrations/`, applied in order. The live DB may be **ahead of / different from** some files — verify live before relying on an object. When you change the schema, add a new migration (never edit an applied one) and keep the repo file's version aligned with what's actually applied.
- **Before committing:** `npx tsc --noEmit` **and** `npm run lint` must be clean. Verify runtime behavior for non-trivial changes, not just types.
- **Branch/PR:** work on a branch, PR into `main`; pushing to `main` triggers a Vercel production deploy.
- **Don't weaken the firewall** — any new counterparty-contact column must be added to the PII lists in the firewall view/grants, and ideally re-checked with `supabase/tests/firewall/`.
- **Server-only secrets** — `SUPABASE_SERVICE_ROLE_KEY` and `admin.ts` never reach client bundles.

---

## 10. Where to find things

```
app/(public|auth|dashboard|admin)/   route groups + /api
components/                           UI by domain (admin, portal, cargo, vessels, ui, data-sync …)
lib/                                  domain logic: portal/, supabase/, schemas/, sync/ (Data Sync), admin/, geo/
sdk/                                  typed data-access layer over Supabase
supabase/migrations/                  ordered SQL (schema, RLS, RPCs, firewall)
supabase/tests/firewall/              contact-firewall proof harness
scripts/                              xlsx → SQL import + seed generation
ONBOARDING.md (this file) · README.md (full architecture) · RUN_LOCALLY.md (local walkthrough)
```

Welcome aboard. When in doubt: **verify against the live DB**, and remember `users.id ≠ auth.uid()`.
