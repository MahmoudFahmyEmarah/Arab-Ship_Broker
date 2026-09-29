# Market / TBN privacy firewall

Status: implementation checkpoint; local only. This design does not authorize a
merge, push, deployment, or production migration.

## Why this boundary exists

Masking the label of a TBN vessel is insufficient when a member can still read
an availability UUID, join it to a vessel UUID, and query the vessel name or
IMO through another table, view, RPC, URL, server action, or browser payload.
The market boundary therefore treats identifiers as identity-bearing data.

The firewall has two layers:

1. Governed market RPCs return actor-bound opaque listing keys and the minimum
   market data the current viewer may use.
2. After every application caller is cut over, RLS and ACL closure removes the
   legacy raw-ID correlation paths.

Fixture Room keeps its own private candidate-handle domain. A market key is
never a Fixture key, a vessel foreign key, or a raw listing preselection.

## Invariants

- A non-owner receives no cargo-listing UUID, availability UUID, or vessel UUID.
- An unowned TBN vessel is rendered as `TBN`; its name and IMO are null/masked
  at the database boundary, not in client code.
- Named non-TBN identity and market specifications remain visible. The vessel
  registry may expose its stable vessel ID through the existing allow-listed
  registration/availability workflow; that deliberate scope does not include
  a cargo-listing or vessel-availability ID, and market results still use only
  opaque listing keys. TBN registry identity remains owner/admin-only.
- A raw owned listing ID is returned only to an exact owner, a current and
  active seat in the exact owning organisation, or an administrator.
- An unowned TBN suppresses poster name/company/kind as well as every poster
  identifier; the UI may add only a fixed `Platform brokered` label. Named
  non-TBN and cargo output may contain governed poster display fields, never an
  organisation or user UUID.
- Handles are random UUIDv4 values, bound to `public.users.id`, listing kind,
  purpose, and the resolved database listing. They are not bearer secrets.
- An active handle is reused for the same actor/purpose/listing and its expiry
  is refreshed. Expired handles rotate; abandoned rows older than one day are
  purged once per top-level request with a fixed bound, not once per returned
  row, so repeated board refreshes cannot grow storage or cleanup work without
  bound.
- Every top-level request resolves its full handle set in one bulk operation.
  Conflicting tuples use one universal `(listing type, listing id,
  match-before-board, purpose)` lock order, and retention runs only after the
  response has been assembled. Inverse cargo/vessel requests therefore cannot
  deadlock by acquiring source and target handles in opposite orders.
- Board and match assembly resolves tier/configuration once, materializes live
  counterpart sets once, and groups match counts once for the full response.
  Exact ownership/poster metadata is bulk-resolved and the final JSON renderers
  perform no query. A dense 200-by-200 match cache therefore causes one
  40,000-edge grouped join, not 40,000 policy/configuration function calls.
- Match drill-down is ordered and capped at 500 counterparts. Board caps remain
  1,000 cargo and 500 vessel positions; pagination is a later API concern and
  cannot be emulated by widening these server limits from the browser. Every
  capped selection and JSON aggregate ends with the listing UUID as a stable
  tie-breaker, so equal timestamps/scores cannot shuffle between refreshes.
- Subscription tier, archive horizon, spot window, and vessel-active window
  are derived on the server. Optional caller dates may only narrow those
  windows; null or historic input can never widen them.
- PDA may copy governed public vessel specifications, but a market handle is
  never persisted in `vessel_id` or another foreign-key column.
- Only an actor-owned raw listing may preselect a Fixture source. A non-owned
  market match opens the generic Fixture builder, which resolves the pairing
  through Fixture's independent candidate-key protocol.

## Governed API

All functions are authenticated-only, `SECURITY DEFINER`, have a fixed
minimal `search_path`, resolve the actor through the application-user mapping, and
enforce live/review/freshness rules themselves.

### `list_market_cargo`

`list_market_cargo(p_archive_cutoff date default null,
p_spot_active_from date default null) returns jsonb`

