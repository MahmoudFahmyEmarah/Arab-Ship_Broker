# Phase 0 architecture: PDA Estimator and Fixture Room

Status: **proposed for joint review**

Architecture owner: Codex

Fixture Room implementation owner: Opus

PDA Estimator implementation owner: Codex

Integration owner: Codex

This document is the shared contract for the two modules. Phase 0 changes no
production behavior. Implementation starts only after the Fixture Room owner
has reviewed this contract and the architecture owner has resolved the review.

## 1. Outcome and boundaries

The two modules share listings, organizations, users and selected port calls,
but they are separate bounded contexts:

```text
ports + terminals + vessel/cargo facts
                 |
                 v
     tariff publication domain ---> PDA Estimator
                                         |
                           immutable estimate snapshot
                                         |
                                         v
cargo listing + vessel availability ---> Fixture Room ---> recap/audit trail
```

The PDA Estimator answers: **what is the estimated disbursement account for
this exact port call, under a particular published tariff version and input
set?**

The Fixture Room answers: **what commercial terms did the authorized parties
propose, agree, subject, lift and finally fix for this cargo/vessel pairing?**

Neither module owns the canonical port, vessel, cargo, user or organization
registries. They reference those records.

## 2. Evidence from the current application

### 2.1 PDA is an existing feature that must be replaced safely

- `/dashboard/ports-da` already exists and is currently admin-only.
- `calcPortDA()` in `lib/portal/econ.ts` is a hard-coded King Abdullah
  Port/Kanoo calculation.
- The current calculator warns that only that model is loaded but can still
  apply its figures when another port is selected. Production implementation
  must never do that.
- The Voyage Estimator calls the same hard-coded function for POL and uses a
  manual POD amount. Its integration must move to the published PDA service,
  with an explicit manual fallback where no verified tariff exists.

### 2.2 Fixture Room exists only as prototype behavior

`Arab ShipBroker Portal - Standalone.html` is the UX reference. It shows:

- entry from a cargo or vessel card;
- a match-builder that pairs one cargo with one vessel availability;
- a room header with reference, counterparty presentation, phase, clock and
  progress;
- six compact commercial term rows, expandable details, position history,
  counter-offers, recap, subjects and a fixed state;
- presence, unsaved-change behavior and a responsive one-page layout.

The prototype stores selections in `localStorage` and has no production
authorization or concurrency contract. It defines UX intent only. Production
state must be server-authoritative and persisted in Supabase.

### 2.3 Existing platform contracts to retain

- `public.ports.locode` is the canonical port identifier.
- `port_aliases` resolves spelling/shorthand to one real port.
- `port_areas.ref_locode` exists for route estimation. An area reference port
  is **not** a tariff identity and must not select a PDA tariff.
- `organizations`, `organization_members` and `fn_my_org_ids()` establish the
  company boundary. Listing ownership is durable at organization level.
- Data Sync currently supports only cargo, vessels, companies, ports and
  commodities. Its staging, review, data-quality gate, audit and undo patterns
  are useful, but its generic table-upsert contract is not a tariff engine.
- The project uses Next.js App Router, server-side Supabase access, RLS, typed
  domain adapters, TypeScript/Zod, script-based checks, ESLint and Playwright.

## 3. Non-negotiable shared invariants

1. **Exact identity before price.** An automatic PDA requires an active,
   verified `ports.locode` and, when the tariff is terminal-specific, an exact
   terminal. Area and option-list reference ports may estimate distance but
   may not silently select a tariff.
2. **Published versions are immutable.** Correcting or superseding a tariff
   creates another version. Existing estimates and fixtures keep their source
   snapshot.
3. **No document writes live rules directly.** Extraction produces staged
   suggestions with citations. An authorized human maps, validates and
   publishes them.
4. **No LLM decides money.** An LLM may classify/extract text; deterministic,
   typed rules calculate every amount.
5. **Every amount is explainable.** A PDA line names its formula/basis, inputs,
   tariff rule, currency, source document and source page/sheet.
6. **No silent fallback to another port.** Missing coverage returns
   `manual_required`, not a plausible-looking total from a different port.
7. **Server-authoritative fixture state.** Local storage may preserve harmless
   draft UI preferences only; it is never the commercial record.
8. **Organization isolation and least privilege.** A room is readable only to
   authorized participants/admins. Counterparty masking is applied on the
   server, not by hiding already-delivered fields in the browser.
