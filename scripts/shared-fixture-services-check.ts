import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260923350000_shared_notifications.sql", import.meta.url),
  "utf8",
);
const storage = readFileSync(
  new URL("../supabase/migrations/20260923351000_fixture_recap_storage.sql", import.meta.url),
  "utf8",
);
const down = readFileSync(
  new URL("../supabase/rollback/20260923350000_shared_fixture_services_down.sql", import.meta.url),
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
assert.match(migration, /NTF_INPUT: expiry must be in the future/);
assert.doesNotMatch(migration, /whatsapp_outbox/i);

assert.match(storage, /'fixture-recaps', 'fixture-recaps', false, 5242880, array\['application\/pdf'\]/i);
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

assert.equal(pkg.dependencies?.["@react-pdf/renderer"], "^4.9.0");
assert.equal(pkg.scripts?.["test:shared-fixture-services"], "node --import tsx scripts/shared-fixture-services-check.ts && node --import tsx scripts/shared-notification-dispatch-check.ts");
assert.match(architecture, /WhatsApp escalation is explicitly deferred/i);
assert.match(architecture, /masking-safe snapshot/i);
assert.match(architecture, /No environment-specific URL or secret is embedded in a migration/i);
assert.match(smoke, /replay mutated the original snapshot/i);
assert.match(smoke, /cross-member badge leak/i);
assert.match(smoke, /wrong claim token settled delivery/i);
assert.match(smoke, /expired lease was not reclaimed safely/i);
assert.match(smoke, /retry ceiling did not fail delivery/i);
assert.match(smoke, /inactive recipient delivery was not suppressed/i);
assert.match(smoke, /inactive member was not refused/i);
assert.match(dispatcher, /messageId: `<asb-notification-\$\{claim\.id\}@\$\{domain\}>`/);
assert.match(dispatcher, /processNotificationClaims/);
assert.match(dispatcher, /finally \{[\s\S]*transport\.close\(\)/);
assert.match(dispatcher, /fn_notification_delivery_claim/);
assert.match(dispatcher, /fn_notification_delivery_settle/);
assert.doesNotMatch(dispatcher, /whatsapp_outbox/i);
assert.match(route, /cronAuthorized/);
assert.match(route, /withJobRunStrict/);
assert.match(route, /NEXT_PUBLIC_SITE_URL/);
assert.match(route, /export async function GET/);
assert.match(route, /export async function POST/);
assert.match(bell, /aria-haspopup="dialog"/);
assert.match(bell, /aria-live="polite"/);
assert.match(bell, /mark_notifications_read/);
assert.match(bell, /list_my_notifications/);
assert.match(bell, /notification_badge/);
assert.match(dashboard, /<NotificationBell \/>/);
assert.doesNotMatch(dashboard, /Live notifications are an admin preview/);

console.log("SHARED FIXTURE SERVICES CONTRACT: ALL ASSERTIONS PASSED");
