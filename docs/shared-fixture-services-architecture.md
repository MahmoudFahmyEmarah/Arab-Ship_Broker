# Shared Fixture services architecture

Status: Phase 0 frozen for implementation

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

Fixture still owns its event projector and PDF route/document. Until those are
composed, this shared core has no source of Fixture notifications and no recap
PDF endpoint; the UI and dispatcher therefore must not be described as a
complete Fixture notification/PDF workflow.

## Security boundaries

1. `public.notifications`, `public.notification_preferences`, and
   `public.notification_deliveries` are closed to direct PostgREST access.
   Members use only explicit RPCs resolved through `fn_app_user_id()`.
2. Enqueue, claim, settle, and retry functions are service-role only. A browser
   cannot create a notification, choose another recipient, or mark a delivery
   sent.
3. The shared core does not know Fixture disclosure rules. Its payload is a
   render-ready, masking-safe snapshot. Fixture tests must prove no hidden
   vessel ID, counterparty identity, contact data, or undisclosed fee enters it.
4. Notification rows are immutable except `read_at`; delivery rows contain
   operational state only. Stable `(recipient, dedupe_key)` and
   `(notification, channel)` constraints prevent duplicate logical delivery.
5. Email is at-least-once. Claims use `FOR UPDATE SKIP LOCKED`, a lease, bounded
   attempts, exponential back-off, and a stable Message-ID derived from the
   delivery ID/dedupe key.
6. The private `fixture-recaps` bucket accepts PDF only. Service routes write
   and create short-lived signed URLs only after the requester's authenticated
   Fixture read check. Members receive no direct object-table grant or policy.
7. Account anonymisation revokes access through the active-user/member gates;
   durable notification/delivery foreign keys keep the anonymised user row.

## Data model

`notifications` is the durable in-app item and email source snapshot. It stores
recipient, kind, importance, title/body/href, a masking-safe JSON payload,
dedupe key, in-app visibility, read timestamp, optional expiry, and creation
time.

`notification_preferences` is one row per member. It controls in-app display,
email mode (`instant`, `digest`, `off`) and a UTC digest hour. The first release
uses UTC deliberately; member time zones require a separate validated IANA
time-zone design.

`notification_deliveries` stores one email delivery per notification. Status is
`queued`, `sending`, `sent`, `failed`, or `suppressed`. It carries claim token,
lease, attempt count, next attempt, sent time and bounded error text. Recipient
email is resolved at send time and is not copied into the table.

## RPC contracts

Member RPCs:

- `list_my_notifications(limit, before)`
- `mark_notifications_read(ids)`
- `notification_badge()`
- `set_notification_preferences(in_app, email_mode, digest_hour_utc)`

Service-only RPCs:

- `fn_notification_enqueue(...)`
- `fn_notification_delivery_claim(limit, ttl_seconds, max_attempts)`
- `fn_notification_delivery_settle(id, token, ok, error, max_attempts)`

The enqueue call snapshots the current preference. `off` creates a suppressed
email delivery for audit truth; `digest` schedules the next UTC digest hour;
`instant` schedules now. A projector-supplied `not_before` is a lower bound.

## Delivery and scheduling

The Next route will authenticate a bearer token stored in Vault, claim a
bounded batch with the service role, resolve active user emails, render branded
mail through the existing Group Mail SMTP configuration, and settle each claim
only after SMTP accepts it.

No environment-specific URL or secret is embedded in a migration. The
dispatcher URL and token are configuration. A pg_cron/pg_net tick may be
enabled only when both are present and the release owner authorises scheduling.
Manual/service invocation remains available without the schedule.

## Rollback and release gates

The DOWN migration removes functions before tables and refuses to delete the
Storage bucket when documents still exist. Clean harnesses therefore restore
their exact baseline; a production rollback cannot silently destroy PDFs.

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