Returns safe cargo cards. `id` and `listing_key` are the opaque key. Each item
contains `is_owned`, `can_manage`, and `owned_listing_id`; the last value is
null unless the actor may manage that exact listing.

### `list_market_vessels`

`list_market_vessels(p_archive_cutoff date default null,
p_vessel_active_from date default null) returns jsonb`

Returns safe position cards. The nested vessel object never contains a raw
vessel UUID for an unowned position. An unowned TBN has `vessel_name = 'TBN'`
and a null IMO. Named market identity and non-sensitive specifications remain.

### `list_market_matches`

`list_market_matches(p_listing_key uuid) returns jsonb`

Accepts only an unexpired handle belonging to the current actor and an allowed
market purpose. It revalidates the source listing, returns only governed live
counterparts, and issues purpose-specific `cargo_match` or `vessel_match`
handles. Fit/explanation data is computed server-side from the governed match.
Each match also carries a separate `board_listing_key` for board selection and
map correlation. Match-purpose keys are accepted by detail only and cannot be
used recursively as a match source.

### `get_market_listing_detail`

`get_market_listing_detail(p_listing_key uuid) returns jsonb`

Returns the same governed listing shape for a board or match key. Ownership and
commercial-management identity are owner/admin-only.

`list_my_cargo`, `list_my_vessels`, and
`get_managed_vessel` are management-only reads. They use the same exact
personal/current-active-organisation ownership rule, retain pending or closed
owned records for editing, and return not-found to an outsider. Position
check-in uses that identical ownership rule.

Errors use the stable prefixes `MARKET_AUTH`, `MARKET_NOT_FOUND`,
`MARKET_EXPIRED`, and `MARKET_VALIDATION` with SQLSTATEs `42501`, `P0002`,
`55000`, and `22023` respectively. Client actions translate these to governed
messages and never forward raw database diagnostics.

`review_queue` and `v_admin_queue_detail` are administrator ledgers. Ordinary
members cannot read their raw listing IDs, sampling/trust decisions, reasons,
reviewer identity, notes, or amendments. `list_my_review_statuses` is the only
member projection: it is dual-key aware, bounded to 200 rows, and returns only
listing kind, lifecycle status/action, and timestamps. The administrator view
still returns one row per queue item when the two historical identity
namespaces collide; in that ambiguous case it leaves submitter profile fields
blank instead of duplicating the item or guessing an identity.

## Deployment order

1. Apply the additive handle/API migration. It does not revoke a legacy caller.
2. Deploy the application cutover and verify browser/network canary scans.
3. Apply the closure migration, which revokes legacy member/anonymous surfaces
   and tightens table/view policies. Member updates are restricted to explicit
   business columns; review status and publication fields remain service/admin
   workflow state. This is the release gate; steps 1 and 2 do not by themselves
   make the current application safe.
4. Apply the moderation-ledger closure, which makes `review_queue` and its
   administrator view admin-only and adds the safe member status projection.
5. Run the post-closure SQL, two-session, browser, build, accessibility, and
   responsive suites before accepting the release candidate.

The repository may compose the two migrations in one atomic pre-deployment
chain only when the new application build is deployed in the same maintenance
window. Otherwise use the staged order above to avoid breaking old clients.

## Legacy surfaces closed after cutover

- `get_matches_for_cargo` and `get_matches_for_availability` for members/anon;
- direct member/anon reads of `matches`, `v_live_cargo`, `v_live_vessels`,
  `v_cargo_match_counts`, `v_vessel_match_counts`, `v_admin_queue`, and
  `v_eligible_matches`;
- arbitrary-ID `get_listing_posters` and `count_live_matches` calls;
- ungoverned TBN reads through `vessel_availability`, `vessels`, and
  `v_vessel_detail`;
- member/anon execution of match-refresh functions, including signatures found
  only in the deployed catalogue; and
- non-admin access to vessel flag-issue views; and
- ordinary-member reads of the raw moderation queue or joined administrator
  queue view.

