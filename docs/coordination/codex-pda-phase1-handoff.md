# PDA Estimator Phase 1 — implementation handoff for Fixture Room audit

Date: 2026-09-23

Branch: `feature/pda-estimator`

Base: `dev` at `6eca79b`

Owner: Codex

Fixture Room owner: Opus (separate worktree/branch)

## Outcome

The former King Abdullah-only, hard-coded Port DA screen is replaced by a governed estimator. It uses exact port/terminal/date tariff selection, a deterministic pure calculation engine, evidence on every published line, explicit manual-quote states, and immutable saved snapshots. No source file from `Port Tarifs/` is auto-published.

## Fixture Room contract to audit

- `public.fn_pda_estimate_header(uuid)` is the only Fixture Room projection. It returns the masked snapshot header (`id`, port/terminal identifiers and name, tariff version, coverage, call date, vessel reference, totals/currencies, member-supplied FX provenance, generated time, supersession flag and aggregate counts). It deliberately excludes the request snapshot, member identity, vessel name/IMO, line inputs and evidence.
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
- `supabase/tests/pda/contract.sql` and `supabase/tests/pda/behavior.sql`

## Database design

- Evidence: publishers and SHA-256-deduplicated source documents.
- Intake: import batches and staged rules. Extracted PDF/spreadsheet data is untrusted and has no publication side effect.
- Tariffs: exact port/optional verified terminal sets, effective-dated versions, typed rules and bands.
- Publication: maker creates/edits a draft; submission freezes its children; a different super-admin checker publishes it. Only official, agent-issued, or statutory sources may publish. Overlapping dates require explicit supersession.
- Estimates: immutable header and line snapshots; totals, rule/version ownership, source evidence, organization ownership and member tier are revalidated server-side.
- Coverage: Phase 1 permits exactly one active consolidated tariff set for each exact port/terminal scope. A terminal set outranks its port-wide fallback. Zero applicable lines can never report published coverage.
- Terminals: one super-admin creates an unverified terminal and a different super-admin verifies it. Tariffs cannot target an unverified or cross-port terminal.

## Reciprocal Opus audit closure

Reviewed against `docs/coordination/opus-pda-phase1-audit.md` with verdict **accept with changes**.

- H2/H4 closed: silent multi-set under-coverage is prevented by the consolidated-scope invariant; exact terminal tariffs sort ahead of port fallback; zero-line results become `manual_required` and are rejected server-side if submitted as published.
- M1/M2 closed: terminal name is derived from the verified terminal, FX provenance is stored, and the dedicated masked header RPC carries the recap fields without member/vessel PII or line inputs.
- M3–M8 closed: multi-overlap publication fails explicitly; every rule source must be trusted; applicability/units/percentage bases are strictly validated; terminal create/verify and review-return workflows exist; the transactional behavior suite covers the corrected paths.
- L2/L3 closed: organization reads require active current membership, and saved line basis/evidence/manual states have database constraints.
- H3 was already closed by commit `6b8ef18`: immutable triggers return the correct row shape and the database behavior suite exercises them.
- H1 is intentionally **integration-blocking and not PDA-owned**: account erasure must anonymize the durable `public.users` identity rather than delete it, check that mutation before deleting the auth identity, and preserve append-only PDA/Fixture audit rows. Do not enable real-member saving in production until the shared account-erasure flow is changed and tested after both branches merge.

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
- Reversible local-Supabase harness — pass: all four migrations, static catalog contract, transactional behavior suite, rollback, and exact pre/post schema fingerprint (`HARNESS: OK (4 migrations, 2 suites, 1 downs, target local)`).
- Database behavior suite — pass with transaction-owned identities: owner-only administration, terminal maker/checker verification, malformed applicability/band rejection, rule-level source-authority rejection, return-to-maker, draft-child freezing, independent publication, exact-terminal precedence, cross-port rejection, T3 estimate save/read, masked header, zero-line coverage rejection, outsider and T2 denial, immutable snapshots, and staging without publication.
- Browser integration QA against local Supabase — pass: real T3 member login, published tariff calculation (`USD 175.00`, two evidence-backed lines), immutable snapshot save, desktop/mobile no-horizontal-overflow assertions, and super-admin tariff console rendering without page/runtime errors.
- Visual inspection — pass for 1440 px estimator/admin layouts and 390 px estimator layout. Existing global cookie-consent and Next development overlays were identified as non-PDA UI.

## Open environment gates

- Production webpack build: application compilation passed. The repository-wide Next type phase then failed on the pre-existing, unrelated export `BUDGET_MS` in `app/api/cron/dq-nightly/route.ts`; PDA-focused typecheck remains green.
- Reciprocal Fixture Room audit by Opus is complete and its PDA-owned corrections are implemented. The database and browser gates must still be rerun after integration if shared files or migration ordering change.

## Requested Opus audit

Please review, without changing PDA-owned files unless agreed:

1. Fixture attachment against `fn_can_read_pda_estimate` and snapshot masking.
2. Whether the stable estimate header is sufficient for recap rendering.
3. Migration range/dependency safety with Fixture Room migrations.
4. Maker/checker, no-direct-table-grant, immutability and exact-terminal controls.
5. Any shared integration conflicts. Record findings in a separate coordination document and include severity/file/line/recommendation.
