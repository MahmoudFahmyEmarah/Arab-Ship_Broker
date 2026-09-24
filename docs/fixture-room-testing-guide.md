# Fixture Room · testing guide (Phase 1)

Every gate the handoff asks for, what it proves, how to run it, and what was
actually executed on 23–24 Sep 2026 in the `feature/fixture-room` worktree.
A result below is claimed only when the command ran to its marker.

## 1 · Pure TypeScript checks (no database)

```
node --import tsx scripts/fixture-room-check.ts
```

Proves the term catalogue, the state machine (transitions, terminal states,
command/status matrix), the capability matrix for charterer / owner / broker /
viewer / admin / invited party, the error vocabulary, value formatting and
parsing, the masking guard, recap determinism, the listing-sync notice, and
source scans (every server action validates through a schema and uses the
cookie session; every member RPC carries `expected_version` +
`idempotency_key` with explicit grants; no internal helper is granted; the
excluded PDA objects appear in no statement; `participation_mode` only; no
command writes the listing tables; RLS enabled and member grants revoked on
every fixture table).

Result: **159 passed, 0 failed** (`FIXTURE ROOM CHECK: ALL ASSERTIONS PASSED`).

Requested for `package.json` (shared, not made): `"test:fixture-room": "node --import tsx scripts/fixture-room-check.ts"` added to `prebuild`.

## 2 · Migration rehearsal and SQL suites (local stack)

```
scripts/fixture-room-harness.sh --reapply
```

Assembles the six self-contained smoke files from `seed_fixture_shape.sql` +
`bodies/*.sql`, then runs `scripts/migration-harness.sh`: baseline fingerprint
→ the four migrations → six suites (each `BEGIN … ROLLBACK`, each must print
`ALL ASSERTIONS PASSED`) → the DOWN file → fingerprint comparison.
`--reapply` puts the module back for the application afterwards. Roll the
module back first (`supabase/rollback/20260923_fixture_room_down.sql`) when
it is already applied, so the baseline fingerprint is a true baseline.

| suite | proves |
|---|---|
| `fixture_state_smoke.sql` | creation (parties, snapshot, version, ref), replay / duplicate / mismatch / sanctioned / catalogue / outsider / tier refusals, invited → negotiating on the first proposal, stale version refused, one accepted proposal = the agreed value, fix on subs (clean when no subjects), subjects added / extended / wrong side refused, reopen on subs → negotiating + sync back to market, last lift → fixed atomically, contact-backed and anchored relayed parties, mediation on behalf (never for a direct party), subject failure → failed, terminal rooms final, successor room |
| `fixture_rls_smoke.sql` | every fixture table and internal helper closed to `authenticated`; outsider / pending member / anon refused; a colleague of a party organisation is a participant; a viewer reads and messages but every commercial command is refused server-side; a T1 invitee acts; admin reads are unmasked and logged, member reads are not, the log is append-only |
| `fixture_masking_smoke.sql` | labels only before disclosure; no identity keys, names, emails, phones or listing notes in member payloads; own organisation visible to itself; disclosure needs both principals, then name + desk label only; TBN masked from the cargo side (room and inbox) until disclosure; side / mediator message privacy; event payloads carry no message text; admin redaction; a contact-backed party discloses a desk name only |
| `fixture_idempotency_smoke.sql` | a retry (same key, old expected_version) replays the original envelope with no new event; reuse with other arguments is `FX_IDEMPOTENCY_MISMATCH`; a missing key is `FX_VALIDATION`; a two-event command replays at its final version; create replays the room |
| `fixture_immutability_smoke.sql` | events, proposals and rooms-with-history refuse UPDATE / DELETE as `postgres` and as `service_role`; only redaction, invalidation and subject-resolution columns may change |
| `fixture_snapshot_smoke.sql` | listing edits and a position going `FIXED` neither blank nor rewrite the room, recap or inbox (the charterer reads a room whose vessel row listing RLS now hides); `on_subjects` records the requirement (cargo OUT, vessel ON SUBS), writes nothing to the listings, and the view clears once the owner updates them |

