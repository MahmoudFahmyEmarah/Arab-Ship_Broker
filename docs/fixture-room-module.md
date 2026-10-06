# Fixture Room · Phase 1 (architecture 1.0)

Branch `feature/fixture-room` · implementation owner Opus · 23 Sep 2026.
Binding specification: `docs/phase-0-pda-fixture-architecture.md` v1.0,
`docs/coordination/codex-fixture-room-phase0-freeze.md`,
`docs/coordination/opus-fixture-room-phase1-handoff.md`.

## What it is

One room pairs one `cargo_listings` row with one `vessel_availability` row
and keeps a server-authoritative, append-only negotiation record. Members
use it at `/dashboard/fixture-room` (inbox), `/new` (match builder), `/[id]`
(the room) and `/[id]/recap` (printable recap). Every read and write is a
governed RPC; the fixture tables have RLS and no member grant, so PostgREST
cannot serve them directly.

## Database (migrations `20260923200000`…`203000` and `20260923206000`…`208000`)

| Object | Purpose |
|---|---|
| `fixture_rooms` | pairing, status, `version`, immutable listing snapshots (no contact PII), disclosure, listing-sync marks |
| `fixture_parties` | `side` (cargo / vessel / mediator) + `capacity` (principal / broker / viewer); `participation_mode` direct or relayed; identity = organisation, member, `contacts` record, platform party or an unresolved party anchored to the listing (amendment A1; enforced by `fixture_parties_identity_ck`). A principal's identity is the listing's **ownership row**: the owning organisation when the actor holds a current active seat there, otherwise the member personally; a seat is never guessed from the owner's other memberships (audit FR-H1) |
| `fixture_terms` | the term sheet, copied at creation from `fn_fixture_term_catalogue(version)`; the caller's copy must match that versioned sheet term for term (only the listing hint may vary) and the version is kept in `fixture_rooms.term_catalogue_version` (audit FR-H2); `status` open / countered / agreed / withdrawn; one `agreed_proposal_id` |
| `fixture_proposals` | immutable bids (cargo side) and offers (vessel side); `party_id` = whose position, `recorded_by_user_id` = who typed it, `relayed` when the mediator recorded it |
| `fixture_subjects` | subjects with a responsible side; the last lift fixes the room in the same statement; a failed subject fails the room |
| `fixture_messages` | room / side / mediator visibility; admin redaction is an audited column change |
| `fixture_events` | the ledger; `seq` = room version; every event of a command carries its idempotency key, the first carries the result |
| `fixture_recap_versions` | immutable recap snapshots (structured + text); acknowledgements are events |
| `fixture_access_log` | every content-bearing admin read (`get_fixture_room`, `list_fixture_rooms`; durable, never pruned). The five-second version poll returns one integer and is not logged (audit FR-L1) |

Rollback: `supabase/rollback/20260923_fixture_room_down.sql` drops the
module when no room exists and otherwise keeps every table as
`*_bak_20260923200000`. When it keeps them it also renames their indexes,
index-backed constraints and identity sequences with the same suffix
(base cut to 44 characters for the identifier limit): a renamed table keeps
those names, and a later re-apply's `create … if not exists` would otherwise
skip every named index and bring the module back without its unique
indexes (found and fixed 25 Sep 2026).

Reads: `get_fixture_room`, `get_fixture_room_version`, `list_fixture_rooms`,
`list_fixture_match_candidates`, `list_fixture_my_listings`, and for the admin
console `admin_fixture_access_log` (admin-only inside; reading the log is not
itself logged).
Commands: member room creation uses `create_fixture_room_from_candidate` with
a private, actor-bound selection handle; `create_fixture_room` is service-role
only after `208000`. Other commands are `recreate_fixture_room`,
`invite_fixture_party`,
`respond_fixture_invitation`, `submit_fixture_proposal`,
`withdraw_fixture_proposal`, `accept_fixture_proposal`, `reopen_fixture_term`,
`set_fixture_term_flag`, `add_fixture_subject`, `lift_fixture_subject`,
`lift_all_fixture_subjects`,
`fail_fixture_subject`, `extend_fixture_subject`, `fix_fixture_on_subjects`,
`publish_fixture_recap`, `acknowledge_fixture_recap`, `post_fixture_message`,
`agree_fixture_disclosure`, `close_fixture_room`, `redact_fixture_message`.

