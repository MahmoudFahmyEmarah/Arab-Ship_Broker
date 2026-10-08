import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261008050000_shared_notifications.sql", import.meta.url),
  "utf8",
);
const storage = readFileSync(
  new URL("../supabase/migrations/20261008051000_fixture_recap_storage.sql", import.meta.url),
  "utf8",
);
const semantics = readFileSync(
  new URL("../supabase/migrations/20261008052000_shared_notification_semantics.sql", import.meta.url),
  "utf8",
);
const semanticsDown = readFileSync(
  new URL("../supabase/rollback/20261008052000_shared_notification_semantics_down.sql", import.meta.url),
  "utf8",
);
const down = readFileSync(
  new URL("../supabase/rollback/20261008050000_shared_fixture_services_down.sql", import.meta.url),
  "utf8",
);
const architecture = readFileSync(
  new URL("../docs/shared-fixture-services-architecture.md", import.meta.url),
  "utf8",
);
const smoke = readFileSync(
  new URL("../supabase/tests/shared_fixture_services_smoke.sql", import.meta.url),
  "utf8",
);
const dispatcher = readFileSync(new URL("../lib/notifications/dispatch.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/cron/fixture-notifications/route.ts", import.meta.url), "utf8");
const bell = readFileSync(new URL("../components/portal/NotificationBell.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../components/portal/boards.tsx", import.meta.url), "utf8");
const bellBrowser = readFileSync(new URL("../e2e/notification-bell.spec.ts", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

for (const table of ["notification_preferences", "notifications", "notification_deliveries"]) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "i"));
}