Result (24 Sep 2026, local): **HARNESS: OK (4 migrations, 6 suites, 1 downs)**;
schema fingerprint identical to the baseline after DOWN, 0 residue lines.
Earlier runs on the same shared database showed `pda_*` catalogue lines
changing between the two fingerprints while the PDA branch's own harness ran;
the wrapper therefore ignores `pda_|tariff|_pda` lines (every Fixture object
is `fixture_*`, so Fixture residue would still be reported).

Result (25 Sep 2026, local, final SQL including the `FX_VERSION_CONFLICT`
55000 change): **HARNESS: OK (4 migrations, 6 suites, 1 downs)**; fingerprint
identical, 0 residue lines; all four migrations re-applied.

The first run that day found a rollback defect. An earlier browser run had
been cut off by the Docker outage before its cleanup, so one room existed
when the DOWN ran and the DOWN took its rename-to-backup path. A renamed
table keeps its index, constraint and identity-sequence names, so the
`--reapply` that followed said `create … if not exists` for every index and
silently created none: the live `fixture_rooms` came back with only its
primary key and `ref` constraint, and the race test then created two rooms
for one pairing. The DOWN now renames the indexes, index-backed constraints
and owned sequences with the same suffix (base cut to 44 characters for the
63-character identifier limit; the first attempt truncated
`fixture_recap_versions_room_id_version_no_key_bak_…` and collided), and the
wrapper allows `_bak_20260923200000` residue lines, which the migration
harness documents as the residue a DOWN may leave. The rename path was then
exercised in a rolled-back transaction: one synthetic room → DOWN → nine
backup tables, 0 unsuffixed index or sequence names → the four migrations
again → all eight `fixture_rooms` indexes present, five unique indexes on
`fixture_parties`, `fixture_events.id` on `fixture_events_id_seq`, the room
still in the backup. The orphaned browser-run rows were removed from the
local database before the clean re-run above.

## 3 · Two-session optimistic-concurrency race (local stack, commits)

```
supabase/tests/fixture_room/fixture_race_two_sessions.sh
```

Session A submits a proposal at version V and holds its transaction 4 s;
session B submits at the same V one second later, waits on the row lock and is
refused with `FX_VERSION_CONFLICT`. Then two sessions create the same pairing.

Result: **ALL ASSERTIONS PASSED** — one `proposal.submitted` event, one
proposal row, version V+1, session A's proposal landed, B refused with
`FX_VERSION_CONFLICT`, one room for the raced pairing, the second creator
refused with `FX_CONFLICT`. Re-run 25 Sep 2026 against the final SQL after
the harness above: **8/8, ALL ASSERTIONS PASSED**. (The run between the two
harness runs failed exactly the two pairing assertions, which is how the
missing unique index in section 2 was noticed.)

## 4 · Integration over the real API (local stack, PostgREST + member JWTs)

```
node --import tsx scripts/fixture-room-integration-check.ts
```

Creates two member seats through the service role, signs them in, and runs
create → replay → outsider refused → direct table reads refused → owner accepts
→ bid / offer → stale version refused → accept → recap published and
acknowledged → inbox, through the same SDK the server actions use.

Result (24 Sep 2026, local): **20 passed, 0 failed**
(`FIXTURE ROOM INTEGRATION: ALL ASSERTIONS PASSED`).

This run found a real defect the psql suites could not see: version
conflicts were raised with SQLSTATE 40001, and PostgREST retries any request
that fails with a serialization failure, so a stale command spun until the
gateway answered "The upstream server is timing out". `FX_VERSION_CONFLICT`
now raises 55000; the prefix stays the discriminator. An earlier attempt was
blocked by the local Auth service timing out against Postgres while the
containers reported `unhealthy` (the stack is shared with the PDA branch);
it recovered without a restart from this worktree.

## 5 · Browser suites (Playwright, local stack + dev server)

```
E2E_SUPABASE_SERVICE_ROLE_KEY=… E2E_SUPABASE_ANON_KEY=… npx playwright test e2e/fixture-room.spec.ts e2e/fixture-room-a11y.spec.ts e2e/fixture-room-responsive.spec.ts --project=edit
```

