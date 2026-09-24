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

## Database (migrations `20260923200000` … `20260923203000`)

| Object | Purpose |
|---|---|
| `fixture_rooms` | pairing, status, `version`, immutable listing snapshots (no contact PII), disclosure, listing-sync marks |
| `fixture_parties` | `side` (cargo / vessel / mediator) + `capacity` (principal / broker / viewer); `participation_mode` direct or relayed; identity = organisation, member, `contacts` record, platform party or an unresolved party anchored to the listing (amendment A1; enforced by `fixture_parties_identity_ck`) |
| `fixture_terms` | the term sheet copied from `lib/fixture-room/terms.ts` at creation; `status` open / countered / agreed / withdrawn; one `agreed_proposal_id` |
| `fixture_proposals` | immutable bids (cargo side) and offers (vessel side); `party_id` = whose position, `recorded_by_user_id` = who typed it, `relayed` when the mediator recorded it |
| `fixture_subjects` | subjects with a responsible side; the last lift fixes the room in the same statement; a failed subject fails the room |
| `fixture_messages` | room / side / mediator visibility; admin redaction is an audited column change |
| `fixture_events` | the ledger; `seq` = room version; every event of a command carries its idempotency key, the first carries the result |
| `fixture_recap_versions` | immutable recap snapshots (structured + text); acknowledgements are events |
| `fixture_access_log` | every admin read (durable, never pruned) |

Reads: `get_fixture_room`, `get_fixture_room_version`, `list_fixture_rooms`.
Commands: `create_fixture_room`, `invite_fixture_party`,
`respond_fixture_invitation`, `submit_fixture_proposal`,
`withdraw_fixture_proposal`, `accept_fixture_proposal`, `reopen_fixture_term`,
`set_fixture_term_flag`, `add_fixture_subject`, `lift_fixture_subject`,
`fail_fixture_subject`, `extend_fixture_subject`, `fix_fixture_on_subjects`,
`publish_fixture_recap`, `acknowledge_fixture_recap`, `post_fixture_message`,
`agree_fixture_disclosure`, `close_fixture_room`, `redact_fixture_message`.

Every command: resolves the actor as `public.users.id` through
`fn_app_user_id()`, locks the room `FOR UPDATE`, replays a repeated
`idempotency_key` (same arguments → original result; different →
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
are returned to admins only. A TBN vessel's name and IMO are withheld from the
cargo side until disclosure. Side-private and mediator-private messages are
filtered by side; event payloads never carry message text.

Listing status (decision D4): no command writes `cargo_listings` or
`vessel_availability`. Entering `on_subjects` records target statuses
(cargo `OUT`, vessel `ON SUBS`), `fixed` records (cargo `OUT`, vessel
`FIXED`), leaving them records (cargo `IN`, vessel `OPEN`), each as a
`listing_sync.required` event; the read model reports the live statuses and
whether synchronisation is outstanding, and the room links to the existing
listing edit pages. The one-click action in shared listing components is
integration-owned.

Not in this branch (by the freeze): `fixture_pda_links`,
`link_fixture_pda_estimate`, `fn_can_read_pda_estimate` (integration range
`2026092330xxxx`); email / WhatsApp recap delivery (D7); Realtime presence
(v1 polls the version every 5 s).

## Application

- `lib/fixture-room/` — `terms.ts` (catalogue, hints, opening figures),
  `types.ts`, `errors.ts`, `state-machine.ts`, `permissions.ts` (mirror of
  `fn_fixture_capabilities`), `format.ts` (mirror of
  `fn_fixture_display_value`), `schemas.ts` (Zod), `recap.ts`,
  `masking-view.ts` (guard), `listing-sync.ts`, `client.ts` (idempotency key,
  version poll).
- `sdk/app/fixtures.ts` — typed RPC wrappers; commands return the envelope or
  a typed `FixtureError`.
- `app/(dashboard)/dashboard/fixture-room/` — `actions.ts` (server actions on
  the cookie session, Zod-validated), inbox, match builder (candidates from
  the existing `get_matches_for_*` RPCs), room, recap.
- `components/fixture-room/` — `FixtureRoomClient`, `TermRow`, `RoomRails`,
  `MatchBuilder`, `RoomInbox`, `RecapPrint`, `FixtureLocked`,
  `fixture-room.css` (tokens only).

## Known limitations and data assumptions

- `mediation` is always `platform` in v1: Arab ShipBroker is the explicit
  mediator party of every room; a member broker mediator is reserved.
- The creator's party is the principal of the side it owns; a broker
  organisation that posted a listing is the principal of record for it.
- A relayed party never becomes direct: if the organisation behind it later
  gains a seat, the mediator invites that organisation explicitly.
- A room cannot pair two listings owned by the same organisation or member.
- Proposal expiry is lazy: a lapsed proposal is refused on acceptance and
  reported by the read model; no sweep marks lapses.
- `expired` is a mediator / admin close reason; `negotiation_window_ends_at`
  is informational.
- Recap invalidation follows agreed content changes (accept, reopen, subject
  changes, fix, close), not new proposals.
- The tier gate reads `users.subscription_tier` (T3 / T4) and, when the column
  exists, `is_market_partner`; admins always pass.
