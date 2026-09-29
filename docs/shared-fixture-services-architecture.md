# Shared Fixture services architecture

Status: isolated implementation checkpoint; not composed or released

Owner approval: Fixture Room Phase 1.1 PDF export and in-app/email
notifications. WhatsApp escalation is explicitly deferred.

## Scope and ownership

This branch owns only shared infrastructure used by Fixture Room:

- the private `fixture-recaps` Storage bucket;
- the server PDF renderer dependency;
- durable in-app notification records, member preferences and email-delivery
  leases;
- session-scoped member RPCs, a service dispatcher, and the shared portal bell.

Fixture Room continues to own event-to-notification projection, recipient
selection, masking-aware wording, PDF document components, and its PDF routes.
The projector may call the shared enqueue RPC but may not write shared tables.

No file in `feature/fixture-room` or `feature/pda-design-alignment` is edited in
this worktree. Composition happens only after read-only cross-audit and owner
approval.

## Implemented checkpoints

The first isolated checkpoint (`014bc3a`) provides the renderer dependency,
private bucket migration, notification/preference/delivery schema, member and
service RPCs, rollback, and transactional behavior coverage.

The second isolated checkpoint adds the authenticated manual/scheduler route,
bounded service dispatcher, stable delivery Message-ID, masking-safe branded
email rendering, fake-transport behavior tests, and the real member
notification bell in the Dashboard header. The old admin-only placeholder has
been removed. No Vercel or database schedule is added: the owner must approve
the release trigger and frequency separately.

The audit-remediation checkpoint makes the service contract enforceable rather
than documentary: service clients have no direct table mutation grant;
notification snapshots have a database immutability guard; member feeds omit
the internal payload; internal links reject backslashes and controls; Storage
setup refuses a pre-existing bucket rather than claiming/mutating it; one SMTP
attempt has a 45-second invocation deadline and mandatory transport encryption;
and the bell marks the complete feed read through an RPC. The link to the old
mock Alerts page is removed until that page consumes this durable feed.

Fixture still owns its event projector and PDF route/document. Until those are
composed, this shared core has no source of Fixture notifications and no recap
PDF endpoint; the UI and dispatcher therefore must not be described as a
complete Fixture notification/PDF workflow.

## Security boundaries

1. `public.notifications`, `public.notification_preferences`,
   `public.notification_deliveries`, and `public.notification_digest_batches`
   are closed to direct PostgREST access.
   Members use only explicit RPCs resolved through `fn_app_user_id()`.
2. Enqueue, claim, settle, and retry functions are service-role only. A browser
   cannot create a notification, choose another recipient, or mark a delivery
   sent. The service role obtains an immutable notification render snapshot
   through the token-bound snapshot RPC and has no direct table grant on the
   four tables; projectors must call `fn_notification_enqueue`.
3. The shared core does not know Fixture disclosure rules. Its payload is a
   render-ready, masking-safe snapshot. Fixture tests must prove no hidden
   vessel ID, counterparty identity, contact data, or undisclosed fee enters it.
4. Notification rows are protected by a trigger and immutable except the first
   `read_at` transition; the member feed does not return the internal payload.
   Delivery rows contain operational state only. Stable `(recipient, dedupe_key)` and
   `(notification, channel)` constraints prevent duplicate logical delivery;
   `(recipient, digest window)` prevents duplicate digest envelopes.
5. Email is at-least-once. The database serializes digest membership with the
   short cross-table claim, then uses a lease, bounded attempts and exponential
   back-off. Digest membership and its first snapshot time are frozen on the
   first claim. Message-ID is stable across retries, derives from the instant
   delivery or digest batch ID, and uses the fixed Arab ShipBroker domain rather
   than mutable SMTP account configuration.
6. The private `fixture-recaps` bucket accepts PDF only. Service routes write
   and create short-lived signed URLs only after the requester's authenticated
   Fixture read check. Members receive no direct object-table grant or policy.
   Forward migration refuses a pre-existing bucket ID, so DOWN can remove only
   a bucket whose baseline absence the migration established.
7. Account anonymisation revokes access through the active-user/member gates;
   durable notification/delivery foreign keys keep the anonymised user row.

## Data model

`notifications` is the durable in-app item and email source snapshot. It stores
recipient, kind, importance, title/body/href, a masking-safe JSON payload,
dedupe key, in-app visibility, read timestamp, optional expiry, and creation
time. `expires_at` is an email-delivery cut-off, not an in-app retention date:
expired items remain in the feed and unread badge until the member reads them.

