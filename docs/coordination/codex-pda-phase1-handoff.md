# PDA Estimator Phase 1 — implementation handoff for Fixture Room audit

Date: 2026-09-23

Branch: `feature/pda-estimator`

Base: `dev` at `6eca79b`

Owner: Codex

Fixture Room owner: Opus (separate worktree/branch)

## Outcome

The former King Abdullah-only, hard-coded Port DA screen is replaced by a governed estimator. It uses exact port/terminal/date tariff selection, a deterministic pure calculation engine, evidence on every published line, explicit manual-quote states, and immutable saved snapshots. No source file from `Port Tarifs/` is auto-published.

## Fixture Room contract to audit

- Stable estimate header columns: `id`, `port_locode`, `terminal_name`, `tariff_version_id`, `coverage`, `native_currency`, `native_total`, `converted_currency`, `converted_total`, `generated_at`.
- `public.fn_can_read_pda_estimate(uuid)` is the cross-module authorization helper. It is `security definer`, evaluates the current app user/org, and deliberately has no direct `authenticated` execute grant.
- `public.get_pda_estimate(uuid)` is the governed member read RPC.
- Fixture Room must not read `pda_estimates` or `pda_estimate_lines` directly; both tables have RLS enabled and no member table grants.
- The optional Fixture Room PDA reference remains integration-owned. Add it only in a `2026092330xxxx` migration after both branches merge; validate attachment with `fn_can_read_pda_estimate` and do not cascade-delete an estimate.

## Owned files

- `lib/pda/types.ts`, `schemas.ts`, `calculate.ts`
- `sdk/app/pda.ts`
- `components/pda/PdaEstimator.tsx`, `pda.css`
- `app/(dashboard)/dashboard/ports-da/**`
- `app/(admin)/admin/port-tariffs/**`
- migrations `20260923100000` through `20260923103000`
- `supabase/rollback/20260923_pda_down.sql`
- PDA scripts/tests and this document

## Database design

- Evidence: publishers and SHA-256-deduplicated source documents.
- Intake: import batches and staged rules. Extracted PDF/spreadsheet data is untrusted and has no publication side effect.
- Tariffs: exact port/optional verified terminal sets, effective-dated versions, typed rules and bands.
- Publication: maker creates/edits a draft; submission freezes its children; a different super-admin checker publishes it. Only official, agent-issued, or statutory sources may publish. Overlapping dates require explicit supersession.
- Estimates: immutable header and line snapshots; totals, rule/version ownership, source evidence, organization ownership and member tier are revalidated server-side.

## `Port Tarifs/` inventory

`scripts/pda-inventory-sources.mjs` found 20 candidate files:

- 11 PDF
- 6 DOCX
- 2 XLSX
- 1 XLS

The two `Circular 1 - 2026` PDFs are byte-identical (`f171b583c9d2eb163dd08e8d687ad22dacf3a3d787b3141d39cc3822db4a3fb7`). They will deduplicate at source registration. Every file remains `unverified` until an admin records authority, effective dates, exact port/terminal mapping and line evidence.

## Shared integration requests (not changed on this branch)

1. Add `{ id: "porttariffs", href: "/admin/port-tariffs" }` to the admin section registry and decide whether it is owner-only or delegated. Phase 1 conservatively reuses the owner-only `datasync` gate.
2. Add Port Tariffs to desktop/mobile admin navigation.
3. Add PDA test commands to `package.json` after branch integration.
4. Regenerate typed Supabase RPC/table definitions if this project adopts generated types.
5. Add the optional Fixture Room → PDA reference in integration migration range `2026092330xxxx`, not on either feature branch.
6. Decide the canonical database flag for the previously approved “market partner” entitlement. The active schema currently exposes T3/T4 and admin; the implementation fails closed until a real field exists.

## Verification completed

- `node --import tsx scripts/pda-check.ts` — pass.
- `node scripts/pda-sql-contract-check.mjs` — pass.
- `tsc --project tsconfig.pda.json --pretty false` — pass.
- Targeted ESLint for all PDA TypeScript/TSX files — pass.
- TypeScript syntax transpilation check — pass.
- Tariff source inventory and duplicate hashing — pass.
- `git diff --check` — pass for tracked changes.

## Open environment gates

- Executable migration/catalog smoke test: not yet run after the final SQL changes because Docker Desktop returns HTTP 500 for both API v1.54 and v1.47. The ready test is `supabase/tests/pda/contract.sql`.
- Production webpack build: application compilation passed. The repository-wide Next type phase then failed on the pre-existing, unrelated export `BUDGET_MS` in `app/api/cron/dq-nightly/route.ts`; PDA-focused typecheck remains green.
- Browser visual QA: the installed browser skill path was unavailable, and database-backed rendering also depends on applying the migrations.

These gates must be rerun before merge. Do not interpret the static SQL contract check as a substitute for applying the migrations and testing rollback on a disposable database.

## Requested Opus audit

Please review, without changing PDA-owned files unless agreed:

1. Fixture attachment against `fn_can_read_pda_estimate` and snapshot masking.
2. Whether the stable estimate header is sufficient for recap rendering.
3. Migration range/dependency safety with Fixture Room migrations.
4. Maker/checker, no-direct-table-grant, immutability and exact-terminal controls.
5. Any shared integration conflicts. Record findings in a separate coordination document and include severity/file/line/recommendation.