9. **Immutable commercial history.** Offers, state transitions, subjects,
   PDA links and recap publications are append-only events or versioned rows.
10. **Optimistic concurrency.** Every fixture command carries an expected room
    version and an idempotency key. A stale command is rejected and refreshed.
11. **Shared records have one owner.** Ports stay in the port domain; tariff
    rules stay in PDA; negotiation terms stay in Fixture Room.
12. **Original owner fixes review findings.** Reviewers report issues; they do
    not edit the other owner's feature branch without an explicit handoff.

## 4. PDA Estimator architecture

### 4.1 User-facing flows

1. Select an exact port and optional terminal.
2. Select vessel/call facts: GT, NT/SCNRT where applicable, DWT, LOA, draft,
   vessel/cargo type, laden/ballast, arrival/departure, alongside/anchorage,
   stay duration, cargo quantity and requested services.
3. Resolve the published tariff version effective on the call date.
4. Calculate deterministic line items and show source evidence.
5. Permit an authorized manual line with a reason and attribution where a
   published tariff explicitly requires a quotation or data is unavailable.
6. Save an immutable estimate snapshot and optionally attach it to a voyage or
   fixture.
7. A revised calculation creates a new estimate; it never mutates the snapshot
   already used by a fixture.

### 4.2 Canonical domain model

Names below are the proposed database contract. The implementation migration
may refine column names, but not the responsibilities.

| Entity | Responsibility |
|---|---|
| `port_terminals` | Terminal/berth identity under one exact `ports.locode`; aliases and active/verified state. |
| `tariff_publishers` | Port authority, terminal, agent or statutory publisher. |
| `tariff_sources` | Source document metadata, checksum, storage path, language, issue/effective/expiry dates and authority. |
| `tariff_import_batches` | One ingestion/review run and its status, actor and audit summary. |
| `tariff_staged_rules` | Extracted rule candidates, raw text, normalized proposal, source page/sheet, confidence, mapping and validation flags. |
| `port_tariff_sets` | Stable tariff identity: port, optional terminal, publisher and scope. |
| `port_tariff_versions` | Immutable effective-dated published version, currency, rounding policy and approval data. |
| `port_tariff_rules` | Typed charge rule and applicability conditions within a version. |
| `port_tariff_bands` | Ordered thresholds/rates for tiered or progressive rules. |
| `pda_estimates` | Immutable request/output header, exact identities, inputs snapshot, FX snapshot, status and total. |
| `pda_estimate_lines` | Immutable calculated/manual lines with rule/version/source evidence. |

`port_terminals` must use a stable UUID and a uniqueness constraint appropriate
to `(port_locode, normalized_name)`. A tariff set references `ports.locode`
directly and may additionally reference a terminal. It must never reference
`port_areas`.

### 4.3 Typed calculation rule catalogue

`port_tariff_rules` uses a closed `basis` vocabulary, initially:

- `flat`, `per_call`, `per_day`, `per_hour`;
- `per_gt`, `per_nt`, `per_scnrt`, `per_dwt`, `per_loa`;
- `per_cargo_mt`, `per_unit`, `percentage`;
- `tiered_flat`, `tiered_rate`, `progressive`;
- `manual_quote`.

Applicability is typed data validated by Zod and mirrored by database checks:
vessel/cargo category, laden/ballast, domestic/international, date window,
terminal/berth, anchorage/alongside, quantity/dimension bands, included units,
minimum/maximum, included days and requested service. The database must not
store executable JavaScript, SQL or free-form formulas.

Calculation order is explicit:

1. choose effective tariff version;
2. filter applicable rules;
3. evaluate basis and bands;
4. apply minima/maxima;
5. calculate rule-level surcharges/discounts/tax where authorized;
6. apply the version's rounding policy;
7. retain native currency and add converted totals from an FX snapshot;
8. emit an explanation for every line.

### 4.4 Tariff ingestion and administration

The tariff admin workflow is a dedicated adapter/workflow, not a sixth generic
`SheetId` committed by `commit_sync_batch`:

```text
upload/source registration
  -> checksum + duplicate detection
  -> text/table extraction (OCR when needed)
  -> staged rule candidates with page/sheet evidence
  -> exact port/terminal reconciliation
  -> schema + domain validation
  -> maker review
  -> checker approval
  -> immutable publication
  -> optional supersession/rollback to prior published version
```

