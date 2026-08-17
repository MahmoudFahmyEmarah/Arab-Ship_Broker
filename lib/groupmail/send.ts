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
  mail: { subject: string; html: string; text: string; replyTo?: string },
): Promise<SendResult[]> {
  const transport = makeTransport(a);
  const results: SendResult[] = [];
  for (const email of recipients) {
    try {
      await transport.sendMail({
        from: { name: a.fromName, address: a.user },
        to: email,
        replyTo: mail.replyTo ?? a.user,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
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
