# PDA Estimator and Fixture Room: release readiness

Candidate: `feature/modules-integration` at `2fa02d3` (26 September 2026).

This candidate is ready for owner-approved merge to `dev`. It has not been
merged, pushed, deployed, or applied to a hosted database.

## Included

- Governed PDA Estimator, tariff versioning/publication, estimate reads, and
  controlled admin ingestion.
- Fixture Room negotiation, recap, masking, RLS-only access through RPCs,
  admin console, account-anonymisation compatibility, and guarded PDA links.
- Account privilege boundary: members can change only profile fields; admin
  authority requires both the Auth claim and an active admin record.
- The review-queue counter fix: administrator decisions use the service-owned
  mutation path only after server-side section and edit permission checks.
- Port-tariff evidence inventory. It inventories the supplied source material;
  it does not publish imported tariff values automatically.

## Deliberately deferred

`feature/fixture-room`'s proposal-lapse sweep (`98bda61`) is not included.
It has no approved scheduler, and its additive migration needs an upgrade-path
regression before it is reconsidered. Existing Fixture proposal expiry remains
the release behaviour.

## Verified locally

- Full `npm run build`, including all project prebuild contracts and all PDA,
  Fixture, admin queue, and portal routes.
- Fixture pure checks: 197 passing on the included candidate.
- Browser acceptance: 15 passing Fixture member, responsive, accessibility,
  and administrator checks against a production build.
- Combined PDA/Fixture migration harness: ordered forward application,
  exact rollback fingerprint, and reapplication passed on an empty local
  module schema.
- Fixture RLS, masking, idempotency, immutability, snapshot, shared PDA link,
  account-anonymisation, and user-privilege transaction smoke suites passed.
- U7 verifies a service-owned review approval increments the submitter's
  counter while a provisioned admin still cannot alter that counter directly.

## Owner approval and deployment checklist

1. Approve merging the current `feature/modules-integration` release branch to
   `dev`; its reviewed application-code baseline is `2fa02d3`.
2. Review the eleven ordered migrations before applying them to the target
   Supabase database. Apply through the normal reviewed migration deployment
   process; do not run rollback harnesses against a populated environment.
3. Have every existing administrator sign out and sign in once after the user
   privilege migration so the refreshed access token contains the admin claim.
4. Run the production smoke suite for an admin review approval, a PDA estimate,
   a Fixture Room member flow, and a masked TBN read.
5. Load new port-tariff material through the staged admin ingestion/review
   workflow, then publish a reviewed tariff version. Do not bulk-load the
   `Port Tarifs` directory directly into live calculation tables.
6. Keep proposal-lapse scheduling disabled. Reconsider it only when the owner
   selects pg_cron or an external service-owned scheduler and approves the
   corrected upgrade-safe migration.