It may reuse existing admin components, job tracking, Vault-backed LLM provider
configuration, DQ presentation and audit conventions. It gets its own target
tables and publication RPC so generic Data Sync can never upsert calculation
rules by table name.

When a source names a port not in `ports`, publication stops. The admin either
maps an alias to an existing exact port or creates/verifies the port through the
existing governed Ports action. When it names a new terminal, the admin creates
and verifies the terminal under that exact port. This is how existing database
ports, the supplied directory and future admin additions meet without creating
parallel port identities.

### 4.5 Initial `Port Tarifs/` source classification

The directory is useful and belongs in the ingestion backlog, but it is not a
ready-to-import database. Initial triage is:

| Source group | Treatment |
|---|---|
| Turkish ports 2026 | High-priority structured extraction for port dues, pilotage, light/sanitary dues, agency and related services; exact scope/port mapping still requires review. |
| Greece/Piraeus 2025-2026 | Split general provisions, tariff numbers and waste rules into cited rule candidates; check issue/effective dates. |
| Romania/Constanta | Map chapter/area documents to Constanta, Midia, Mangalia or terminal scope; reject irrelevant rent/telecom material from PDA publication. |
| Bulgarian ports 2023-2026 | Separate sea/river/terminal and waste tariffs; effective-date and terminal review required. |
| Kuwait ports | Treat as `needs_currency_and_currentness_review`; older ministerial documents cannot be presumed current. |
| Egyptian ministerial decrees | OCR/translation and legal/currentness verification before publication. |
| Suez circulars/forms/guides | Route to the Suez Canal domain, not ordinary port PDA. Detect the duplicate Circular 1 files by checksum. |
| PAQ, Pilot Card, waste descriptions, bags/team material | Reference/input-schema or operational documents; not automatically monetary tariffs. |

The first production tariff version should be a small, fully verified golden
set rather than publishing the entire directory at once.

### 4.6 PDA service boundary

Application code owns one deterministic service contract:

```ts
calculatePda(request) -> {
  coverage: "published" | "partial" | "manual_required";
  tariffVersionId: string | null;
  nativeCurrency: string;
  lines: explainedLine[];
  totals: { native: number; converted?: number; convertedCurrency?: string };
  warnings: warning[];
}
```

The page, Voyage Estimator and Fixture Room consume this service/output. They
must not duplicate formulas. Fixture Room consumes only a saved estimate
snapshot, not an unsaved live calculation.

## 5. Fixture Room architecture

### 5.1 Version-one scope

Version one pairs one `cargo_listing` with one `vessel_availability`, supports
authorized broker/owner/charterer participants, records term-level proposals,
subjects and messages, produces a versioned recap and fixes or closes the room.

The prototype's six-term compact layout is retained as a UX starting point,
but term definitions are configuration/data rather than six hard-coded state
variables. Presence and Supabase Realtime may improve immediacy; persisted
commands and refresh must remain correct without Realtime.

### 5.2 Canonical domain model

| Entity | Responsibility |
|---|---|
| `fixture_rooms` | Pairing, owning broker organization, lifecycle status, current version, timestamps and fixed/closed reason. |
| `fixture_parties` | Participating organization, commercial role, invited/active status and server-side visibility/masking policy. |
| `fixture_terms` | Ordered term instance, code/category/unit, status, agreed value and agreement event reference. |
| `fixture_proposals` | Immutable value/comment proposal by one party, supersession link and expiry if applicable. |
| `fixture_subjects` | Subject description, responsible party, deadline and lifted/failed event. |
| `fixture_messages` | Room communication with sender, visibility and edit/redaction policy. |
| `fixture_events` | Append-only command/event ledger for all commercially relevant actions. |
| `fixture_recap_versions` | Immutable generated recap snapshots and publication/acknowledgement state. |
| `fixture_pda_links` | Load/discharge/other purpose, `pda_estimate_id` and a small display snapshot recorded as an event. |

The room points to `cargo_listings.id` and `vessel_availability.id`; it does not
copy mutable marketplace rows as its source of truth. At creation, the event
ledger also captures the commercially relevant listing snapshot so later
listing edits cannot rewrite negotiation history.

### 5.3 State machine

Canonical room states:

```text
draft -> invited -> negotiating -> on_subjects -> fixed
   |         |           |              |
   +---------+-----------+--------------+--> withdrawn | failed | expired
```

- `draft`: creator can configure the pairing and parties.
- `invited`: invitations exist; commercial proposals are not yet active.
- `negotiating`: at least one term proposal has been submitted.
- `on_subjects`: commercial terms are agreed, but one or more subjects remain.
- `fixed`: all required terms are agreed and all subjects are lifted.
- `withdrawn`, `failed`, `expired`: terminal outcomes with an actor/reason.

Recommendation: **“subjects lifted” is an event and timestamp, not a durable
state separate from `fixed`**. Lifting the final subject atomically transitions
the room from `on_subjects` to `fixed`. This prevents a commercially ambiguous
window where all subjects are lifted but the system still says “not fixed.”

Term states are `open`, `countered`, `agreed`, `reopened` and `withdrawn`.
Reopening an agreed term is a permissioned event and invalidates any pending
recap version; it does not delete the prior agreement.

### 5.4 Commands, concurrency and audit

Clients never directly update lifecycle, proposal, agreement or subject tables.
Server actions call transactional RPCs such as:

- `create_fixture_room`
- `invite_fixture_party`
- `submit_fixture_proposal`
- `accept_fixture_proposal`
- `reopen_fixture_term`
- `add_fixture_subject`
- `lift_fixture_subject`
- `publish_fixture_recap`
- `acknowledge_fixture_recap`
- `close_fixture_room`
- `link_fixture_pda_estimate`

Every command includes `expected_version` and `idempotency_key`. The transaction
locks the room, checks access and state, writes domain rows plus one event,
increments the version and returns the new state. Duplicate idempotency keys
return the original result; stale versions return a conflict, never last-write
wins.

### 5.5 Authorization and information boundaries

- Admins may inspect for governed support/audit; this access is itself audited.
- Active room participants may read only rooms in which their organization is
  a party.
- Party roles determine commands: the appointed broker can coordinate and
  publish recaps; a principal can propose/accept on its side; viewers cannot
  make commercial commands.
- Membership is resolved through current `organization_members`, not a client
  supplied organization ID.
- A helper such as `fn_can_access_fixture(room_id)` centralizes the RLS test.
- Sensitive organization/contact/vessel ownership fields use security-barrier
  views or safe RPC output. Masking is decided before serialization.
- Event/proposal history is append-only for participants. Redaction is a new
  audited event available only under a defined admin policy.

### 5.6 PDA integration contract

Fixture Room may link a saved PDA estimate when the requesting organization is
allowed to read it. It stores:

- estimate ID and purpose (`load`, `discharge`, `other`);
- port LOCODE/terminal display name;
- tariff version ID;
- native/converted total and currencies;
- generated timestamp and coverage status.

The estimate itself remains owned by PDA. A later tariff publication does not
change the fixture. “Refresh estimate” creates a new PDA estimate and a new
link event; history keeps both.

## 6. UI and route architecture

### PDA

- Member route: `/dashboard/ports-da`
- Admin tariff workspace: `/admin/port-tariffs`
- Keep the current calculator route while replacing its implementation.
- Use server components for initial authorization/data and focused client
  components for the calculation form/result.
- Surface exact coverage, effective date, source, assumptions, missing inputs,
  manual lines and calculation timestamp next to the total.

### Fixture Room

- `/dashboard/fixture-room`: room list/inbox
- `/dashboard/fixture-room/new`: match builder; accepts validated cargo and/or
  vessel-availability query parameters
- `/dashboard/fixture-room/[id]`: active room
- `/dashboard/fixture-room/[id]/recap`: printable/versioned recap view
- Start Fixture actions on cargo/vessel cards request navigation through the
  integration owner; the feature branch must not independently edit shared
  card/sidebar files.

Both modules use the existing ASB design tokens, loading/error patterns,
keyboard accessibility, reduced-motion behavior and 390/1280/1440 layouts.

## 7. Work division and collision control

Use separate branches and preferably separate Git worktrees:

- Codex: `feature/pda-estimator`
- Opus: `feature/fixture-room`
- Integration: `feature/modules-integration`

### Codex-owned paths

