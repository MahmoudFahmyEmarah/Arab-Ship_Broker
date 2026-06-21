import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Public contact form handler. Does two things, server-side:
//   1. Persists the submission to public.contact_messages (admins read it in
//      the admin console → Contact Messages).
//   2. Best-effort branded email notification via Resend to CONTACT_NOTIFY_EMAIL
//      — the email never blocks the submission; if it fails we still return ok
//      and the message is safely stored.
export const runtime = "nodejs";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const BRAND = {
  name: "Arab ShipBroker",
  navy: "#0D2240",
  accent: "#0E7490",
  site: "arabshipbroker.com",
};

interface ContactFields {
  name: string;
  email: string;
  phone: string | null;
  how: string | null;
  message: string;
  submittedAt: string;
}

// Production-grade notification email — table-based, inline styles, preheader,
// and a plain-text fallback for deliverability across all mail clients.
function buildContactEmail(f: ContactFields): { subject: string; html: string; text: string } {
  const subject = `New enquiry from ${f.name} — ${BRAND.name}`;
  const year = new Date().getFullYear();
  const preheader = `${f.name}: ${f.message.slice(0, 90)}${f.message.length > 90 ? "…" : ""}`;

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:7px 0;font-size:13px;color:#94a3b8;width:140px;vertical-align:top;font-weight:600;">${label}</td>
      <td style="padding:7px 0;font-size:14px;color:#0f172a;vertical-align:top;">${value}</td>
    </tr>`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef2f7;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <!-- Header -->
        <tr><td style="background:${BRAND.navy};padding:22px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.2px;">⚓&nbsp; ${BRAND.name}</td>
            <td align="right"><span style="display:inline-block;background:rgba(94,234,212,.12);border:1px solid rgba(94,234,212,.4);color:#5eead4;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:4px 10px;border-radius:999px;">New Enquiry</span></td>
          </tr></table>
        </td></tr>
        <!-- Title -->
        <tr><td style="padding:28px 28px 4px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${BRAND.accent};">Contact Form</div>
          <div style="font-size:21px;font-weight:700;color:#0f172a;margin-top:6px;line-height:1.3;">${esc(f.name)} sent a message</div>
          <div style="font-size:13px;color:#64748b;margin-top:5px;">${esc(f.submittedAt)}</div>
        </td></tr>
        <!-- Details -->
        <tr><td style="padding:18px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef2f7;border-bottom:1px solid #eef2f7;">
            ${row("Email", `<a href="mailto:${esc(f.email)}" style="color:${BRAND.accent};text-decoration:none;">${esc(f.email)}</a>`)}
            ${row("Phone", esc(f.phone ?? "—"))}
            ${row("Found us via", esc(f.how ?? "—"))}
          </table>
        </td></tr>
        <!-- Message -->
        <tr><td style="padding:20px 28px 4px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">Message</div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;font-size:14px;line-height:1.65;color:#0f172a;">${esc(f.message).replace(/\n/g, "<br>")}</div>
        </td></tr>
        <!-- CTA -->
        <tr><td style="padding:22px 28px 28px;">
          <a href="mailto:${esc(f.email)}?subject=${encodeURIComponent("Re: your enquiry to " + BRAND.name)}" style="display:inline-block;background:${BRAND.navy};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:9px;">Reply to ${esc(f.name)} &rarr;</a>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 28px;font-size:12px;color:#94a3b8;line-height:1.6;">
          Submitted through the contact form at ${BRAND.site}. Reply directly to this email to respond to the sender.
        </td></tr>
      </table>
      <div style="font-size:11px;color:#94a3b8;margin-top:16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">&copy; ${year} ${BRAND.name} &middot; MENA maritime brokerage</div>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `New contact enquiry — ${BRAND.name}`,
    f.submittedAt,
    "",
    `Name:         ${f.name}`,
    `Email:        ${f.email}`,
    `Phone:        ${f.phone ?? "—"}`,
    `Found us via: ${f.how ?? "—"}`,
    "",
    "Message:",
    f.message,
    "",
    `Reply directly to this email to respond to ${f.name}.`,
    `Submitted through the contact form at ${BRAND.site}.`,
  ].join("\n");

  return { subject, html, text };
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim();
  const phone = body?.phone ? String(body.phone).trim() : null;
  const how = body?.how_did_you_find_us ? String(body.how_did_you_find_us).trim() : null;
  const message = String(body?.message ?? "").trim();

  if (!name || !email || !message) {
    return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
  }

  // 1 · Persist (service role — bypasses RLS, server-only).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await supabase
    .from("contact_messages")
    .insert({ name, email, phone, how_did_you_find_us: how, message });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // 2 · Branded email notification (best-effort).
  const resendKey = process.env.RESEND_API_KEY;
  const notify = process.env.CONTACT_NOTIFY_EMAIL;
  const from = process.env.RESEND_FROM || "Arab ShipBroker <onboarding@resend.dev>";
  if (resendKey && notify) {
    try {
      const submittedAt = new Date().toLocaleString("en-GB", {
        timeZone: "Africa/Cairo",
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }) + " (Cairo)";
      const { subject, html, text } = buildContactEmail({ name, email, phone, how, message, submittedAt });
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: notify, reply_to: email, subject, html, text }),
      });
      if (!r.ok) console.error("[contact] resend send failed:", r.status, await r.text());
    } catch (err) {
      console.error("[contact] email notification error:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
