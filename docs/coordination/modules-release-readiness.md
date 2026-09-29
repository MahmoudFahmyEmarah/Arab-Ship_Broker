# PDA Estimator and Fixture Room: release readiness

Candidate branch: `feature/modules-release-final`. The immutable validation
SHA is recorded in the live coordination mailbox and final release handoff so
this document does not become stale after an evidence-only correction.

The owner has authorised the final merge to `dev` and the release, subject to
the repository's exact-SHA gates: combined isolated database lifecycle,
production build, browser suites, Codex GO, Opus cross-audit GO, a fresh
production backup/PITR confirmation, and production deployment coordination.

## Included

- The exact-design PDA Estimator, governed tariff publication, estimate reads,
  and controlled admin ingestion.
- Fixture Room negotiation, recap and summary documents, masking, private
  candidate handles, RLS/RPC-only access, admin console, and guarded PDA links.
- Account anonymisation, the user privilege boundary, and the service-managed
  market-partner entitlement.
- The global market privacy firewall: actor-bound market handles, TBN identity
  masking, exact owner/admin management paths, and legacy raw-feed closure.
- Eighteen ordered `20260923*` migrations in
  `supabase/releases/modules-20260923.txt`.

## Release order

1. Validate and apply Data Sync round 2 (`supabase/releases/sync-20260920.txt`).
2. Validate the 18-migration module manifest in isolation.
3. Deploy the matching application during the same controlled release window.
4. Apply and verify the market closure stages, then run production privacy and
   module smoke checks.

Use `scripts/release-check.sh` and `scripts/release-apply.sh`; never use an
unscoped `supabase db push` for this release.

## Deliberately deferred

- `20260923204000` proposal-lapse sweep: lazy lapse remains the released
  behaviour; no scheduler has been selected.
- `20260923205000` Fixture notification projector and the separate shared
  notification checkpoint. The current `notify-model.ts` is an inert,
  channel-free policy contract and no event-to-notification trigger ships.
- Email/WhatsApp recap delivery and Realtime presence.

## Exact-tree gates already passed

- PDA, Fixture Room (310/310), module-integration, and market-privacy
  (230/230) source/contract suites.
- Full TypeScript no-emit compilation and targeted ESLint.
- Manifest/on-disk/harness parity: 18 release migrations; Fixture migrations
  200-203 and 206-208; deferred 204/205 files physically absent.
- Independent read-only conflict audit: opaque candidate/restart paths remain,
  member-facing raw Fixture creation remains revoked, and no masked TBN raw ID
  was reintroduced.

The database lifecycle, production build, browser suites, and independent
exact-SHA cross-audit must be recorded before the final GO. A passing source
gate is not a substitute for those release gates.

## Deployment checklist

1. Re-fetch `origin/dev` and prove the frozen candidate is still a clean
   fast-forward from it.
2. Confirm a fresh Supabase backup/PITR point before any hosted write.
3. Confirm which Vercel branch/build is production. Repository documentation
   currently describes `main` as production and `dev` as Preview; a `dev` push
   alone must not be treated as a production deployment.
4. Apply only the reviewed manifests in the stated order and verify every
   recorded migration version.
5. Confirm `fixture_private` and `market_private` remain hidden, raw Fixture
   creation is revoked from members, and legacy raw matchers are revoked.
6. Have existing administrators sign out and back in after migration 330000.
7. Smoke-test an admin review, PDA estimate/save, two-party Fixture flow,
   masked TBN read, owner-only listing sync, and responsive layouts.
8. Keep proposal-lapse scheduling and the Fixture notification projector off.

Rollback scripts are emergency tools, not routine production commands. PDA
rollback is data-destructive, account anonymisation is not reversible for
already-erased accounts, and Fixture rollback preserves populated ledgers as
backup tables. Stop on the first migration failure and reconcile the exact
applied prefix before taking another action.