- `lib/pda/**`
- `components/pda/**`
- `sdk/app/pda.ts`
- `app/(dashboard)/dashboard/ports-da/**`
- `app/(admin)/admin/port-tariffs/**`
- PDA/tariff tests and documentation
- migration range `2026092310xxxx` through `2026092314xxxx`

### Opus-owned paths

- `lib/fixture-room/**`
- `components/fixture-room/**`
- `sdk/app/fixtures.ts`
- `app/(dashboard)/dashboard/fixture-room/**`
- Fixture Room tests and documentation
- migration range `2026092320xxxx` through `2026092324xxxx`

### Shared paths: integration owner only

- `components/portal/PortalSidebar.tsx`
- shared cargo/vessel cards and dashboard shell
- global navigation, top-level layouts and shared CSS/tokens
- generated database types
- `package.json` scripts/dependencies
- cross-module contracts and final migration ordering

Feature owners submit a shared-change request in their handoff rather than
editing a shared path. Emergency exceptions require a recorded agreement.

## 8. Test architecture and acceptance gates

### PDA gates

- Golden calculation fixtures tied to source document/page for every published
  tariff version.
- Band boundaries, progressive tiers, minima/maxima, included-day cutovers,
  rounding, tax, currency and effective-date tests.
- No coverage, area-only identity, wrong terminal and expired tariff must fail
  safely into explicit manual/unsupported states.
- Re-running the same immutable inputs/version produces the same native total.
- Published versions cannot be edited; existing estimates do not change after
  supersession.
- Admin maker/checker, RLS and evidence/duplicate checksum tests.
- Voyage Estimator and fixture-link contract tests.

### Fixture Room gates

- State transition matrix tests, including invalid/terminal transitions.
- Organization/role RLS matrix and masked-output tests.
- Two concurrent commands from the same version: exactly one wins; the other
  gets a conflict.
- Repeated idempotency key does not create a duplicate proposal/event.
- Proposal/agreement/reopen/subject/fix history is complete and append-only.
- Listing edits after room creation do not rewrite the captured snapshot.
- PDA linking checks ownership and preserves the estimate snapshot.
- Realtime disconnect/reconnect does not lose commands; refresh reconstructs
  the same room from persisted state.
- Responsive, keyboard, focus, loading, empty, stale/conflict and error states.

### Repository gates for both branches

- dedicated script checks following the existing `node --import tsx` pattern;
- targeted Playwright flows where UI behavior is material;
- `npm run lint`;
- `npm run build` and existing prebuild checks;
- migration review for constraints, indexes, grants, RLS and rollback behavior;
- no unrelated changes or hidden sample fallback in production paths.

## 9. Collaboration protocol

The models do not share a private live conversation. The repository documents,
branches and commit SHAs are the communication channel.

1. Share `docs/opus-fixture-room-handoff.md` with Opus.
2. Opus reads this architecture and the prototype, then writes **review only**
   to `docs/coordination/opus-fixture-room-phase0-review.md` (or returns the
   exact Markdown if it cannot write the repository). It writes no feature code
   during Phase 0.
3. Codex audits that review and records accepted/rejected decisions in this
   document. The user approves the architecture freeze.
4. Each owner implements only its owned paths in its worktree. Each commit is
   small and migration IDs stay inside the reserved range.
5. Each owner hands off a branch/commit with tests, migrations, shared-change
   requests, known risks and screenshots/results.
6. Opus audits the PDA diff; Codex audits the Fixture Room diff. Findings are
   severity-ranked and the original owner fixes them.
7. Codex integrates shared navigation/contracts on the integration branch,
   runs the combined suite and reports the final acceptance matrix.

Every implementation handoff uses this packet:

```text
Module:
Branch and commit SHA:
Architecture version reviewed:
Files/migrations added:
Shared-file changes requested (not made):
Commands/tests run and results:
Security/RLS checks:
Known limitations or data assumptions:
Reviewer questions:
```

## 10. Phase 0 exit criteria

Phase 0 is complete only when:

- Opus has reviewed the Fixture Room portion and shared contracts;
- exact-port/no-area-tariff behavior is accepted;
- tariff ingestion/publication and immutable estimates are accepted;
- Fixture Room states, role boundary and concurrency policy are accepted;
- path and migration ownership is accepted;
- PDA-to-Fixture snapshot contract is accepted;
- unresolved decisions are recorded with an owner, not silently assumed.

No production schema or feature code should be written before that freeze.