`notification_preferences` is one row per member. It controls in-app display,
email mode (`instant`, `digest`, `off`) and a UTC digest hour. The first release
uses UTC deliberately; member time zones require a separate validated IANA
time-zone design.

`notification_deliveries` stores one email audit item per notification. Status is
`queued`, `sending`, `sent`, `failed`, or `suppressed`. It carries claim token,
lease, attempt count, next attempt, sent time and bounded error text. Recipient
email is resolved at send time and is not copied into the table. Instant items
own their lease directly. Digest items reference `notification_digest_batches`.

`notification_digest_batches` stores one SMTP envelope per recipient and UTC
digest window. The batch, not each child item, owns the digest lease, attempts,
retry schedule, first-snapshot instant and stable Message-ID. Once claimed, the
window is closed to new children; a late enqueue is moved to the next open
daily window. Every retry renders the same frozen membership against the first
snapshot instant. Its snapshot RPC returns at most 25 rendered items plus the
complete item count, allowing the email to say how many additional updates
remain in the portal without creating an unbounded message.

## RPC contracts

Member RPCs:

- `list_my_notifications(limit, before)`
- `mark_notifications_read(ids)`
- `mark_all_my_notifications_read()`
- `notification_badge()`
- `set_notification_preferences(in_app, email_mode, digest_hour_utc)`

Service-only RPCs:

- `fn_notification_enqueue(...)`
- `fn_notification_email_claim(ttl_seconds, max_attempts)`
- `fn_notification_email_snapshot(job_kind, id, token, item_limit)`
- `fn_notification_email_settle(job_kind, id, token, outcome, error, max_attempts)`

The enqueue call snapshots the current preference. `off` creates a suppressed
email audit item; `digest` joins one open recipient/window batch; `instant`
schedules one envelope now. Digest enqueue and claim take the same short
transaction lock and calculate the boundary from the wall clock after the lock,
preventing an old transaction from joining a claimed or settled envelope. A
projector-supplied `not_before` is a lower bound and digest events are normalized
to the first configured UTC digest hour strictly after that bound. Urgent events
bypass digest but never bypass `off`. A notification already expired, or
guaranteed to expire before its digest window, is retained in-app while its
email audit item is immediately suppressed. After the first SMTP envelope is
claimed, its original valid membership remains frozen across ambiguous retries
so the stable Message-ID never denotes different content.

## Delivery and scheduling

The Next route authenticates the existing cron bearer secret, claims one envelope
with the service role, resolves the active user email, renders branded mail
through the existing Group Mail SMTP configuration, and settles the claim only
after SMTP accepts it. A 45-second deadline leaves 15 seconds of the 60-second
route budget for claim settlement and durable job-run finalisation. Port 465
uses implicit TLS; other configured ports require STARTTLS.

No environment-specific URL or secret is embedded in a migration. The
dispatcher URL and token are configuration. A pg_cron/pg_net tick may be
enabled only when both are present and the release owner authorises scheduling.
Manual/service invocation remains available without the schedule.

Until that explicit scheduling decision is made, production email delivery is
**disabled/incomplete** even though the route and queue are testable. A release
may truthfully enable the in-app feed only; it must not claim email is live.

## Rollback and release gates

The DOWN migration removes functions before tables and refuses to delete the
Storage bucket when documents still exist. Forward refuses to adopt a
pre-existing bucket. Clean harnesses therefore restore their exact baseline; a
production rollback cannot silently destroy PDFs or unrelated bucket settings.

The executable release harness is
`scripts/shared-fixture-services-harness.sh`. It creates only a disposable
`asb_shared_fixture_services_test_<pid>` database, applies a minimal Supabase
baseline, runs the transactional two-user/RLS smoke and a real two-session
advisory-lock serialization race, proves DOWN restores the exact schema fingerprint, reapplies
and repeats, then drops that test database. On Windows invoke it with Git Bash
(`C:\Program Files\Git\bin\bash.exe`); it never mutates the shared `postgres`
database.

Required before composition:

- forward/DOWN/reapply fingerprint;
- member RPC RLS tests with two users plus inactive/anonymised user;
- concurrent claim and expired-lease tests;
- idempotent enqueue and bounded retry tests;
- masked Fixture projector tests;
- PDF MIME, bucket privacy, requester guard, and signed-URL expiry tests;
- SMTP missing/accept/retry tests with a fake transport;
- bell accessibility/responsive tests;
- full TypeScript, lint, production build, Fixture, PDA and integration gates.
