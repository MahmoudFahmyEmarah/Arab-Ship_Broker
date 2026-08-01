// Group Mail — the branded circular template. Same visual family as the
// contact-form notification (app/api/contact/route.ts): navy header with the
// anchor mark, badge pill, title block, body card, link buttons, footer.
// Table-based with inline styles + plain-text fallback for deliverability.

import type { CampaignInput } from "./types";

const BRAND = {
  name: "Arab ShipBroker",
  navy: "#0D2240",
  accent: "#0E7490",
  site: "arabshipbroker.com",
  // Absolute URL — email clients need it; the asset ships in /public.
  logo: "https://arabshipbroker.com/email-logo.png",
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text → paragraphs: blank line separates, single newline becomes <br>. */
function paragraphs(body: string): string {
  return body
    .trim()
    .split(/\n\s*\n/)
    .map((p) =>
      `<p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#0f172a;">${esc(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function buildCircularEmail(input: CampaignInput, stampedAt: string): { subject: string; html: string; text: string } {
  const subject = input.subject.trim();
  const badge = input.badge.trim() || "Circulation";
  const year = new Date().getFullYear();
  const preheader = `${input.title.trim() || subject}: ${input.body.trim().slice(0, 90)}`;
  const links = input.links.filter((l) => l.label.trim() && l.url.trim());

  const linkButtons = links
    .map(
      (l, i) => `<a href="${esc(l.url)}" style="display:inline-block;background:${i === 0 ? BRAND.navy : "#ffffff"};color:${i === 0 ? "#ffffff" : BRAND.navy};border:1px solid ${i === 0 ? BRAND.navy : "#cbd5e1"};text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:9px;margin:0 10px 10px 0;">${esc(l.label)} &rarr;</a>`,
    )
    .join("");

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
        <tr><td style="background:${BRAND.navy};padding:18px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="46" style="vertical-align:middle;">
              <img src="${BRAND.logo}" width="38" height="38" alt="⚓" style="display:block;background:#ffffff;border-radius:9px;padding:3px;" />
            </td>
            <td style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.2px;padding-left:12px;vertical-align:middle;">${BRAND.name}</td>
            <td align="right" style="vertical-align:middle;"><span style="display:inline-block;background:rgba(94,234,212,.12);border:1px solid rgba(94,234,212,.4);color:#5eead4;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:4px 10px;border-radius:999px;">${esc(badge)}</span></td>
          </tr></table>
        </td></tr>
        <!-- Title -->
        <tr><td style="padding:28px 28px 6px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${BRAND.accent};">${esc(badge)}</div>
          <div style="font-size:21px;font-weight:700;color:#0f172a;margin-top:6px;line-height:1.3;">${esc(input.title.trim() || subject)}</div>
          <div style="font-size:13px;color:#64748b;margin-top:5px;">${esc(stampedAt)}</div>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:16px 28px 4px;">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;">${paragraphs(input.body)}</div>
        </td></tr>
        ${links.length ? `<!-- Links -->
        <tr><td style="padding:20px 28px 14px;">${linkButtons}</td></tr>` : ""}
        <!-- Footer -->
        <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 28px;font-size:12px;color:#94a3b8;line-height:1.6;">
          You are receiving this circular as a member of ${esc(input.list_email)}.
          Reply to this email to reach the ${BRAND.name} desk.
        </td></tr>
      </table>
      <div style="font-size:11px;color:#94a3b8;margin-top:16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">&copy; ${year} ${BRAND.name} &middot; MENA maritime brokerage &middot; ${BRAND.site}</div>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `${badge.toUpperCase()} — ${BRAND.name}`,
    input.title.trim() || subject,
    stampedAt,
    "",
    input.body.trim(),
    "",
    ...links.map((l) => `${l.label}: ${l.url}`),
    "",
    `You are receiving this circular as a member of ${input.list_email}.`,
    `© ${year} ${BRAND.name} · ${BRAND.site}`,
  ].join("\n");

  return { subject, html, text };
}
