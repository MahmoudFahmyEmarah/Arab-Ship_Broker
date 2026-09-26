# PDA Estimator and Fixture Room: release readiness

Candidate: `feature/modules-integration` at `09bb102` (local validation
complete, 26 September 2026). The application and migration candidate audited
by Opus is `fe0a1f0`; the later commit changes only the local browser harness.
Merge, push, deployment and hosted migration are paused for owner feedback.

This candidate is ready for owner-approved merge to `dev`. It has not been
merged, pushed, deployed, or applied to a hosted database.

## Included

- Governed PDA Estimator, tariff versioning/publication, estimate reads, and
  controlled admin ingestion.
- Fixture Room negotiation, recap, masking, RLS-only access through RPCs,
  admin console, account-anonymisation compatibility, and guarded PDA links.
- Account privilege boundary: members can change only profile fields; admin
  authority requires both the Auth claim and an active admin record.
- Market-partner entitlement is service-managed and is enforced consistently
  by the portal, the PDA server action, and both PDA and Fixture database
  gates. No member-facing action can grant the flag.
- The review-queue counter fix: administrator decisions use the service-owned
  mutation path only after server-side section and edit permission checks.
- Port-tariff evidence inventory. It inventories the supplied source material;
  it does not publish imported tariff values automatically.

## Deliberately deferred

`feature/fixture-room`'s proposal-lapse sweep (`98bda61`) is not included.
It has no approved scheduler, and its additive migration needs an upgrade-path
regression before it is reconsidered. Existing Fixture proposal expiry remains
the release behaviour.

## Readiness assessment

- PDA Estimator: **95%** production-ready.
- Fixture Room: **96%** production-ready.
- Combined release/deployment: **94%** ready.

These are confidence assessments, not percentages of tests passed. The
remaining risk is concentrated in owner acceptance, the reviewed hosted
migration run, administrator token refresh, production configuration and
post-deployment smoke checks. Those operations are intentionally not counted
as complete while the owner pause is active.

## Verified locally

- Full `npm run build`, including all project prebuild contracts and all PDA,
  Fixture, admin queue, and portal routes.
- Fixture pure checks: 197 passing on the included candidate.
- Every one of the 27 Fixture browser cases passed against the production
  build: negotiation 4/4, member accessibility 3/3, member responsive 5/5,
  administrator workflow 3/3, administrator accessibility 4/4 and
  administrator responsive 8/8. The files were run independently after the
  local Docker Auth/API services were restarted; the earlier combined run was
  affected by a recorded Docker DNS timeout, not an application assertion.
- PDA browser acceptance passed with a published local-only QA tariff:
  USD 175 calculation with evidence lines, input-change preview invalidation,
  immutable snapshot save and a 390 px overflow check. The same flow passed
  as T3 and as a T1 account carrying the service-owned market-partner flag.
- Combined PDA/Fixture migration harness passed all twelve ordered release
  migrations, eleven transactional suites, all six DOWN files, an identical
  5,961-line rollback fingerprint, and full reapplication.
- Fixture RLS, masking, idempotency, immutability, snapshot, shared PDA link,
  account-anonymisation, and user-privilege transaction smoke suites passed.
- U7 verifies a service-owned review approval increments the submitter's
  counter while a provisioned admin still cannot alter that counter directly.
- Opus independently re-audited exact application/migration commit `fe0a1f0`,
  confirmed findings F1-F6 and the rollback constraint-name correction are
  closed, and issued final GO.

## Owner approval and deployment checklist

1. Review the final local validation report and approve merging the exact
   reported `feature/modules-integration` commit to `dev`.
2. Review the twelve ordered migrations before applying them to the target
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
7. Keep `is_market_partner` false unless the owner deliberately grants it
   through a service-owned administration operation. It is an entitlement,
   not an editable profile field.
