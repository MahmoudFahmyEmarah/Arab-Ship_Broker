import assert from "node:assert/strict";
import {
  buildNotificationMail,
  buildNotificationDigestMail,
  dispatchNotificationDeliveries,
  processNotificationClaims,
  redactDeliveryError,
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
  { job_kind: "instant", id: "c1", recipient_user_id: "u1", claim_token: "t1", attempts: 1 },
  { job_kind: "instant", id: "c2", recipient_user_id: "u1", claim_token: "t2", attempts: 1 },
  { job_kind: "instant", id: "c3", recipient_user_id: "u1", claim_token: "t3", attempts: 1 },
  { job_kind: "instant", id: "c4", recipient_user_id: "u2", claim_token: "t4", attempts: 1 },
  { job_kind: "digest", id: "c5", recipient_user_id: "u1", claim_token: "t5", attempts: 1 },
];
const snapshots = new Map<string, NotificationSnapshot[]>([
  ["c1", [{ id: "n1", recipient_user_id: "u1", importance: "normal", title: "New proposal", body: "Open the governed room.", href: "/dashboard/fixture-room/r1", created_at: "2026-09-28T00:00:00Z", total_count: 1 }]],
  ["c2", [{ id: "n2", recipient_user_id: "u1", importance: "urgent", title: "Transport failure", body: "Retry this email.", href: null, created_at: "2026-09-28T00:01:00Z", total_count: 1 }]],
  ["c3", []],
  ["c4", [{ id: "n4", recipient_user_id: "u2", importance: "info", title: "Bad recipient", body: "Do not send.", href: null, created_at: "2026-09-28T00:02:00Z", total_count: 1 }]],
  ["c5", [
    { id: "n5", recipient_user_id: "u1", importance: "normal", title: "Digest <one>", body: "First & safe.", href: "/dashboard/fixture-room/r1", created_at: "2026-09-28T00:03:00Z", total_count: 3 },
    { id: "n6", recipient_user_id: "u1", importance: "info", title: "Digest two", body: "Second update.", href: "/\\evil.example", created_at: "2026-09-28T00:04:00Z", total_count: 3 },
  ]],
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
const settled: Array<{ id: string; outcome: "sent" | "failed" | "suppressed"; error: string | null }> = [];
const result = await processNotificationClaims(
  claims, snapshots,
  recipients,
  transport,
  async (claim, outcome, error) => {
    settled.push({ id: claim.id, outcome, error });
    return claim.id !== "c4";
  },
  { siteUrl: "https://portal.example.test", maxAttempts: 8 },
);

assert.deepEqual(result, { claimed: 5, sent: 2, retried: 1, failed: 0, suppressed: 1, lost: 1 });
assert.deepEqual(sent, [
  "<asb-notification-c1@arabshipbroker.com>",
  "<asb-notification-c2@arabshipbroker.com>",
  "<asb-notification-c5@arabshipbroker.com>",
]);
assert.deepEqual(settled.map(({ id, outcome }) => ({ id, outcome })), [
  { id: "c1", outcome: "sent" },
  { id: "c2", outcome: "failed" },
  { id: "c3", outcome: "suppressed" },
  { id: "c4", outcome: "failed" },
  { id: "c5", outcome: "sent" },
]);
assert.equal(settled[1]?.error, "delivery failed");   // C2O-092 P2: the server text is never stored
assert.match(settled[2]?.error ?? "", /no deliverable notification items/);
assert.match(settled[3]?.error ?? "", /email invalid/);

const mail = buildNotificationMail(claims[0], snapshots.get("c1")![0]!, recipients.get("u1")!, {
  siteUrl: "https://portal.example.test/base",
});
assert.match(mail.html, /A &lt;Broker&gt;/);
assert.match(mail.html, /https:\/\/portal\.example\.test\/dashboard\/fixture-room\/r1/);
assert.doesNotMatch(mail.html, /<Broker>/);
assert.equal(mail.messageId, "<asb-notification-c1@arabshipbroker.com>");

const headerSafe = buildNotificationMail(
  claims[0],
  { ...snapshots.get("c1")![0]!, title: "Proposal\r\nBcc: attacker@example.test" },
  recipients.get("u1")!,
  { siteUrl: "https://portal.example.test" },
);
assert.equal(headerSafe.subject, "Proposal Bcc: attacker@example.test");
assert.doesNotMatch(headerSafe.subject, /[\r\n]/);

const unsafe = buildNotificationMail(
  claims[0],
  { ...snapshots.get("c1")![0]!, href: "/\\evil.example" },
  recipients.get("u1")!,
  { siteUrl: "https://portal.example.test" },
);
assert.doesNotMatch(unsafe.html, /evil\.example/);

const digest = buildNotificationDigestMail(
  claims[4], snapshots.get("c5")!, recipients.get("u1")!,
  { siteUrl: "https://portal.example.test" },
);
assert.equal(digest.messageId, "<asb-notification-c5@arabshipbroker.com>");
assert.match(digest.subject, /3 updates/);
assert.match(digest.html, /Digest &lt;one&gt;/);
assert.match(digest.html, /First &amp; safe/);
assert.match(digest.html, /1 more update is waiting/);
assert.doesNotMatch(digest.html, /evil\.example/);

let slowClosed = false;
const slowTransport: DeliveryTransport = {
  async send() { await new Promise((resolve) => setTimeout(resolve, 100)); },
  close() { slowClosed = true; },
};
const timeoutSettles: Array<{ outcome: "sent" | "failed" | "suppressed"; error: string | null }> = [];
const timed = await processNotificationClaims(
  [claims[0]], snapshots, recipients, slowTransport,
  async (_claim, outcome, error) => { timeoutSettles.push({ outcome, error }); return true; },
  { siteUrl: null, maxAttempts: 8, deadlineAt: Date.now() + 10 },
);
slowTransport.close();
assert.equal(slowClosed, true);
// C2O-092 P2: a send that outlives the budget but completes within the grace is recorded as sent, not retried
assert.deepEqual(timed, { claimed: 1, sent: 1, retried: 0, failed: 0, suppressed: 0, lost: 0 });
assert.equal(timeoutSettles[0]?.outcome, "sent");

// …and one that never completes is a retryable timeout, stored without server text
const hungSettles: Array<{ outcome: string; error: string | null }> = [];
const hung = await processNotificationClaims(
  [claims[0]], snapshots, recipients,
  { send: () => new Promise<void>(() => undefined), close() {} },
  async (_claim, outcome, error) => { hungSettles.push({ outcome, error }); return true; },
  { siteUrl: null, maxAttempts: 8, deadlineAt: Date.now() + 10, lateGraceMs: 20 },
);
assert.deepEqual(hung, { claimed: 1, sent: 0, retried: 1, failed: 0, suppressed: 0, lost: 0 });
assert.deepEqual(hungSettles[0], { outcome: "failed", error: "timeout" });

// SMTP text never reaches the database: a fixed category and, at most, the reply code
const rejectSettles: Array<string | null> = [];
await processNotificationClaims(
  [claims[0]], snapshots, recipients,
  { async send() { throw new Error("550 5.1.1 <tasos@secret.gr>: Recipient address rejected: User unknown in mail.secret.gr"); }, close() {} },
  async (_claim, _outcome, error) => { rejectSettles.push(error); return true; },
  { siteUrl: null, maxAttempts: 8 },
);
assert.equal(rejectSettles[0], "recipient rejected (SMTP 550)");
assert.equal(redactDeliveryError("Invalid login: 535 5.7.8 Authentication failed for alerts@arabshipbroker.com"), "authentication failed (SMTP 535)");
assert.equal(redactDeliveryError("connect ECONNREFUSED 10.0.0.4:465"), "connection failed");
assert.equal(redactDeliveryError("something odd at smtp.host.example:2525"), "delivery failed");
for (const raw of ["550 5.1.1 <tasos@secret.gr>", "Invalid login: 535 for alerts@x.com", "connect ECONNREFUSED 10.0.0.4:465"]) {
  assert.doesNotMatch(redactDeliveryError(raw), /@|\d+\.\d+\.\d+|secret|tasos/i);
}

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
