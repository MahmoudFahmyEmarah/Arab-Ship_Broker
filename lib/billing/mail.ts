// Billing emails (invoice issued, reminders, expiry) through the same cPanel
// SMTP account Group Mail and the contact form use. Best-effort: a failed
// send is logged on the job run and never blocks the ledger.
import nodemailer from "nodemailer";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice } from "./types";
import { fmtMoney } from "./money";

const SITE = "https://www.arabshipbroker.com";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function smtpTransport(sb: SupabaseClient) {
  const { data: cfg } = await sb.from("groupmail_config").select("smtp_host, smtp_port, smtp_user, from_name").eq("id", 1).maybeSingle();
  const { data: pass } = await sb.rpc("groupmail_get_secret", { p_key: "smtp_password" });
  if (!cfg?.smtp_host || !cfg?.smtp_user || !pass) return null;
  return {
    transport: nodemailer.createTransport({ host: cfg.smtp_host, port: cfg.smtp_port || 465, secure: (cfg.smtp_port || 465) === 465, auth: { user: cfg.smtp_user, pass: pass as string }, connectionTimeout: 20_000, socketTimeout: 30_000 }),
    user: cfg.smtp_user as string, fromName: (cfg.from_name as string) || "Arab ShipBroker",
  };
}

function shell(title: string, bodyHtml: string, cta?: { label: string; url: string }): { html: string; text: string } {
  const html = `<!doctype html><html><body style="margin:0;background:#eef2f7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px;background:#eef2f7;"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;">
    <tr><td style="background:#0D2545;color:#fff;padding:16px 24px;font-size:16px;font-weight:700;">Arab ShipBroker <span style="font-weight:400;opacity:.75;font-size:12px;margin-left:8px;">Billing</span></td></tr>
    <tr><td style="padding:22px 24px 6px;font-size:19px;font-weight:700;color:#0f172a;">${esc(title)}</td></tr>
    <tr><td style="padding:6px 24px 18px;font-size:14px;line-height:1.7;color:#0f172a;">${bodyHtml}</td></tr>
    ${cta ? `<tr><td style="padding:0 24px 24px;"><a href="${esc(cta.url)}" style="display:inline-block;background:#0D2545;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:9px;">${esc(cta.label)} &rarr;</a></td></tr>` : ""}
    <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 24px;font-size:11.5px;color:#64748b;line-height:1.6;">Questions about this invoice: reply to this email or write to <a href="mailto:billing@arabshipbroker.com" style="color:#0E7490;">billing@arabshipbroker.com</a>. Bank transfers must quote the invoice number.</td></tr>
  </table></td></tr></table></body></html>`;
  const text = `${title}\n\n${bodyHtml.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")}\n${cta ? `\n${cta.label}: ${cta.url}\n` : ""}\nArab ShipBroker · billing@arabshipbroker.com`;
  return { html, text };
}

export type BillingMailKind = "issued" | "due-7" | "due-1" | "overdue" | "expired";

export function buildBillingMail(kind: BillingMailKind, invoice: Invoice, customerName: string, opts: { graceDays: number }): { subject: string; html: string; text: string } {
  const open = invoice.total - invoice.amount_paid;
  const amount = fmtMoney(open, invoice.currency);
  const due = invoice.due_at ? new Date(invoice.due_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—";
  const url = `${SITE}/dashboard/billing/invoices/${invoice.id}`;
  const cta = { label: "Open the invoice", url };
  const period = invoice.period_start ? ` for ${new Date(invoice.period_start).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}` : "";
  switch (kind) {
    case "issued": {
      const m = shell(`Invoice ${invoice.number} · ${amount}`, `Dear ${esc(customerName)},<br><br>Your Arab ShipBroker subscription invoice${period} is ready. Amount due <b>${amount}</b>, payable by <b>${due}</b> by bank transfer quoting <b>${esc(invoice.number ?? "")}</b>${invoice.egp_total && invoice.currency !== "EGP" ? ` (EGP equivalent ${fmtMoney(invoice.egp_total, "EGP")})` : ""}.<br><br>Your seats activate as soon as the payment is confirmed.`, cta);
      return { subject: `Invoice ${invoice.number} from Arab ShipBroker · ${amount}`, ...m };
    }
    case "due-7":
    case "due-1": {
      const days = kind === "due-7" ? 7 : 1;
      const m = shell(`Reminder · ${invoice.number} due ${days === 1 ? "tomorrow" : "in 7 days"}`, `Dear ${esc(customerName)},<br><br>A friendly reminder that invoice <b>${esc(invoice.number ?? "")}</b> for <b>${amount}</b> is due on <b>${due}</b>. If you have already paid, thank you — please ignore this note.`, cta);
      return { subject: `Reminder: invoice ${invoice.number} due ${due}`, ...m };
    }
    case "overdue": {
      const m = shell(`Invoice ${invoice.number} is overdue`, `Dear ${esc(customerName)},<br><br>Invoice <b>${esc(invoice.number ?? "")}</b> for <b>${amount}</b> was due on <b>${due}</b>. Your seats stay active for a grace period of ${opts.graceDays} days; after that they return to the Free tier until the invoice is settled.`, cta);
      return { subject: `Overdue: invoice ${invoice.number} · ${amount}`, ...m };
    }
    case "expired": {
      const m = shell(`Subscription paused · ${invoice.number}`, `Dear ${esc(customerName)},<br><br>Invoice <b>${esc(invoice.number ?? "")}</b> remained unpaid after the grace period, so the seats on this subscription are now on the Free tier. Nothing is lost: paying the invoice restores them immediately.`, cta);
      return { subject: `Subscription paused until invoice ${invoice.number} is paid`, ...m };
    }
  }
}

export async function sendBillingMail(sb: SupabaseClient, to: string, mail: { subject: string; html: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  const t = await smtpTransport(sb);
  if (!t) return { ok: false, error: "SMTP not configured (Group Mail settings)" };
  try {
    await t.transport.sendMail({
      from: { name: t.fromName, address: t.user }, to, replyTo: "billing@arabshipbroker.com",
      envelope: { from: t.user, to: [to] }, subject: mail.subject, html: mail.html, text: mail.text,
      headers: { "X-Auto-Response-Suppress": "All" },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  } finally {
    t.transport.close();
  }
}