The shared `playwright.config.ts` starts the dev server against the local
stack and its global setup seeds the three admin seats; the Fixture specs
ignore those storage states, seed two MEMBER seats (charterer + owner, with a
cargo and a position the platform's own match rules pair) through
`e2e/fixture-room.helpers.ts`, sign in through the real form, and remove
their rows afterwards.

| spec | asserts |
|---|---|
| `fixture-room.spec.ts` | builder from `?cargo=`, room at v2 invited, invitation in the owner's inbox and accepted, bid → holder chip, the owner's tab picks it up by polling, counter-offer, stale tab refused with the conflict banner and refreshed, accept → one agreed value on both tabs, recap published and acknowledged, masked activity feed, reload reconstructs the same room, printable recap |
| `fixture-room-a11y.spec.ts` | term strips are buttons with `aria-expanded`, toggle with Enter and Space, labelled composer fields, visible focus ring, polite live region, Tab reaches the strips |
| `fixture-room-responsive.spec.ts` | 390 / 768 / 1280 / 1440 px: no horizontal overflow, rail beside the main column above 1120 px and below it otherwise, footer reachable |

Result (24–25 Sep 2026, local stack, dev server on port 3100 because port
3000 was held by another dev server):

- `fixture-room-a11y.spec.ts`: **3 passed**.
- `fixture-room-responsive.spec.ts`: **5 passed** (390 / 768 / 1280 / 1440).
- `fixture-room.spec.ts`: **tests 1 and 2 passed** (builder → room at v2
  invited; owner's inbox invitation, accepted → v3) in the run that reached
  them; **test 3 failed on an assertion budget, not on behaviour**: the
  Playwright trace shows the bid accepted by the server (`ok:true`, room
  `negotiating`, version 4) while the 10 s `expect` expired before the
  post-command refetch (a dev-mode server action takes 5–15 s here). The spec
  now uses a 30 s assertion budget and 300 s per test; the rerun with those
  budgets aborted after five minutes when Docker Desktop stopped ("Docker
  Desktop is unable to start"), taking the local stack with it, so tests 3
  and 4 were not claimed at the first commit.
- `fixture-room.spec.ts`, 25 Sep 2026 after the stack returned and the
  section 2 re-run: **4 passed (5.1 min)** on a freshly started dev server
  (port 3100). One earlier attempt that day failed on test 1 with the
  application's 404 page for `/dashboard/fixture-room/new?cargo=…` from a
  dev server that had been running since before the module was dropped and
  re-applied on the local database; the unauthenticated probe of the same
  route on that server still redirected to login, and the same code on a
  fresh server served the route in 5.9 s and passed. The cause of that
  instance's 404 was not determined; it is recorded here rather than
  explained.

Defects the browser runs found and fixed along the way: a strict-mode
selector in the spec; `useNow()` reading the clock during server rendering
(a hydration mismatch in every room and inbox render — the clock is now 0
until mounted); the shell's cookie-consent banner and vessel-owner position
check-in modal intercepting clicks (the helper answers them the way a member
does, after every navigation).

## 6 · Type-check, lint, build

- Targeted type-check (`tsc --noEmit` over the Fixture Room files through a
  temporary tsconfig): **0 errors** after fixing nine defects the first pass
  found (union narrowing, a Zod-inferred term type, a regex flag).
- `npx eslint` on `lib/fixture-room`, `components/fixture-room`,
  `sdk/app/fixtures.ts`, `app/(dashboard)/dashboard/fixture-room`,
  `scripts/fixture-room-*.ts`, `e2e/fixture-room*.ts`: **clean** after fixing
  two React-compiler rule errors and one unused parameter.
- `npm run lint` (whole project): **exit 1 — 7 errors, 8 warnings, none in a
  Fixture Room file.** The errors are pre-existing on `dev`
  (`components/portal/market-boards.tsx` ref access during render ×6,
  `components/ledger/cargo/steps/QuantityStep.tsx` unescaped entity); they are
  outside the owned paths and were not touched.
- `npm run build` (with the `prebuild` checks): **exit 0** — compiled in
  3.5 min, `/dashboard/fixture-room`, `/dashboard/fixture-room/new`,
  `/dashboard/fixture-room/[id]` and `/dashboard/fixture-room/[id]/recap`
  emitted as dynamic routes.