for (const rpc of [
  "list_my_notifications",
  "mark_notifications_read",
  "mark_all_my_notifications_read",
  "notification_badge",
  "set_notification_preferences",
]) {
  assert.match(migration, new RegExp(`create or replace function public\\.${rpc}\\(`, "i"));
  assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}\\([^;]* to authenticated`, "is"));
}

for (const serviceRpc of [
  "fn_notification_enqueue",
  "fn_notification_delivery_claim",
  "fn_notification_delivery_settle",
]) {
  assert.match(migration, new RegExp(`create or replace function public\\.${serviceRpc}\\(`, "i"));
  assert.match(migration, new RegExp(`grant execute on function public\\.${serviceRpc}\\([^;]* to service_role`, "is"));
  assert.doesNotMatch(migration, new RegExp(`grant execute on function public\\.${serviceRpc}\\([^;]* to authenticated`, "is"));
}

assert.match(migration, /unique \(recipient_user_id, dedupe_key\)/i);
assert.match(migration, /unique \(notification_id, channel\)/i);
assert.match(migration, /for update skip locked/i);
assert.match(migration, /v_row\.claim_token is distinct from p_token/i);
assert.match(migration, /least\(power\(2, v_row\.attempts\)/i);
assert.match(migration, /NTF_AUTH: active member required/);
assert.match(migration, /suppressed because recipient is inactive/);
assert.doesNotMatch(semantics.match(/create or replace function public\.fn_notification_enqueue[\s\S]*?\n\$\$;/i)?.[0] ?? "", /expiry must be in the future/i);
assert.match(migration, /position\(chr\(92\) in href\) = 0/);
assert.match(migration, /notifications_snapshot_guard/);
assert.match(migration, /only the first read timestamp may change/);
assert.match(migration, /revoke all on table public\.notifications from service_role/i);
assert.match(migration, /grant select on table public\.notifications to service_role/i);
assert.doesNotMatch(migration, /grant\s+(?:select,\s*)?(?:insert|update|delete)[^;]*notification/i);
assert.doesNotMatch(migration.match(/returns table \([\s\S]*?\)\s*language plpgsql/)?.[0] ?? "", /payload jsonb/i);
assert.doesNotMatch(migration, /whatsapp_outbox/i);

assert.match(semantics, /create table public\.notification_digest_batches/i);
assert.match(semantics, /alter table public\.notification_digest_batches enable row level security/i);
assert.match(semantics, /revoke all on table public\.notification_digest_batches from public, anon, authenticated, service_role/i);
// a window's envelope is unique per generation: generation 0 takes new items; a successor of an obsolete retried
// envelope (C2O-092 #2) is the next generation, so it gets a new id and Message-ID
assert.match(semantics, /unique \(recipient_user_id, digest_window_at, generation\)/i);
assert.match(semantics, /add column digest_batch_id uuid references public\.notification_digest_batches/i);
assert.match(semantics, /NTF_MIGRATION: notification deliveries must be empty/i);
assert.match(semantics, /is_expired boolean/i);
assert.match(semantics, /Email delivery cut-off/i);
assert.match(semantics, /pg_advisory_xact_lock/i);
assert.match(semantics, /snapshot_at = coalesce\(b\.snapshot_at, now\(\)\)/i);
assert.match(semantics, /snapshot_at = coalesce\(b\.snapshot_at, (?:clock_timestamp\(\)|v_now)\)/i);   // the claim uses its one post-lock clock (C2O-092 #5)
assert.doesNotMatch(semantics, /snapshot_at\s*=\s*null/i);
assert.match(semantics, /where b\.status = 'queued'[\s\S]*?b\.claim_token is null[\s\S]*?b\.snapshot_at is null/i);
assert.match(semantics, /v_digest := v_digest \+ interval '1 day'/i);
assert.match(semantics, /revoke all on function public\.list_my_notifications\(integer, timestamptz\) from public, anon, authenticated/i);
assert.match(semantics, /power\(2, least\(v_(?:delivery|batch)\.attempts, 8\)\)/i);
assert.match(semantics, /fn_notification_digest_window/i);
assert.match(semantics, /suppressed because notification expires before digest window/i);
assert.match(semantics, /no deliverable digest items remain/i);
for (const rpc of ["fn_notification_email_claim", "fn_notification_email_snapshot", "fn_notification_email_settle"]) {
  assert.match(semantics, new RegExp(`create or replace function public\\.${rpc}\\(`, "i"));
  assert.match(semantics, new RegExp(`grant execute on function public\\.${rpc}\\([^;]* to service_role`, "is"));
  assert.doesNotMatch(semantics, new RegExp(`grant execute on function public\\.${rpc}\\([^;]* to authenticated`, "is"));
}
assert.match(semantics, /revoke select on table public\.notifications from service_role/i);
assert.match(semantics, /revoke all on function public\.fn_notification_delivery_claim[^;]*from service_role/i);
assert.match(semantics, /revoke all on function public\.fn_notification_delivery_settle[^;]*from service_role/i);
assert.match(semanticsDown, /DOWN refused: notification digest batches still contain delivery state/i);
assert.match(semanticsDown, /drop table (?:if exists )?public\.notification_digest_batches/i);   // tolerant of a chain where 052000 was never applied

assert.match(storage, /'fixture-recaps', 'fixture-recaps', false, 5242880, array\['application\/pdf'\]/i);
assert.match(storage, /fixture-recaps already exists and is not owned by this migration/i);
assert.match(storage, /storage\.buckets is unavailable; fixture-recaps ownership cannot be established/i);
assert.doesNotMatch(storage, /on conflict/i);
assert.doesNotMatch(storage, /create policy|grant\s+[^;]+authenticated/i);
assert.match(down, /DOWN refused: fixture-recaps still contains objects/);
for (const object of [
  "fn_notification_delivery_settle",
  "fn_notification_delivery_claim",
  "fn_notification_enqueue",
  "notification_deliveries",
  "notifications",
  "notification_preferences",
]) {
  assert.match(down, new RegExp(`drop (?:function|table) if exists public\\.${object}`, "i"));
}

// the recap PDF renderer is added with the PDF itself; no code imports it yet (O2ALL-003 port, 7 Oct 2026)
assert.equal(pkg.dependencies?.["@react-pdf/renderer"], undefined);
assert.match(pkg.scripts?.["test:shared-fixture-services"] ?? "", /shared-fixture-services-check\.ts/);
assert.match(pkg.scripts?.["test:shared-fixture-services:e2e"] ?? "", /playwright\.shared-fixture-services\.config\.ts/);
assert.match(pkg.scripts?.prebuild ?? "", /test:shared-fixture-services/);
assert.match(architecture, /WhatsApp escalation is explicitly deferred/i);
assert.match(architecture, /masking-safe snapshot/i);
assert.match(architecture, /No environment-specific URL or secret is embedded in a migration/i);
assert.match(smoke, /replay mutated the original snapshot/i);
assert.match(smoke, /cross-member badge leak/i);
assert.match(smoke, /perform pg_temp\.ntf_as\(u1\);[\s\S]*?refused := false;[\s\S]*?perform 1 from public\.notifications limit 1;/i);
assert.match(smoke, /wrong digest token settled envelope/i);
assert.match(smoke, /retry ceiling did not fail instant delivery/i);
assert.match(smoke, /inactive recipient delivery was not suppressed/i);
assert.match(smoke, /inactive member was not refused/i);
assert.match(smoke, /expired notification disappeared from the feed/i);
assert.match(smoke, /same recipient\/window did not form one digest batch/i);
assert.match(smoke, /digest children did not settle together/i);
assert.match(smoke, /notification feed RPC grants are not private-by-default/i);
assert.match(smoke, /enqueue attached to a claimed digest envelope/i);
assert.match(smoke, /the obsolete envelope must be succeeded, not re-sent/i);   // C2O-092 #2 replaces the frozen re-send
assert.match(dispatcher, /const NOTIFICATION_MESSAGE_ID_DOMAIN = "arabshipbroker\.com"/);
assert.match(dispatcher, /messageId: `<asb-notification-\$\{claim\.id\}@\$\{NOTIFICATION_MESSAGE_ID_DOMAIN\}>`/);
assert.match(dispatcher, /function safeMailSubject/);
assert.doesNotMatch(dispatcher, /senderDomain/);
assert.match(dispatcher, /processNotificationClaims/);
assert.match(dispatcher, /buildNotificationDigestMail/);
assert.match(dispatcher, /finally \{[\s\S]*transport\.close\(\)/);
assert.match(dispatcher, /fn_notification_email_claim/);
assert.match(dispatcher, /fn_notification_email_snapshot/);
assert.match(dispatcher, /fn_notification_email_settle/);
assert.doesNotMatch(dispatcher, /whatsapp_outbox/i);
assert.match(route, /cronAuthorized/);
assert.match(route, /withJobRunStrict/);
assert.match(route, /NEXT_PUBLIC_SITE_URL/);
assert.match(route, /limit: 1/);
assert.match(route, /deadlineAt/);
assert.match(route, /export async function GET/);
assert.match(route, /export async function POST/);
assert.match(bell, /role="region"/);
assert.match(bell, /aria-controls="portal-notification-panel"/);
assert.match(bell, /aria-live="polite"/);
assert.match(bell, /mark_notifications_read/);
assert.match(bell, /mark_all_my_notifications_read/);
assert.match(bell, /list_my_notifications/);
assert.match(bell, /notification_badge/);
assert.match(bell, /safeNotificationHref/);
assert.match(bell, /item\.read_at \? "Read " : "Unread "/);
assert.match(bell, /item\.is_expired \? "expired " : ""/);
assert.match(bell, /portal-notification__expired/);
assert.match(readFileSync(new URL("../lib/portal/portal.css", import.meta.url), "utf8"), /portal-notification__item:focus-visible[\s\S]*outline: 2px solid var\(--asb-blue\)/);
assert.doesNotMatch(bell, /dashboard\/alerts/);
assert.match(dashboard, /<NotificationBell \/>/);
assert.doesNotMatch(dashboard, /Live notifications are an admin preview/);
assert.match(bellBrowser, /Unread expired urgent notification/);
assert.match(bellBrowser, /getByText\("Expired"/);
assert.match(bellBrowser, /outlineWidth/);
assert.match(bellBrowser, /scrollWidth - document\.documentElement\.clientWidth/);
assert.match(bellBrowser, /toBeFocused/);
assert.match(bellBrowser, /new URL\(value\)/);
assert.match(bellBrowser, /refusing to seed notification browser fixtures against non-loopback Supabase URL/);

// C2O-092 #5/#6/#7 in the claim
const claim = semantics.split("create or replace function public.fn_notification_email_claim(")[1].split(String.fromCharCode(10) + "$$;")[0];
assert.match(claim, /pg_advisory_xact_lock\(1095978574\);[\s\S]{0,300}v_now := clock_timestamp\(\);/);
assert.ok(!/[^_]now\(\)/.test(claim), "the claim reads the clock once, after the lock");
assert.match(claim, /order by q\.priority, q\.next_attempt_at/);
assert.match(claim, /case when n\.importance = 'urgent' then 0 else 1 end as priority/);
assert.match(claim, /where d\.id = v_id and n\.id = d\.notification_id\s+and \(d\.status = 'queued' or \(d\.status = 'sending' and d\.lease_until < v_now\)\)/);
assert.match(claim, /where b\.id = v_id\s+and \(b\.status = 'queued' or \(b\.status = 'sending' and b\.lease_until < v_now\)\)/);
assert.match(claim, /suppressed because the member turned email off/);
assert.match(claim, /superseded by/);
assert.match(semantics, /create or replace function public\.get_my_notification_preferences\(\)/);
assert.match(semantics, /grant execute on function public\.get_my_notification_preferences\(\) to authenticated;/);
assert.match(down, /NTF_DOWN_REFUSED/);
assert.match(smoke, /SHARED FIXTURE SERVICES WAVE 4 SMOKE: ALL ASSERTIONS PASSED/);

console.log("SHARED FIXTURE SERVICES CONTRACT: ALL ASSERTIONS PASSED");