Every command: resolves the actor as `public.users.id` through
`fn_app_user_id()` and refuses an inactive account (`users.is_active = false`
— the shape account erasure leaves behind, so an anonymised member cannot
read, poll, answer or create as its former party), its seats through
`fn_fixture_member_org_ids()`
(current AND active; the shared `fn_my_org_ids()` checks current only — audit
FR-M1), locks the room `FOR UPDATE`, replays a repeated `idempotency_key`
(same arguments → the result-bearing event's envelope at the final version,
even when an observation such as `proposal.lapsed` was written first — audit
FR-M2; different arguments anywhere in the group →
`FX_IDEMPOTENCY_MISMATCH`), checks `expected_version`
(`FX_VERSION_CONFLICT`), checks state and capability, writes rows and events,
returns `{ok, version, eventId, replayed, data}`. Errors are standard SQLSTATE
classes with `FX_AUTH:`, `FX_STATE:`, `FX_VERSION_CONFLICT:`,
`FX_IDEMPOTENCY_MISMATCH:`, `FX_VALIDATION:`, `FX_NOT_FOUND:`, `FX_CONFLICT:`,
`FX_GATE:`, `FX_IMMUTABLE:` prefixes (decision D6). `FX_VERSION_CONFLICT` raises
55000, deliberately not 40001: PostgREST retries requests that fail with a
serialization failure, so a conflict raised as 40001 never reaches the
client (found by the API integration check).

State machine: `draft → invited → negotiating → on_subjects → fixed`, with
`withdrawn | failed | expired` terminal. Creation always resolves a
counterparty, so rooms start `invited`; the first proposal (allowed while
invited) moves the room to `negotiating`; `fix_fixture_on_subjects` needs every
required term agreed and both principals active, lands on `fixed` at once when
no subject is open; reopening a term on subjects returns the room to
`negotiating`; terminal rooms never reopen (a successor room may be created).

Masking (decision D2): a counterparty is a side-safe label until both
principals agreed to disclosure; afterwards its organisation name and desk
label — never a person's name, email or phone. Raw org / user / contact ids
are returned to admins only. A TBN vessel's name, IMO and stable identifiers
(`room.vesselId`, `snapshot.vessel.vessel.id`,
`snapshot.vessel.availability.vessel_id`, `listingSync.vessel.vesselId`) are
withheld from the cargo side until disclosure, and the creation event carries
no vessel id at all (audit FR-H3); the listing-sync notice links a listing
only for the side that owns it. Side-private and mediator-private messages
are filtered by side; event payloads never carry message text.

Invitations: a member holding more than one invitation in a room (an
organisation seat and a personal one) names the party it answers for
(`respond_fixture_invitation … p_party_id`); an unnamed answer with several
invitations is `FX_VALIDATION`, a party that is not one's own is `FX_AUTH`
(audit FR-M3).

Listing status (decision D4): room-state transitions never write
`cargo_listings` or `vessel_availability`. Entering `on_subjects` records target statuses
(cargo `OUT`, vessel `ON SUBS`), `fixed` records (cargo `OUT`, vessel
`FIXED`), leaving them records (cargo `IN`, vessel `OPEN`), each as a
`listing_sync.required` event; the read model reports the live statuses and
whether synchronisation is outstanding, and the room links to the existing
listing edit pages. A separate governed one-click sync command may apply the
recorded target only to the listing the current side owns.

The composed release also supplies `fixture_pda_links`,
`link_fixture_pda_estimate` and `fn_can_read_pda_estimate` through the shared
integration migration. Email / WhatsApp recap delivery (D7) and Realtime
presence remain deferred; v1 polls the version every 5 s.

## Application

### Presentation (Phase 1.1, design alignment · commit 1, 27 Sep 2026)

The room, the match builder, the inbox and the tier lock render the approved
standalone design (`asb/negotiation-room`) on its own stylesheet, lifted rule
for rule from the design bundle onto `app/design-tokens.css` (no colour
literal survives; `components/fixture-room/fixture-room.css`, sections A–C).
The vocabulary is the design's: `nr-*` for the shell, header, rail, footer
and banners; `fx-*` for the term strips, threads, composer, timeline and
toasts; `fxm-*` for the match builder and the inbox head; `rc-*` for the
recap slots; `estimator-locked` for the tier lock. The buttons and inputs are
the portal's `.asb-btn` / `.asb-input`, as on the Post Cargo and Post
Position pages. A short portal-fit block lets the page scroll and sticks the
footer, because the prototype filled a fixed frame. What the design adds and
how it maps to the governed model:

- header actions: bunker ticker (the portal's `BunkerTicker`), sound toggle
  (a WebAudio chime on the other side's moves, preference in the browser),
  export deal summary (`lib/fixture-room/summary.ts`, built from the masked
  read model; the PDF of commit 4 replaces the text file), the Ports Cost
  Estimator hand-off (`/dashboard/ports-da?from=fixture&roomId&vesselId&load&disch&mt`,
  ids and ports only, honoured once the estimator reads the parameters), the
  recap page and "new fixture"; the phase pill and the reply-window clock
  (`negotiationWindowEndsAt`);
- toasts for the other side's moves, derived from the events that arrive
  between two version polls (never invented);
- presence chips per side from the ledger (`lib/fixture-room/presence.ts`:
  the latest event a side wrote → online within five minutes, away within
  the hour, off beyond; decision D-3, no Realtime);
- strips: holder chip with a presence dot, both figures with turn and final
  highlights, spread text and a gap bar against the first-round gap, the
  validity countdown of the figure awaiting an answer, the round badge;
- threads: presence row with the validity ring, three lanes (cargo, broker,
  vessel) of bids, offers, notes and nudges pinned to the term, the composer
  with labelled fields for the viewer's seat, "Use listing figure", "Match
  their figure", final and validity controls, hold and refer for the
  mediator, lapse recovery ("Re-send · fresh 12:00" resubmits the same
  figure with a twelve-minute validity), the final-position flags (decision
  D-4: each side's `isFinal`; agreement stays by accept);
- rail: the counterparty card with the two disclosure ticks (decision D-1:
  no fee amount), recap slots mirroring the strips with linked hover,
  subjects as the design's checklist buttons, messages as thread bubbles,
  the activity log;
- match builder: cards with a fit tier (strong / possible / weak) and up to
  three reasons computed only from the listing fields the card shows
  (capacity, rate alignment, laycan vs open date, gear for breakbulk); the
  candidates themselves still come from the platform's match RPCs;
- glossary tooltips on chartering abbreviations (`lib/fixture-room/glossary.ts`).

Nothing in the governed layer changed: same RPCs, same envelope, same
masking, same test ids for the browser suites.


- `lib/fixture-room/` — `terms.ts` (catalogue, hints, opening figures),
  `types.ts`, `errors.ts`, `state-machine.ts`, `permissions.ts` (mirror of
  `fn_fixture_capabilities`, and `canUseFixtureRoom`: decision D3 in one
  place for the pages, mirroring `fn_fixture_tier_ok` — audit FR-M4),
  `viewer.server.ts` (the signed-in viewer for the page gates; the
  market-partner flag is read explicitly and is false wherever the column
  is absent), `format.ts` (mirror of `fn_fixture_display_value`),
  `schemas.ts` (Zod), `recap.ts`, `masking-view.ts` (guard, incl. TBN
  identifiers), `listing-sync.ts`, `client.ts` (`GestureKeys` + `runGesture`:
  one idempotency key per gesture, kept across transport failures until the
  server answers, so a retry replays and busy state is always released —
  audit FR-M5; version poll).
- `sdk/app/fixtures.ts` — typed RPC wrappers; commands return the envelope or
  a typed `FixtureError`.
- `app/(dashboard)/dashboard/fixture-room/` — `actions.ts` (server actions on
  the cookie session, Zod-validated), inbox, match builder (candidates from
  the existing `get_matches_for_*` RPCs), room, recap.
- `components/fixture-room/` — `FixtureRoomClient`, `TermRow`, `RoomRails`,
  `MatchBuilder`, `RoomInbox`, `RecapPrint`, `FixtureLocked`,
  `fixture-room.css` (tokens only).

## Admin console (26 Sep 2026)

`app/(admin)/admin/fixtures` lists every room and opens one with the read
model exactly as the database returns it to an admin: identities unmasked,
the ledger with actor ids and idempotency keys, recaps, and the room's
durable access log. Two platform actions: redact a message and close a room
as failed or expired; each form carries the idempotency key it was rendered
with, so a resubmit replays. The pages gate on admin section `fixtures`,
which the shared registry does not know yet (request S5), so `canAccess`
admits the owner and bounces every sub-admin until it is registered. Every
read and write uses the admin's own session through the governed RPCs; no
service-role client and no direct table read. The database's admin authority
is `fn_is_admin()`; since the integration commit `7fb2064` (26 Sep 2026) that
is the JWT claim `app_metadata.role = 'admin'` AND a current, active `users`
row with role admin, so a session without the claim, or demoted after its
token was issued, is told so on both pages and is treated as a member by the
ledger. The console has no
member-facing surface; the member room already gives admins the mediator's
tools.

## Known limitations and data assumptions

- `mediation` is always `platform` in v1: Arab ShipBroker is the explicit
  mediator party of every room; a member broker mediator is reserved.
- The creator's party is the principal of the side it owns; a broker
  organisation that posted a listing is the principal of record for it.
- A relayed party never becomes direct: if the organisation behind it later
  gains a seat, the mediator invites that organisation explicitly.
- A room cannot pair two listings owned by the same organisation or member.
- Enforcement (6 Oct 2026, `20261006100000_fixture_room_enforcement.sql`,
  release audit PR-07 / PR-08):
  - **Two-sided fix.** `fix_fixture_on_subjects` records the acting side's
    confirmation with a fingerprint of the agreed terms and the subjects. The
    room moves to on subjects (or straight to fixed with no subjects) only
    when the charterer side and the owner side have confirmed the same
    fingerprint. An accept, a reopen or a new subject voids an earlier
    confirmation. The mediator confirms only for a relayed party it names.
    The read model reports `viewer.capabilities.fixConfirmedSides`.
  - **Hold and refer.** A held or referred term takes no proposal and no
    acceptance. A fix waits until no term is held or referred. Only the
    holder resumes and only the referring side clears a referral; the
    mediator may do both.
  - **Reopen from on subjects** reinstates every lifted subject
    (`subject.reinstated`) and leaves at least three days of window.
  - **Negotiation window.** Every room gets 14 days from creation; open rooms
    at the migration got 14 days from then. Moves and fixes are refused once
    it closes. The mediator extends it (one hour to 60 days ahead) with
    `extend_fixture_negotiation_window`.
  - **The clock.** `run_fixture_room_clock()` (service role only) observes
    each lapsed proposal once and expires invited / negotiating rooms whose
    window closed, as a System `room.closed` with reason `expired`. pg_cron
    runs it every five minutes as `fixture-room-clock`.
  - DOWN: `supabase/rollback/20261006_fixture_room_enforcement_down.sql`.
- The notification projector (`205000` on the fixture branch) still needs the
  shared notification core, which is not on `dev`; parties learn of moves by
  polling the room until it ships.
- Subject deadlines are shown, not enforced: a subject past its deadline
  stays open until a side lifts or fails it.
- Recap invalidation follows agreed content changes (accept, reopen, subject
  changes, fix, close), not new proposals.
- The tier gate reads `users.subscription_tier` (T3 / T4) and, when the column
  exists, `is_market_partner`; admins always pass. The page gate uses the
  same rule (`canUseFixtureRoom`). The column was missing from the active
  baseline; the integration migration `20260923340000_user_market_partner_flag.sql`
  (Codex, `b73fd42`, 26 Sep 2026) restores it as a service-managed flag the
  privilege guard keeps out of a member's own reach, so the approved path
  is live on the integration chain. R6 of the RLS suite proves it wherever
  the column exists and reports a skip where it does not.
- A member with two active seats represents a listing as the organisation
  on its ownership row only; a colleague from the member's other seat is not
  a participant. A personally owned listing is represented by the member
  even when the member also holds seats elsewhere.
- The admin authority for every Fixture read and command is `fn_is_admin()`
  together with an active administrator row, never `users.role` alone.
  Migration `20260923330000_user_privilege_boundary.sql` closes the former
  self-update escalation path: authenticated members may update only their
  own `full_name`, `company`, `phone` and `updated_at`; role, tier, partner
  entitlement, trust and administrator fields remain service-managed. The
  migration also synchronises the Auth `app_metadata.role = 'admin'` claim,
  while `fn_is_admin()` requires both that claim and the current active admin
  row. Mailbox issue O2C-004 is closed on the integration release.
