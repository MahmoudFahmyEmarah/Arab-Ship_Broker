// Group Mail — SMTP sender (server-only). Sends through the cPanel mailbox
// (e.g. circulation admin account) over SSL/TLS. Broadcasts go to each member
// individually — never through Mailman's posting pipeline — so delivery never
// depends on list moderation rules, and every recipient gets a clean To: line
// plus a per-address success/failure record.

import nodemailer from "nodemailer";
import { EMAIL_LOGO_B64, EMAIL_LOGO_CID } from "./logo";

export interface SmtpAuth {
  host: string;
  port: number;
  user: string;
  password: string;
  fromName: string;
}

export function makeTransport(a: SmtpAuth) {
  return nodemailer.createTransport({
    host: a.host,
    port: a.port,
    secure: a.port === 465,
    auth: { user: a.user, pass: a.password },
    connectionTimeout: 20_000,
    socketTimeout: 30_000,
  });
}

export async function verifySmtp(a: SmtpAuth): Promise<void> {
  await makeTransport(a).verify();
}

export interface SendResult {
  email: string;
  ok: boolean;
  error?: string;
}

/** Send one composed mail to each recipient in sequence (small pause between). */
export async function sendToRecipients(
  a: SmtpAuth,
  recipients: string[],
  mail: { subject: string; html: string; text: string; replyTo?: string; listEmail?: string; unsubscribeUrl?: string | null },
): Promise<SendResult[]> {
  const transport = makeTransport(a);
  const results: SendResult[] = [];
  // Deliverability: declare the mail as a list circular. Mailbox providers
  // score a visible, working unsubscribe path and a stable List-Id far better
  // than an unmarked bulk send; the envelope sender stays the DKIM-signed
  // mailbox so SPF, DKIM and DMARC all align on arabshipbroker.com.
  const domain = a.user.split("@")[1] ?? "arabshipbroker.com";
  const listLocal = (mail.listEmail ?? a.user).split("@")[0];
  const unsub = [
    mail.unsubscribeUrl ? `<${mail.unsubscribeUrl}>` : null,
    `<mailto:${mail.replyTo ?? a.user}?subject=unsubscribe>`,
  ].filter(Boolean).join(", ");
  const headers: Record<string, string> = {
    "List-Id": `${listLocal} circulars <${listLocal}.${domain}>`,
    "List-Unsubscribe": unsub,
    "Precedence": "bulk",
    "X-Auto-Response-Suppress": "All",
  };
  for (const email of recipients) {
    try {
      await transport.sendMail({
        from: { name: a.fromName, address: a.user },
        to: email,
        replyTo: mail.replyTo ?? a.user,
        envelope: { from: a.user, to: email },
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers,
        // the brand mark rides along inline — renders without any image hosting
        attachments: [{
          filename: "asb-logo.png",
          content: Buffer.from(EMAIL_LOGO_B64, "base64"),
          contentType: "image/png",
          cid: EMAIL_LOGO_CID,
        }],
      });
      results.push({ email, ok: true });
    } catch (e) {
      results.push({ email, ok: false, error: e instanceof Error ? e.message : "send failed" });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  transport.close();
  return results;
}