The historical vessel-posting RPC signatures stay available for compatibility,
but their original bodies become private. Public wrappers lock and resolve the
active actor, require exact current ownership for an existing hull, validate
the entry mode and IMO before mutation, and serialize same-IMO creation across
all participating writers. A supplied existing vessel/IMO is never an
ownership shortcut; genuinely new named or TBN hull creation remains allowed.

Service-owned refresh/administration remains available explicitly, but the
four governed market discovery APIs are authenticated-member APIs rather than
service-role APIs. Owner edit flows remain available through exact current
ownership, including a current, active seat in the exact owning organisation.

The closure rollback is emergency-only. Forward migrations snapshot exact
pre-closure relation, column and routine grants (including grantor and grant
option), every replaced market/moderation policy (including policy-role
ordinality), in the private schema. A migration refuses delegated ACL chains
or a grantor the executor cannot assume, before closing a public surface; this
keeps the flat DOWN replay exact instead of guessing dependency order. DOWN
restores the snapshots before removing them. Rollback must still be treated as
a deliberate privacy-boundary reversal, never an ordinary application recovery
step.

## Proof required before release

- SQL: outsider, pending/ended/unrelated seat, owner, current active exact org
  seat, admin, service, and anonymous cases across every table/view/RPC bypass.
- Payload canaries: seeded hidden availability UUID, vessel UUID, name, IMO and
  poster identity are absent from safe RPC JSON and member-visible errors.
- Handles: actor and purpose binding, active reuse, expiry rotation, cleanup,
  wrong-actor indistinguishability, deterministic inverse-request contention,
  and two-session issuance/use races.
- Legacy writes and review status: zero-write existing-hull takeover denial,
  same-IMO writer races, exact owner/admin/new-hull compatibility, raw queue
  denial, dual-key member projection, and absence of moderation canaries.
- Browser: scan initial HTML, RSC/action responses, direct Supabase responses,
  links, detail panels, map/popovers, port activity, PDA handoff, and telemetry.
- Compatibility: named-vessel browsing and owner/admin management still work;
  PDA never saves a handle as a vessel FK; Fixture never consumes a market key.
- Lifecycle: forward migration, rollback fingerprint/residue check, and reapply
  on a disposable database, followed by the full production build.
- Performance: on an empty disposable database named `*market_perf*`, run the
  opt-in 200 cargo / 200 vessel / 40,000 match-edge benchmark. Warm p95 must be
  at most 750 ms for either board, 900 ms for cargo match drill-down, and 150 ms
  for one listing detail; every endpoint must also return its exact tagged row
  count. The benchmark is intentionally refused on the shared local database.

## Latest isolated validation (29 September 2026)

- Pure release-shape checks: 230 passed, 0 failed.
- Disposable `asb_market_privacy` lifecycle: three migrations forward, the
  transactional M1-M27 privacy suite, all three DOWN files, an identical
  baseline fingerprint with no private residue, and reapply all passed.
- Real two-session checks: handle issue/rotation/detail/match races 4/4 and
  vessel-post/IMO serialization races 4/4. The leak scan uses Bash literal
  matching so a crashed external matcher cannot produce a false pass.
- Hardened `asb_market_perf` scale gate: exactly four endpoints and five
  samples per endpoint, with exact min/max returned and tagged counts. Observed
  p95 was 375.95 ms (cargo board), 372.20 ms (vessel board), 481.50 ms
  (cargo matches), and 123.43 ms (detail), all below the release thresholds.
- Targeted ESLint passed for all 43 changed TypeScript/TSX files; Bash syntax,
  pure checks, and `git diff --check` passed. Independent ACL/privacy and
  performance re-audits both returned ACCEPT.

Whole-project TypeScript and the production/browser suite remain composition
gates, not failures of this isolated branch. Its base still contains the older
Fixture action that imports the legacy raw match SDK removed by this firewall;
the frozen Fixture branch has already replaced that path with candidate
handles. The final composed worktree must use that frozen Fixture revision and
rerun TypeScript, production build, and all browser suites before release.
