import assert from "node:assert/strict";
import {
  buildNotificationMail,
  dispatchNotificationDeliveries,
  processNotificationClaims,
  type DeliveryTransport,
  type NotificationClaim,
  type NotificationRecipient,
  type NotificationSnapshot,
} from "../lib/notifications/dispatch";

type SmtpConfigResult = {
  data: { smtp_host: string | null; smtp_port: number | null; smtp_user: string | null; from_name: string | null } | null;
  error: { message: string } | null;
};

function smtpBoundaryClient(
  config: SmtpConfigResult,
  secret: { data: string | null; error: { message: string } | null },
): Parameters<typeof dispatchNotificationDeliveries>[0] {
  type Builder = {
    select: (columns: string) => Builder;
    eq: (column: string, value: number) => Builder;
    maybeSingle: () => Promise<SmtpConfigResult>;
  };
  const builder: Builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => config,
  };
  return {
    from: () => builder,
    rpc: async () => secret,
  } as unknown as Parameters<typeof dispatchNotificationDeliveries>[0];
}

async function main() {
const claims: NotificationClaim[] = [
  { id: "c1", notification_id: "n1", claim_token: "t1", attempts: 1 },
  { id: "c2", notification_id: "n2", claim_token: "t2", attempts: 1 },
  { id: "c3", notification_id: "missing", claim_token: "t3", attempts: 8 },
  { id: "c4", notification_id: "n4", claim_token: "t4", attempts: 1 },
];
const notifications = new Map<string, NotificationSnapshot>([
  ["n1", { id: "n1", recipient_user_id: "u1", dedupe_key: "d1", kind: "fixture.proposal", importance: "normal", title: "New proposal", body: "Open the governed room.", href: "/dashboard/fixture-room/r1" }],
  ["n2", { id: "n2", recipient_user_id: "u1", dedupe_key: "d2", kind: "fixture.message", importance: "urgent", title: "Transport failure", body: "Retry this email.", href: null }],
  ["n4", { id: "n4", recipient_user_id: "u2", dedupe_key: "d4", kind: "fixture.message", importance: "info", title: "Bad recipient", body: "Do not send.", href: null }],
]);
const recipients = new Map<string, NotificationRecipient>([
  ["u1", { id: "u1", email: "member@example.test", full_name: "A <Broker>", is_active: true }],
  ["u2", { id: "u2", email: "not-an-email", full_name: null, is_active: true }],
]);

const sent: string[] = [];
const transport: DeliveryTransport = {
  async send(mail) {
    sent.push(mail.messageId);
    if (mail.subject === "Transport failure") throw new Error("fake SMTP refusal");
  },
  close() {},
};
const settled: Array<{ id: string; ok: boolean; error: string | null }> = [];
const result = await processNotificationClaims(
  claims,
  notifications,
  recipients,
  transport,
  async (claim, ok, error) => {
    settled.push({ id: claim.id, ok, error });
    return claim.id !== "c4";
  },
  { siteUrl: "https://portal.example.test", senderDomain: "arabshipbroker.com", maxAttempts: 8 },
);

assert.deepEqual(result, { claimed: 4, sent: 1, retried: 1, failed: 1, lost: 1 });
assert.deepEqual(sent, [
  "<asb-notification-c1@arabshipbroker.com>",
  "<asb-notification-c2@arabshipbroker.com>",
]);
assert.deepEqual(settled.map(({ id, ok }) => ({ id, ok })), [
  { id: "c1", ok: true },
  { id: "c2", ok: false },
  { id: "c3", ok: false },
  { id: "c4", ok: false },
]);
assert.match(settled[1]?.error ?? "", /fake SMTP refusal/);
assert.match(settled[2]?.error ?? "", /snapshot unavailable/);
assert.match(settled[3]?.error ?? "", /email invalid/);

const mail = buildNotificationMail(claims[0], notifications.get("n1")!, recipients.get("u1")!, {
  siteUrl: "https://portal.example.test/base",
  senderDomain: "bad domain<script>",
});
assert.match(mail.html, /A &lt;Broker&gt;/);
assert.match(mail.html, /https:\/\/portal\.example\.test\/dashboard\/fixture-room\/r1/);
assert.doesNotMatch(mail.html, /<Broker>/);
assert.equal(mail.messageId, "<asb-notification-c1@baddomainscript>");

const unsafe = buildNotificationMail(
  claims[0],
  { ...notifications.get("n1")!, href: "/\\evil.example" },
  recipients.get("u1")!,
  { siteUrl: "https://portal.example.test", senderDomain: "arabshipbroker.com" },
);
assert.doesNotMatch(unsafe.html, /evil\.example/);

let slowClosed = false;
const slowTransport: DeliveryTransport = {
  async send() { await new Promise((resolve) => setTimeout(resolve, 100)); },
  close() { slowClosed = true; },
};
const timeoutSettles: Array<{ ok: boolean; error: string | null }> = [];
const timed = await processNotificationClaims(
  [claims[0]], notifications, recipients, slowTransport,
  async (_claim, ok, error) => { timeoutSettles.push({ ok, error }); return true; },
  { siteUrl: null, senderDomain: "arabshipbroker.com", maxAttempts: 8, deadlineAt: Date.now() + 10 },
);
slowTransport.close();
assert.equal(slowClosed, true);
assert.deepEqual(timed, { claimed: 1, sent: 0, retried: 1, failed: 0, lost: 0 });
assert.equal(timeoutSettles[0]?.ok, false);
assert.match(timeoutSettles[0]?.error ?? "", /invocation budget/);

await assert.rejects(
  dispatchNotificationDeliveries(
    smtpBoundaryClient(
      { data: null, error: { message: "missing config table" } },
      { data: "unused", error: null },
    ),
  ),
  /SMTP configuration unavailable/,
);
await assert.rejects(
  dispatchNotificationDeliveries(
    smtpBoundaryClient(
      { data: { smtp_host: "smtp.example.test", smtp_port: 465, smtp_user: "alerts@example.test", from_name: "ASB" }, error: null },
      { data: null, error: null },
    ),
  ),
  /SMTP password unavailable/,
);
await assert.rejects(
  dispatchNotificationDeliveries(
    smtpBoundaryClient(
      { data: { smtp_host: null, smtp_port: 465, smtp_user: null, from_name: "ASB" }, error: null },
      { data: "secret", error: null },
    ),
  ),
  /SMTP is not configured/,
);

console.log("SHARED NOTIFICATION DISPATCH: ALL ASSERTIONS PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
