# Ports Cost Estimator active-design contract

Status: Phase 0 frozen; Phase 1 presentation and governed route preview implemented

Reference: `tmp/Fixture Room + Ports Cost Estimator - Standalone (2).html`

This contract applies only to the active Ports Cost Estimator surface. It does
not authorize the standalone bundle's prototype pricing, browser stores,
hard-coded tariff packs, simulated verification, or simulated agent workflow.

## Source-of-truth boundary

The active visual modules are the nested estimator application represented by
`pda-est-app`, `pda-face`, `pda-timeline`, `port-shell`, `ports-index-app`,
`agent-portal-agency`, `agent-portal-request`, and `verify-panel`. Dormant
legacy `.pda-*` markup and styles are excluded.

The production portal shell stays in place. The estimator may reproduce the
active workspace below that shell; it must not render a second sidebar,
ticker, account footer, or global navigation.

## Delivery states frozen for visual comparison

The implementation must have deterministic fixtures/screenshots for:

1. Empty: no vessel and no cargo selected.
2. Selected: authorised vessel and cargo, exact load/discharge ports resolved.
3. Port choice required: cargo carries an options/area route.
4. Loading: each leg reports independently.
5. Partial failure: one leg succeeds and the other fails.
6. Calculated: both governed previews returned with server aggregate.
7. Not sourced: unsupported transit/agent/handling items remain explicit nulls
   with reason codes.
8. Saved: two immutable leg estimates and one immutable estimate set.
9. Mobile: active Estimate view at 390x844.
10. Tablet and desktop: 1024x768 and 1440x900.

## Fixture handoff

The only accepted query keys are:

| Key | Meaning | Rule |
| --- | --- | --- |
| `from` | Origin surface | Only `fixture` is recognised. |
| `ref` | Origin record reference | Maximum 100 characters; context only. |
| `cargoId` | Cargo listing or reference ID | Must resolve inside the viewer's authorised cargo catalog. |
| `vesselId` | Availability or vessel ID | Must resolve inside the viewer's authorised vessel catalog. |
| `vessel` | Vessel-name fallback | Used only without `vesselId` and only on one exact authorised match. |
| `load` | Load-port override | Normalised UN/LOCODE; must exist in the verified port catalog. |
| `disch` | Discharge-port override | Normalised UN/LOCODE; must exist in the verified port catalog. |
| `mt` | Cargo quantity override | Finite and greater than zero. |

IDs and port values from the URL never become trusted records. An unavailable
or ambiguous value is ignored and surfaced as a non-blocking notice. The user
must choose an authorised record before calculation.

## Frozen component input

`PdaEstimatorBootstrap` in `lib/pda/estimator-contract.ts` is the page-to-UI
boundary. The estimator component receives only:

- an authorised, serialisable vessel catalog;
- an authorised, serialisable cargo catalog;
- verified active port options;
- a `catalogState` that prevents sample fallback records from entering the
  estimator when either live catalog fails;
- a resolved initial selection;
- safe handoff notices.

The UI does not receive Supabase rows, tariff publications, service-role data,
or functions that calculate money. It may collect inputs and render results.

## Calculation boundary

- Each port call uses the existing governed `PdaRequest` and calculation
  engine through authenticated server actions.
- `previewPdaRoute` validates the selected vessel availability and cargo
  against the viewer's own live catalogs, refuses sample fallback records,
  verifies both ports are active database ports, calculates the two legs
  independently and computes all monetary aggregates server-side.
- Server-authoritative vessel identity/registered facts, cargo type, quantity,
  port-stay days and derived dates replace their client copies before pricing.
  Missing technical particulars that are not held on the selected record may
  still be supplied explicitly.
- A client input change invalidates the full paired result and save token.
- Unsupported values are `{ amount: null, reasonCode }`, never zero.
- Verification comes only from published tariff maker/checker state. Disputes
  come only from flagged, attributed quote lines.

## Persistence boundary

The immutable estimate set will reference both immutable `pda_estimates`, both
tariff-version IDs, owner and organisation, route/timeline inputs, productivity,
passage, OPEX, allocation, per-leg coverage and not-sourced reasons. It carries
a content hash and supersedes by creating a new set. Fixture linkage targets
the set or links the two legs atomically.

## Implemented increment

The current isolated branch implements the exact active Estimate hierarchy:
title and subtitle, four-tab strip, authorised vessel/cargo selectors,
selected summaries and reset, explicit port choice, route summary, timeline,
and paired load/discharge cards. It uses the real portal shell and the
authenticated `previewPdaRoute` server action. Unsupported transit and
incomplete all-in values stay `NOT SOURCED`.

Desktop (1440x900), tablet (1024x768), and mobile (390x844) browser contracts
cover the empty and selected states, keyboard-accessible selectors, responsive
collapse, and page-level overflow. The Ports, Agents, and Setup tabs are
present as explicitly deferred governed workspaces; they contain no mock
records or simulated workflows.

This increment does **not** claim the immutable paired save/export history,
per-leg retry state, governed Agents workflow, Ports workspace, or Setup
preferences. Those remain later phases and are release blockers for any claim
that the complete four-tab reference has shipped.

## File ownership

Codex owns `lib/pda/**`, `app/(dashboard)/dashboard/ports-da/**`,
`components/pda/PdaRouteEstimator.tsx`,
`components/pda/pda-route-estimator.css`, the PDA SDK, database
migrations/DOWNs, the shared scoped design base, page composition and release
verification.

The shared base is `components/design-system/asb-ds.css`. Module pages opt in
with an `.asb-ds` root. It provides only tokens and primitive controls; exact
PDA layout remains in the scoped route-estimator stylesheet.

By the owner's 2026-09-27 scope decision, Opus remains on Fixture Room only.
Opus's PDA role is read-only architecture/audit input through the mailbox; no
PDA presentation file is assigned to Opus.
